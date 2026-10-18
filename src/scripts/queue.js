
const {
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
const { startReadyCheck } = require("./ready");
const { logQueueJoin, logQueueLeave } = require("./logs");

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451,
  neutral: 0x2B2D35
};

const PANEL_MARKER = "INVI SIX PRO • MATCHMAKING";

function safeText(value, fallback = "Não informado") {
  return String(value || fallback)
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, 80);
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return value < 100000000000
      ? Math.floor(value)
      : Math.floor(value / 1000);
  }

  const text = String(value).trim();

  if (/^\d+$/.test(text)) {
    const numeric = Number(text);

    return numeric < 100000000000
      ? Math.floor(numeric)
      : Math.floor(numeric / 1000);
  }

  const parsed = Date.parse(text);

  return Number.isFinite(parsed)
    ? Math.floor(parsed / 1000)
    : null;
}

function getJoinedTimes() {
  const session = queueState.getActiveSession();

  if (!session) return new Map();

  try {
    const rows = db.prepare(`
      SELECT discord_id, joined_at
      FROM matchmaking_session_players
      WHERE session_id = ?
    `).all(session.id);

    return new Map(
      rows.map(row => [
        String(row.discord_id),
        normalizeTimestamp(row.joined_at)
      ])
    );
  } catch (error) {
    console.error(
      "[QUEUE] Erro ao consultar horários:",
      error
    );

    return new Map();
  }
}

async function handleQueue(interaction) {
  if (
    interaction.customId !== "queue_join" &&
    interaction.customId !== "queue_leave"
  ) {
    return;
  }

  const player = db.prepare(`
    SELECT *
    FROM players
    WHERE discord_id = ?
  `).get(interaction.user.id);

  if (!player || player.access_active !== 1) {
    return interaction.reply({
      content: "Você não possui acesso ao matchmaking.",
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

  const penaltyRemaining =
    queueState.getPenaltyRemaining(interaction.user.id);

  if (penaltyRemaining > 0) {
    const minutes = Math.ceil(penaltyRemaining / 60000);

    return interaction.reply({
      content:
        `Você possui um cooldown de matchmaking. ` +
        `Tempo restante: **${minutes} minuto(s)**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const remaining = queueState.getCooldownRemaining(
    interaction.user.id,
    config.matchmaking.queueCooldownSeconds
  );

  if (remaining > 0) {
    return interaction.reply({
      content:
        `Aguarde **${Math.ceil(remaining / 1000)}s** ` +
        "antes de usar a fila novamente.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === "queue_join") {
    return joinQueue(interaction, player);
  }

  return leaveQueue(interaction);
}

async function joinQueue(interaction, player) {
  const requiredPlayers = config.matchmaking.requiredPlayers;
  const userId = interaction.user.id;

  if (queueState.hasPlayer(userId)) {
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
  `).get(userId);

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
    discordId: userId,
    nickname: player.r6_nickname,
    rank: player.r6_rank
  });

  if (!added) {
    return interaction.reply({
      content: "Não foi possível adicionar você à fila.",
      flags: MessageFlags.Ephemeral
    });
  }

  queueState.setCooldown(userId);
  queueState.setQueueMessage(interaction.message);

  await interaction.update(createQueuePanel());

  await interaction.followUp({
    content:
      `Você entrou na fila. ` +
      `(${queueState.getSize()}/${requiredPlayers})`,
    flags: MessageFlags.Ephemeral
  });

  try {
    await logQueueJoin(
      interaction,
      player,
      queueState.getSize(),
      requiredPlayers
    );
  } catch (error) {
    console.warn(
      "[QUEUE] Falha no log de entrada:",
      error.message
    );
  }

  if (queueState.getSize() !== requiredPlayers) {
    return;
  }

  queueState.lockQueue();
  await updateQueuePanel();

  const players = queueState.getPlayers();

  try {
    await startReadyCheck(interaction, players);
  } catch (error) {
    console.error(
      "[QUEUE] Erro ao iniciar Ready Check:",
      error
    );

    // Não desbloqueia uma sessão que já avançou.
    const session = queueState.getActiveSession();

    if (session?.stage === "queue") {
      queueState.unlockQueue();
      await updateQueuePanel();
    }

    try {
      await interaction.followUp({
        content:
          "Houve um problema ao iniciar o Ready Check. " +
          "A equipe deve verificar os logs.",
        flags: MessageFlags.Ephemeral
      });
    } catch {
      // A interação pode ter expirado.
    }
  }
}

async function leaveQueue(interaction) {
  const requiredPlayers = config.matchmaking.requiredPlayers;

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
      `Você saiu da fila. ` +
      `(${queueState.getSize()}/${requiredPlayers})`,
    flags: MessageFlags.Ephemeral
  });

  try {
    await logQueueLeave(
      interaction,
      queueState.getSize(),
      requiredPlayers
    );
  } catch (error) {
    console.warn(
      "[QUEUE] Falha no log de saída:",
      error.message
    );
  }
}

function multiLobbyEnabled() {
  return process.env.MULTILOBBY_QUEUE_ENABLED === "true";
}

function createMultiLobbyQueuePanel() {
  const waiting = require("../services/waitingQueue");
  const players = waiting.listWaiting(config.discord.guildId);
  const count = players.length;
  const required = config.matchmaking.requiredPlayers;
  const remainder = count % required;
  const needed = remainder === 0 ? required : required - remainder;
  const active = db.prepare(`SELECT COUNT(*) AS total FROM matchmaking_sessions
    WHERE guild_id=? AND status='active' AND stage!='queue'`).get(config.discord.guildId);
  const lines = players.slice(0,30).map((player,index) =>
    `**${index+1}.** <@${player.discord_id}> · <t:${Math.floor(player.joined_at/1000)}:t>`
  );
  const container = new ContainerBuilder().setAccentColor(COLORS.primary)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${PANEL_MARKER}\n### Fila contínua · 5v5\n**Status:** 🟢 Fila aberta\n**Aguardando:** ${count}\n**Faltam para o próximo lobby:** ${needed}\n**Lobbies ativos:** ${active.total}\n\n### Jogadores aguardando\n${lines.join("\n") || "Nenhum jogador aguardando."}`
    ));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("queue_join").setLabel("Entrar na fila").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("queue_leave").setLabel("Sair da fila").setStyle(ButtonStyle.Secondary)
  );
  return {content:null,embeds:[],components:[container,buttons],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}

function createQueuePanel() {
  const players = queueState.getPlayers();
  const joinedTimes = getJoinedTimes();

  const requiredPlayers = config.matchmaking.requiredPlayers;
  const locked = queueState.isQueueLocked();
  const count = queueState.getSize();
  const missing = Math.max(0, requiredPlayers - count);

  const status = locked
    ? "🔒 Formando partida"
    : "🟢 Fila aberta";

  const playerList = players.length
    ? players.map((player, index) => {
        const joined = joinedTimes.get(
          String(player.discordId)
        );

        const time = joined
          ? `<t:${joined}:t>`
          : "Horário indisponível";

        return (
          `**${String(index + 1).padStart(2, "0")}.** ` +
          `${safeText(player.nickname)} · ` +
          `${safeText(player.rank)}\n` +
          `-# 🕒 Entrou: ${time}`
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
          ? `-# Partida encontrada. Acompanhem as etapas em <#${config.discord.draftChannelId}>.`
          : "-# A partida começa quando a fila estiver completa."
      )
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("queue_join")
      .setLabel("Entrar na fila")
      .setStyle(ButtonStyle.Success)
      .setDisabled(locked || count >= requiredPlayers),

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

async function updateQueuePanel() {
  const message = queueState.getQueueMessage();

  if (!message) return false;

  try {
    await message.edit(createQueuePanel());
    return true;
  } catch (error) {
    console.error(
      "[QUEUE] Erro ao atualizar painel:",
      error
    );

    return false;
  }
}

function isQueuePanelMessage(message) {
  if (!message || !Array.isArray(message.components)) {
    return false;
  }

  const customIds = new Set();
  let hasMarker = false;

  function inspect(components) {
    for (const component of components || []) {
      if (
        typeof component.content === "string" &&
        component.content.includes(PANEL_MARKER)
      ) {
        hasMarker = true;
      }

      if (component.customId) {
        customIds.add(component.customId);
      }

      if (Array.isArray(component.components)) {
        inspect(component.components);
      }
    }
  }

  inspect(message.components);

  return hasMarker || (
    customIds.has("queue_join") &&
    customIds.has("queue_leave")
  );
}

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

async function restoreQueuePanel(client) {
  try {
    const recovery = queueState.restoreQueueState();

    const channel = await client.channels.fetch(
      config.discord.queueChannelId
    );

    if (
      !channel?.isTextBased() ||
      !channel.messages
    ) {
      throw new Error("QUEUE_CHANNEL_INVALID");
    }

    const session = queueState.getActiveSession();
    let queueMessage = null;

    if (session?.message_id) {
      try {
        const message = await channel.messages.fetch(
          session.message_id
        );

        if (isQueuePanelMessage(message)) {
          queueMessage = message;
        }
      } catch (error) {
        console.warn(
          "[QUEUE] Painel salvo indisponível:",
          error.message
        );
      }
    }

    let queueMessages = null;

    try {
      const messages = await channel.messages.fetch({
        limit: 100
      });

      queueMessages = messages
        .filter(message =>
          message.author?.id === client.user.id &&
          isQueuePanelMessage(message)
        )
        .sort((a, b) =>
          b.createdTimestamp - a.createdTimestamp
        );

      if (!queueMessage) {
        queueMessage = queueMessages.first() || null;
      }
    } catch (error) {
      console.warn(
        "[QUEUE] Histórico indisponível:",
        error.message
      );
    }

    if (!queueMessage) {
      queueMessage = await channel.send(
        createQueuePanel()
      );

      console.log(
        "[QUEUE] Novo painel criado."
      );
    }

    queueState.setQueueMessage(queueMessage);
    await queueMessage.edit(createQueuePanel());

    if (queueMessages) {
      for (const duplicate of queueMessages.values()) {
        if (duplicate.id === queueMessage.id) continue;

        try {
          await disableOldQueuePanel(duplicate);
        } catch (error) {
          console.warn(
            "[QUEUE] Falha ao desativar painel antigo:",
            error.message
          );
        }
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
      "[QUEUE] Erro ao restaurar painel:",
      error
    );

    return null;
  }
}

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

