
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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
      ephemeral: true
    });
  }

  if (player.is_banned === 1) {
    return interaction.reply({
      content:
        "Você está impedido de participar do matchmaking.",
      ephemeral: true
    });
  }

  if (queueState.isQueueLocked()) {
    return interaction.reply({
      content:
        "A fila está bloqueada enquanto uma partida está sendo formada.",
      ephemeral: true
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
      ephemeral: true
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
      ephemeral: true
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
      content:
        "Você já está na fila.",
      ephemeral: true
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
      ephemeral: true
    });
  }

  if (queueState.getSize() >= requiredPlayers) {
    return interaction.reply({
      content:
        "A fila já está completa.",
      ephemeral: true
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
      ephemeral: true
    });
  }

  queueState.setCooldown(interaction.user.id);
  queueState.setQueueMessage(interaction.message);

  await interaction.update(createQueuePanel());

  await interaction.followUp({
    content:
      `Você entrou na fila. (${queueState.getSize()}/${requiredPlayers})`,
    ephemeral: true
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
            (item) => item.discordId
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
          ephemeral: true
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
      content:
        "Você não está na fila.",
      ephemeral: true
    });
  }

  queueState.removePlayer(interaction.user.id);
  queueState.setCooldown(interaction.user.id);
  queueState.setQueueMessage(interaction.message);

  await interaction.update(createQueuePanel());

  await interaction.followUp({
    content:
      `Você saiu da fila. (${queueState.getSize()}/${requiredPlayers})`,
    ephemeral: true
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
    .map((player) => `<@${player.discordId}>`)
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
    // Recupera jogadores e bloqueio do SQLite.
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

    // Primeiro tenta recuperar pelo ID salvo.
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

    // Procura painéis recentes para reutilização.
    const messages = await channel.messages.fetch({
      limit: 100
    });

    const queueMessages = messages
      .filter(
        (message) =>
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

    // Cria painel apenas se não encontrar nenhum.
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

    // Desativa painéis duplicados.
    const duplicateMessages = queueMessages.filter(
      (message) => message.id !== queueMessage.id
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
        recovery.locked
          ? "bloqueada"
          : "aberta"
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
  if (!message || !Array.isArray(message.components)) {
    return false;
  }

  let hasJoin = false;
  let hasLeave = false;

  for (const row of message.components) {
    if (!row || !Array.isArray(row.components)) {
      continue;
    }

    for (const component of row.components) {
      if (component.customId === "queue_join") {
        hasJoin = true;
      }

      if (component.customId === "queue_leave") {
        hasLeave = true;
      }
    }
  }

  return hasJoin && hasLeave;
}

// ==========================================
// DESATIVAR PAINEL ANTIGO
// ==========================================

async function disableOldQueuePanel(message) {
  const embed = new EmbedBuilder()
    .setTitle("Painel de matchmaking antigo")
    .setDescription(
      "Este painel foi substituído. Utilize o painel de matchmaking mais recente."
    )
    .setFooter({
      text: "Rainbow Six Siege • Matchmaking"
    });

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("queue_old_join")
        .setLabel("Entrar na fila")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),

      new ButtonBuilder()
        .setCustomId("queue_old_leave")
        .setLabel("Sair da fila")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

  await message.edit({
    embeds: [embed],
    components: [buttons]
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

  let playerList = "Nenhum jogador na fila.";

  if (players.length > 0) {
    playerList = players
      .map(
        (player, index) =>
          `**${index + 1}.** ` +
          `${player.nickname} — ${player.rank}`
      )
      .join("\n");
  }

  const embed = new EmbedBuilder()
    .setTitle("Matchmaking 5v5")
    .setDescription(
      locked
        ? "Uma partida está sendo formada. A fila está temporariamente bloqueada."
        : "Entre na fila para procurar uma partida competitiva."
    )
    .addFields(
      {
        name: "Jogadores na fila",
        value:
          `${queueState.getSize()}/${requiredPlayers}`,
        inline: true
      },
      {
        name: "Status",
        value:
          locked
            ? "🔒 Formando partida"
            : "🟢 Aberta",
        inline: true
      },
      {
        name: "Fila",
        value: playerList,
        inline: false
      }
    )
    .setFooter({
      text: "Rainbow Six Siege • Matchmaking"
    });

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("queue_join")
        .setLabel("Entrar na fila")
        .setStyle(ButtonStyle.Success)
        .setDisabled(
          locked ||
          queueState.getSize() >= requiredPlayers
        ),

      new ButtonBuilder()
        .setCustomId("queue_leave")
        .setLabel("Sair da fila")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(locked)
    );

  return {
    embeds: [embed],
    components: [buttons]
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
