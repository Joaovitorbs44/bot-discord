
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const queueState = require("./queueState");

const {
  startReadyCheck
} = require("./ready");

const {
  logQueueJoin,
  logQueueLeave
} = require("./logs");

// ==========================================
// IDENTIDADE VISUAL
// ==========================================

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451,
  neutral: 0x2B2D35
};

const PANEL_MARKER = "INVISIXTATIONAL • MATCHMAKING";

// ==========================================
// INTERAÇÕES DA FILA
// ==========================================

async function handleQueue(interaction) {
  const player = db.prepare(`
    SELECT *
    FROM players
    WHERE discord_id = ?
  `).get(interaction.user.id);

  if (!player || player.access_active !== 1) {
    return interaction.reply({
      content:
        "Você não possui acesso ao matchmaking.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (player.is_banned === 1) {
    return interaction.reply({
      content:
        "Você está impedido de participar do matchmaking.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (queueState.isQueueLocked()) {
    return interaction.reply({
      content:
        "A fila está bloqueada enquanto uma partida está sendo formada.",
      flags: MessageFlags.Ephemeral
    });
  }

  // ========================================
  // PENALIDADE PERSISTENTE
  // ========================================

  const penaltyRemaining =
    queueState.getPenaltyRemaining(
      interaction.user.id
    );

  if (penaltyRemaining > 0) {
    const minutes = Math.ceil(
      penaltyRemaining / 60000
    );

    return interaction.reply({
      content:
        `Você possui um cooldown de matchmaking. Tempo restante: **${minutes} minuto(s)**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ========================================
  // COOLDOWN DE BOTÃO
  // ========================================

  const remaining =
    queueState.getCooldownRemaining(
      interaction.user.id,
      config.matchmaking.queueCooldownSeconds
    );

  if (remaining > 0) {
    const seconds = Math.ceil(
      remaining / 1000
    );

    return interaction.reply({
      content:
        `Aguarde **${seconds}s** antes de usar a fila novamente.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === "queue_join") {
    return joinQueue(interaction, player);
  }

  if (interaction.customId === "queue_leave") {
    return leaveQueue(interaction);
  }
}

// ==========================================
// ENTRAR NA FILA
// ==========================================

async function joinQueue(interaction, player) {
  const requiredPlayers =
    config.matchmaking.requiredPlayers;

  if (queueState.hasPlayer(interaction.user.id)) {
    return interaction.reply({
      content: "Você já está na fila.",
      flags: MessageFlags.Ephemeral
    });
  }

  const activeMatch = db.prepare(`
    SELECT matches.match_code
    FROM match_players
    INNER JOIN matches
      ON matches.id = match_players.match_id
    WHERE match_players.discord_id = ?
      AND matches.status IN (
        'playing',
        'pending_confirmation',
        'disputed'
      )
    LIMIT 1
  `).get(interaction.user.id);

  if (activeMatch) {
    return interaction.reply({
      content:
        `Você já participa da partida **${activeMatch.match_code}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (queueState.getSize() >= requiredPlayers) {
    return interaction.reply({
      content: "A fila já está completa.",
      flags: MessageFlags.Ephemeral
    });
  }

  const added = queueState.addPlayer({
    discordId: interaction.user.id,
    nickname: player.r6_nickname,
    rank: player.r6_rank
  });

  if (!added) {
    return interaction.reply({
      content:
        "Não foi possível adicionar você à fila.",
      flags: MessageFlags.Ephemeral
    });
  }

  queueState.setCooldown(interaction.user.id);
  queueState.setQueueMessage(interaction.message);

  await interaction.update(createQueuePanel());

  await interaction.followUp({
    content:
      `Você entrou na fila. (${queueState.getSize()}/${requiredPlayers})`,
    flags: MessageFlags.Ephemeral
  });

  await logQueueJoin(
    interaction,
    player,
    queueState.getSize(),
    requiredPlayers
  );

  // ========================================
  // FILA COMPLETA
  // ========================================

  if (queueState.getSize() === requiredPlayers) {
    queueState.lockQueue();

    await updateQueuePanel();

    const players = queueState.getPlayers();

    try {
      await interaction.followUp({
        content: createMatchFoundMessage(players),
        allowedMentions: {
          users: players.map(
            item => item.discordId
          )
        }
      });

      await startReadyCheck(
        interaction,
        players
      );
    } catch (error) {
      queueState.unlockQueue();

      await updateQueuePanel();

      console.error(
        "Erro ao iniciar Ready Check:",
        error
      );

      try {
        await interaction.followUp({
          content:
            "Não foi possível iniciar o Ready Check. A fila foi liberada novamente.",
          flags: MessageFlags.Ephemeral
        });
      } catch {
        // Interação expirada.
      }
    }
  }
}

// ==========================================
// SAIR DA FILA
// ==========================================

async function leaveQueue(interaction) {
  const requiredPlayers =
    config.matchmaking.requiredPlayers;

  if (!queueState.hasPlayer(interaction.user.id)) {
    return interaction.reply({
      content: "Você não está na fila.",
      flags: MessageFlags.Ephemeral
    });
  }

  queueState.removePlayer(interaction.user.id);
  queueState.setCooldown(interaction.user.id);
  queueState.setQueueMessage(interaction.message);

  await interaction.update(createQueuePanel());

  await interaction.followUp({
    content:
      `Você saiu da fila. (${queueState.getSize()}/${requiredPlayers})`,
    flags: MessageFlags.Ephemeral
  });

  await logQueueLeave(
    interaction,
    queueState.getSize(),
    requiredPlayers
  );
}

// ==========================================
// AVISO DE PARTIDA ENCONTRADA
// ==========================================

function createMatchFoundMessage(players) {
  const mentions = players
    .map(player => `<@${player.discordId}>`)
    .join(" ");

  return (
    "🔔 **PARTIDA ENCONTRADA!**\n\n" +
    `${mentions}\n\n` +
    "Os **10 jogadores** foram encontrados.\n" +
    "Confirmem presença no **Ready Check** abaixo."
  );
}

// ==========================================
// ATUALIZAR PAINEL
// ==========================================

async function updateQueuePanel() {
  const message = queueState.getQueueMessage();

  if (!message) {
    return false;
  }

  try {
    await message.edit(createQueuePanel());
    return true;
  } catch (error) {
    console.error(
      "Erro ao atualizar painel da fila:",
      error
    );

    return false;
  }
}

// ==========================================
// RESTAURAR PAINEL
// ==========================================

async function restoreQueuePanel(client) {
  try {
    const recovery = queueState.restoreQueueState();

    const channel = await client.channels.fetch(
      config.discord.queueChannelId
    );

    if (
      !channel ||
      !channel.isTextBased() ||
      !channel.messages
    ) {
      throw new Error("QUEUE_CHANNEL_INVALID");
    }

    const session = queueState.getActiveSession();

    let queueMessage = null;

    if (session && session.message_id) {
      try {
        queueMessage = await channel.messages.fetch(
          session.message_id
        );

        if (
          !queueMessage ||
          !isQueuePanelMessage(queueMessage)
        ) {
          queueMessage = null;
        }
      } catch {
        queueMessage = null;
      }
    }

    const messages = await channel.messages.fetch({
      limit: 100
    });

    const queueMessages = messages
      .filter(
        message =>
          message.author &&
          message.author.id === client.user.id &&
          isQueuePanelMessage(message)
      )
      .sort(
        (a, b) =>
          b.createdTimestamp -
          a.createdTimestamp
      );

    if (!queueMessage) {
      queueMessage = queueMessages.first();
    }

    if (!queueMessage) {
      queueMessage = await channel.send(
        createQueuePanel()
      );

      console.log(
        "Novo painel de matchmaking criado."
      );
    }

    queueState.setQueueMessage(queueMessage);

    await queueMessage.edit(createQueuePanel());

    const duplicateMessages = queueMessages.filter(
      message => message.id !== queueMessage.id
    );

    for (const duplicate of duplicateMessages.values()) {
      try {
        await disableOldQueuePanel(duplicate);
      } catch (error) {
        console.error(
          `Erro ao desativar painel antigo ${duplicate.id}:`,
          error
        );
      }
    }

    console.log(
      `Painel restaurado: ${queueMessage.id}`
    );

    console.log(
      `Jogadores recuperados: ${recovery.restored}`
    );

    console.log(
      `Estado da fila: ${
        recovery.locked ? "bloqueada" : "aberta"
      }`
    );

    return queueMessage;
  } catch (error) {
    console.error(
      "Erro ao restaurar painel de matchmaking:",
      error
    );

    return null;
  }
}

// ==========================================
// IDENTIFICAR PAINEL
// ==========================================

function isQueuePanelMessage(message) {
  if (
    !message ||
    !Array.isArray(message.components)
  ) {
    return false;
  }

  // Identificação pelo marcador textual V2.
  const hasMarker = message.components.some(
    component =>
      component.content &&
      component.content.includes(PANEL_MARKER)
  );

  if (hasMarker) return true;

  // Compatibilidade com painéis V1 e V2.
  const customIds = new Set();

  function collectIds(components) {
    for (const component of components || []) {
      if (component.customId) {
        customIds.add(component.customId);
      }

      if (Array.isArray(component.components)) {
        collectIds(component.components);
      }
    }
  }

  collectIds(message.components);

  return (
    customIds.has("queue_join") &&
    customIds.has("queue_leave")
  );
}

// ==========================================
// DESATIVAR PAINEL ANTIGO
// ==========================================

async function disableOldQueuePanel(message) {
  const container = new ContainerBuilder()
    .setAccentColor(COLORS.neutral)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Painel substituído"
      ),
      new TextDisplayBuilder().setContent(
        "Este painel não está mais ativo. " +
        "Utilize o painel de matchmaking mais recente."
      )
    );

  await message.edit({
    content: null,
    embeds: [],
    components: [container],
    flags: MessageFlags.IsComponentsV2
  });
}

// ==========================================
// PAINEL DE MATCHMAKING
// ==========================================

function createQueuePanel() {
  const players = queueState.getPlayers();

  const requiredPlayers =
    config.matchmaking.requiredPlayers;

  const locked = queueState.isQueueLocked();

  const count = queueState.getSize();

  const missing = Math.max(
    0,
    requiredPlayers - count
  );

  const status = locked
    ? "🔒 Formando partida"
    : "🟢 Fila aberta";

  const playerList = players.length
    ? players.map((player, index) => {
        const nickname =
          String(player.nickname || "Sem nickname")
            .replace(/[*_~`|]/g, "");

        const rank =
          String(player.rank || "Sem rank")
            .replace(/[*_~`|]/g, "");

        return (
          `**${index + 1}.** ${nickname} · ${rank}`
        );
      }).join("\n")
    : "Nenhum jogador aguardando.";

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.primary)

    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${PANEL_MARKER}\n` +
        "### Fila competitiva · 5v5"
      )
    )

    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )

    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Status:** ${status}\n` +
        `**Jogadores:** ${count}/${requiredPlayers}\n` +
        `**Faltam:** ${missing}`
      )
    )

    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )

    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### Jogadores na fila\n${playerList}`
      )
    )

    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )

    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        locked
          ? "-# Aguarde a formação da partida."
          : "-# A partida começa quando a fila estiver completa."
      )
    );

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("queue_join")
        .setLabel("Entrar na fila")
        .setStyle(ButtonStyle.Success)
        .setDisabled(
          locked || count >= requiredPlayers
        ),

      new ButtonBuilder()
        .setCustomId("queue_leave")
        .setLabel("Sair da fila")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(locked)
    );

  return {
    content: null,
    embeds: [],
    components: [container, buttons],
    flags: MessageFlags.IsComponentsV2
  };
}

// ==========================================
// COMPATIBILIDADE
// ==========================================

function getQueue() {
  return queueState.getPlayers();
}

function getQueueSize() {
  return queueState.getSize();
}

function setQueueMessage(message) {
  queueState.setQueueMessage(message);
}

function removePlayer(discordId) {
  return queueState.removePlayer(discordId);
}

function removePlayersFromQueue(discordIds) {
  return queueState.removePlayers(discordIds);
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  handleQueue,

  getQueue,
  getQueueSize,

  createQueuePanel,

  setQueueMessage,
  updateQueuePanel,
  restoreQueuePanel,

  removePlayer,
  removePlayersFromQueue,

  createMatchFoundMessage
};
