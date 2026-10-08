
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
  startCaptainVote
} = require("./captains");

const {
  logReadyCheckStarted,
  logReadyCheckTimeout
} = require("./logs");

// ==========================================
// ESTADO
// ==========================================

const readyPlayers = new Set();

let readyCheckActive = false;
let readyCheckPlayers = [];
let readyCheckMessage = null;
let readyCheckTimeout = null;
let readyCheckClient = null;
let readyCheckSessionId = null;
let readyCheckDeadline = null;
let readyCheckFinishing = false;

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const READY_CHECK_TIME =
  config.matchmaking.readyCheckSeconds * 1000;

function getPenaltyLevels() {
  return config.penalties?.cooldownLevelsMinutes ||
    [5, 15, 30];
}

// ==========================================
// UTILITÁRIOS
// ==========================================

function getSession() {
  return queueState.getActiveSession();
}

function saveReadyCheckState() {
  const session = getSession();

  if (!session || session.stage !== "ready_check") {
    return;
  }

  db.prepare(`
    UPDATE matchmaking_sessions
    SET
      deadline_at = ?,
      state_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    readyCheckDeadline,
    JSON.stringify({
      readyCheckMessageId:
        readyCheckMessage?.id || null,
      readyCheckChannelId:
        readyCheckMessage?.channelId ||
        config.discord.queueChannelId
    }),
    Date.now(),
    session.id
  );
}

function clearReadyCheckTimer() {
  if (readyCheckTimeout) {
    clearTimeout(readyCheckTimeout);
    readyCheckTimeout = null;
  }
}

function scheduleReadyCheckTimeout() {
  clearReadyCheckTimer();

  if (!readyCheckActive || !readyCheckDeadline) {
    return;
  }

  const remaining = Math.max(
    0,
    readyCheckDeadline - Date.now()
  );

  readyCheckTimeout = setTimeout(() => {
    handleReadyCheckTimeout().catch((error) => {
      console.error(
        "Erro no timeout do Ready Check:",
        error
      );
    });
  }, remaining);
}

// ==========================================
// INICIAR READY CHECK
// ==========================================

async function startReadyCheck(interaction, players) {
  if (readyCheckActive) {
    throw new Error("READY_CHECK_ALREADY_ACTIVE");
  }

  if (
    !Array.isArray(players) ||
    players.length !== config.matchmaking.requiredPlayers
  ) {
    throw new Error("INVALID_READY_CHECK_PLAYERS");
  }

  const uniquePlayers = new Set(
    players.map((player) => player?.discordId)
  );

  if (
    uniquePlayers.size !== players.length ||
    uniquePlayers.has(undefined)
  ) {
    throw new Error("INVALID_READY_CHECK_PLAYERS");
  }

  const session = getSession();

  if (!session) {
    throw new Error("READY_CHECK_SESSION_NOT_FOUND");
  }

  readyCheckPlayers = [...players];
  readyPlayers.clear();

  readyCheckClient = interaction.client;
  readyCheckSessionId = session.id;
  readyCheckDeadline = Date.now() + READY_CHECK_TIME;

  readyCheckActive = true;
  readyCheckFinishing = false;

  queueState.lockQueue();

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE matchmaking_session_players
        SET ready_confirmed = 0
        WHERE session_id = ?
      `).run(session.id);

      db.prepare(`
        UPDATE matchmaking_sessions
        SET
          stage = 'ready_check',
          deadline_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        readyCheckDeadline,
        Date.now(),
        session.id
      );
    })();

    readyCheckMessage = await interaction.followUp({
      ...createReadyCheckPanel(),
      fetchReply: true
    });

    saveReadyCheckState();
    scheduleReadyCheckTimeout();

    try {
      await logReadyCheckStarted(
        interaction.client,
        readyCheckPlayers
      );
    } catch (error) {
      console.error(
        "Erro ao registrar início do Ready Check:",
        error
      );
    }
  } catch (error) {
    resetReadyCheck();
    queueState.unlockQueue();
    throw error;
  }
}

// ==========================================
// CONFIRMAR PRESENÇA
// ==========================================

async function handleReadyCheck(interaction) {
  if (!readyCheckActive || readyCheckFinishing) {
    return interaction.reply({
      content: "Não existe um Ready Check ativo.",
      ephemeral: true
    });
  }

  if (Date.now() >= readyCheckDeadline) {
    await interaction.reply({
      content: "O prazo para confirmar terminou.",
      ephemeral: true
    });

    await handleReadyCheckTimeout();
    return;
  }

  const player = readyCheckPlayers.find(
    (item) => item.discordId === interaction.user.id
  );

  if (!player) {
    return interaction.reply({
      content: "Você não participa deste Ready Check.",
      ephemeral: true
    });
  }

  if (readyPlayers.has(interaction.user.id)) {
    return interaction.reply({
      content: "Você já confirmou que está pronto.",
      ephemeral: true
    });
  }

  const session = getSession();

  if (
    !session ||
    session.id !== readyCheckSessionId ||
    session.stage !== "ready_check"
  ) {
    return interaction.reply({
      content: "Este Ready Check não está mais ativo.",
      ephemeral: true
    });
  }

  const result = db.prepare(`
    UPDATE matchmaking_session_players
    SET ready_confirmed = 1
    WHERE session_id = ?
      AND discord_id = ?
      AND ready_confirmed = 0
  `).run(
    session.id,
    interaction.user.id
  );

  if (result.changes === 0) {
    return interaction.reply({
      content: "Sua confirmação já foi registrada.",
      ephemeral: true
    });
  }

  readyPlayers.add(interaction.user.id);

  await interaction.update(createReadyCheckPanel());

  if (readyPlayers.size === readyCheckPlayers.length) {
    await finishReadyCheck(interaction);
  }
}

// ==========================================
// PAINEL
// ==========================================

function createReadyCheckPanel() {
  const confirmed = readyCheckPlayers.filter(
    (player) => readyPlayers.has(player.discordId)
  );

  const waiting = readyCheckPlayers.filter(
    (player) => !readyPlayers.has(player.discordId)
  );

  const confirmedList = confirmed.length
    ? confirmed.map(
        (player) => `✅ ${player.nickname}`
      ).join("\n")
    : "Nenhum jogador confirmou.";

  const waitingList = waiting.length
    ? waiting.map(
        (player) => `⏳ ${player.nickname}`
      ).join("\n")
    : "Todos confirmaram.";

  const deadlineText = readyCheckDeadline
    ? `<t:${Math.ceil(readyCheckDeadline / 1000)}:R>`
    : `${config.matchmaking.readyCheckSeconds} segundos`;

  const embed = new EmbedBuilder()
    .setTitle("Ready Check")
    .setDescription(
      "A partida foi encontrada.\n\n" +
      "Confirme sua presença para continuar.\n\n" +
      `Prazo restante: **${deadlineText}**.`
    )
    .addFields(
      {
        name: "Confirmados",
        value: `${readyPlayers.size}/${readyCheckPlayers.length}`,
        inline: true
      },
      {
        name: "Prontos",
        value: confirmedList,
        inline: false
      },
      {
        name: "Aguardando",
        value: waitingList,
        inline: false
      }
    )
    .setFooter({
      text: "Rainbow Six Siege • Ready Check"
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ready_confirm")
      .setLabel("Estou pronto")
      .setStyle(ButtonStyle.Success)
      .setDisabled(
        !readyCheckActive ||
        readyCheckFinishing ||
        readyPlayers.size === readyCheckPlayers.length
      )
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

// ==========================================
// FINALIZAR READY CHECK
// ==========================================

async function finishReadyCheck(interaction) {
  if (
    !readyCheckActive ||
    readyCheckFinishing ||
    readyPlayers.size !== readyCheckPlayers.length
  ) {
    return;
  }

  readyCheckFinishing = true;
  clearReadyCheckTimer();

  const playersForMatch = [...readyCheckPlayers];

  const session = getSession();

  if (!session || session.id !== readyCheckSessionId) {
    resetReadyCheck();
    throw new Error("READY_CHECK_SESSION_LOST");
  }

  // Persiste a transição antes de iniciar a próxima etapa.
  db.prepare(`
    UPDATE matchmaking_sessions
    SET
      stage = 'captain_vote',
      deadline_at = NULL,
      state_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify({
      readyCheckCompleted: true
    }),
    Date.now(),
    session.id
  );

  if (readyCheckMessage) {
    try {
      await readyCheckMessage.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("Ready Check concluído")
            .setDescription(
              `✅ Todos os **${playersForMatch.length} jogadores** confirmaram presença.`
            )
            .setFooter({
              text: "Escolha dos capitães iniciada"
            })
        ],
        components: []
      });
    } catch (error) {
      console.error(
        "Erro ao atualizar Ready Check concluído:",
        error
      );
    }
  }

  resetReadyCheck();

  try {
    await startCaptainVote(
      interaction,
      playersForMatch
    );
  } catch (error) {
    console.error(
      "Erro ao iniciar votação de capitães:",
      error
    );

    // Mantém a formação bloqueada para evitar duplicidade.
    throw error;
  }
}

// ==========================================
// PENALIDADES
// ==========================================

function applyReadyCheckPenalty(discordId, sessionId) {
  if (config.penalties?.enabled === false) {
    return 0;
  }

  const now = Date.now();

  const windowHours =
    config.penalties?.escalationWindowHours || 24;

  const windowStart =
    now - windowHours * 60 * 60 * 1000;

  const previous = db.prepare(`
    SELECT COUNT(*) AS total
    FROM player_penalty_history
    WHERE discord_id = ?
      AND reason = 'ready_check_timeout'
      AND created_at >= ?
  `).get(discordId, windowStart);

  const levels = getPenaltyLevels();

  const index = config.penalties?.progressive === false
    ? 0
    : Math.min(previous.total, levels.length - 1);

  const minutes = levels[index];
  const expiresAt = now + minutes * 60 * 1000;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO player_penalty_history (
        discord_id,
        reason,
        duration_seconds,
        session_id,
        created_at
      )
      VALUES (?, 'ready_check_timeout', ?, ?, ?)
    `).run(
      discordId,
      minutes * 60,
      sessionId,
      now
    );

    db.prepare(`
      INSERT INTO player_cooldowns (
        discord_id,
        reason,
        expires_at,
        created_at
      )
      VALUES (?, 'ready_check_timeout', ?, ?)
      ON CONFLICT(discord_id)
      DO UPDATE SET
        reason = excluded.reason,
        expires_at = MAX(
          player_cooldowns.expires_at,
          excluded.expires_at
        ),
        created_at = excluded.created_at
    `).run(
      discordId,
      expiresAt,
      now
    );
  })();

  return minutes;
}

// ==========================================
// TIMEOUT
// ==========================================

async function handleReadyCheckTimeout() {
  if (!readyCheckActive || readyCheckFinishing) {
    return;
  }

  readyCheckFinishing = true;
  clearReadyCheckTimer();

  const sessionId = readyCheckSessionId;

  const missingPlayers = readyCheckPlayers.filter(
    (player) => !readyPlayers.has(player.discordId)
  );

  const penalties = [];

  for (const player of missingPlayers) {
    const minutes = applyReadyCheckPenalty(
      player.discordId,
      sessionId
    );

    queueState.removePlayer(player.discordId);
    queueState.clearCooldown(player.discordId);

    penalties.push({
      ...player,
      minutes
    });
  }

  const missingList = penalties.length
    ? penalties.map(
        (player) =>
          `❌ ${player.nickname}` +
          (player.minutes
            ? ` — ${player.minutes} min de cooldown`
            : "")
      ).join("\n")
    : "Nenhum.";

  if (readyCheckMessage) {
    try {
      await readyCheckMessage.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("Ready Check encerrado")
            .setDescription(
              `O tempo de **${config.matchmaking.readyCheckSeconds} segundos** terminou.`
            )
            .addFields({
              name: "Removidos da fila",
              value: missingList
            })
            .setFooter({
              text: "Os jogadores que confirmaram continuam na fila."
            })
        ],
        components: []
      });
    } catch (error) {
      console.error(
        "Erro ao encerrar painel do Ready Check:",
        error
      );
    }
  }

  if (readyCheckClient) {
    try {
      await logReadyCheckTimeout(
        readyCheckClient,
        missingPlayers
      );
    } catch (error) {
      console.error(
        "Erro ao registrar timeout do Ready Check:",
        error
      );
    }
  }

  queueState.unlockQueue();
  resetReadyCheck();

  await updateQueueMessage();
}

// ==========================================
// RECUPERAÇÃO APÓS REINÍCIO
// ==========================================

async function restoreReadyCheck(client) {
  const session = getSession();

  if (!session || session.stage !== "ready_check") {
    return false;
  }

  if (readyCheckActive) {
    return true;
  }

  const rows = db.prepare(`
    SELECT
      sp.discord_id,
      sp.ready_confirmed,
      p.r6_nickname,
      p.r6_rank
    FROM matchmaking_session_players sp
    LEFT JOIN players p
      ON p.discord_id = sp.discord_id
    WHERE sp.session_id = ?
    ORDER BY sp.joined_at, sp.id
  `).all(session.id);

  readyCheckPlayers = rows.map((row) => ({
    discordId: row.discord_id,
    nickname: row.r6_nickname || row.discord_id,
    rank: row.r6_rank || "Não informado"
  }));

  readyPlayers.clear();

  for (const row of rows) {
    if (row.ready_confirmed === 1) {
      readyPlayers.add(row.discord_id);
    }
  }

  readyCheckClient = client;
  readyCheckSessionId = session.id;
  readyCheckDeadline = session.deadline_at;

  readyCheckActive = true;
  readyCheckFinishing = false;

  let savedState = {};

  try {
    savedState = JSON.parse(session.state_json || "{}");
  } catch {
    savedState = {};
  }

  const channelId =
    savedState.readyCheckChannelId ||
    config.discord.queueChannelId;

  const messageId =
    savedState.readyCheckMessageId;

  if (messageId) {
    try {
      const channel = await client.channels.fetch(
        channelId
      );

      if (channel?.messages) {
        readyCheckMessage =
          await channel.messages.fetch(messageId);
      }
    } catch (error) {
      console.error(
        "Não foi possível recuperar mensagem do Ready Check:",
        error
      );
    }
  }

  if (!readyCheckMessage) {
    try {
      const channel = await client.channels.fetch(
        config.discord.queueChannelId
      );

      readyCheckMessage = await channel.send(
        createReadyCheckPanel()
      );

      saveReadyCheckState();
    } catch (error) {
      console.error(
        "Não foi possível recriar painel do Ready Check:",
        error
      );
    }
  } else {
    await readyCheckMessage.edit(
      createReadyCheckPanel()
    );
  }

  if (
    readyPlayers.size === readyCheckPlayers.length &&
    readyCheckPlayers.length ===
      config.matchmaking.requiredPlayers
  ) {
    console.warn(
      "Ready Check recuperado com todas as confirmações. A transição será retomada quando integrada ao fluxo de recuperação."
    );

    return true;
  }

  if (!readyCheckDeadline) {
    console.warn(
      "Ready Check recuperado sem prazo. Requer intervenção da Staff."
    );

    return true;
  }

  if (Date.now() >= readyCheckDeadline) {
    await handleReadyCheckTimeout();
  } else {
    scheduleReadyCheckTimeout();
  }

  return true;
}

// ==========================================
// CANCELAMENTO MANUAL
// ==========================================

async function cancelReadyCheck() {
  if (!readyCheckActive) {
    return false;
  }

  clearReadyCheckTimer();

  if (readyCheckMessage) {
    try {
      await readyCheckMessage.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("Ready Check cancelado")
            .setDescription(
              "O Ready Check foi cancelado pela Staff."
            )
            .setFooter({
              text: "A fila foi resetada."
            })
        ],
        components: []
      });
    } catch (error) {
      console.error(
        "Erro ao atualizar Ready Check cancelado:",
        error
      );
    }
  }

  resetReadyCheck();
  return true;
}

// ==========================================
// PAINEL PRINCIPAL
// ==========================================

async function updateQueueMessage() {
  const queueMessage = queueState.getQueueMessage();

  if (!queueMessage) {
    return;
  }

  try {
    const {
      createQueuePanel
    } = require("./queue");

    await queueMessage.edit(
      createQueuePanel()
    );
  } catch (error) {
    console.error(
      "Erro ao atualizar fila após Ready Check:",
      error
    );
  }
}

// ==========================================
// RESET
// ==========================================

function resetReadyCheck() {
  clearReadyCheckTimer();

  readyCheckActive = false;
  readyCheckFinishing = false;

  readyCheckPlayers = [];
  readyPlayers.clear();

  readyCheckMessage = null;
  readyCheckClient = null;
  readyCheckSessionId = null;
  readyCheckDeadline = null;
}

function isReadyCheckActive() {
  return readyCheckActive;
}

function getReadyCheckPlayers() {
  return [...readyCheckPlayers];
}

function getReadyPlayers() {
  return [...readyPlayers];
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  startReadyCheck,
  handleReadyCheck,
  cancelReadyCheck,
  restoreReadyCheck,

  isReadyCheckActive,
  getReadyCheckPlayers,
  getReadyPlayers
};
