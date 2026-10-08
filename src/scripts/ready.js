
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const queueState = require("./queueState");
const { startCaptainVote } = require("./captains");

const READY_SECONDS =
  config.matchmaking?.readyCheckSeconds || 60;

const PENALTY_LEVELS =
  config.penalties?.cooldownLevelsMinutes || [5, 15, 30];

const ESCALATION_HOURS =
  config.penalties?.escalationWindowHours || 24;

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451,
  neutral: 0x2B2D35
};

let active = false;
let finishing = false;
let sessionId = null;
let client = null;
let message = null;
let players = [];
let confirmed = new Set();
let deadline = null;
let timer = null;

// ==========================================
// SESSÃO
// ==========================================

function session() {
  return queueState.getActiveSession();
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function resetReadyCheck() {
  clearTimer();
  active = false;
  finishing = false;
  sessionId = null;
  client = null;
  message = null;
  players = [];
  confirmed = new Set();
  deadline = null;
}

function getReadyPlayers() {
  return [...confirmed];
}

function getReadyCheckPlayers() {
  return [...players];
}

function isReadyCheckActive() {
  return active;
}

// ==========================================
// SEGURANÇA DE TEXTO
// ==========================================

function safeText(value, fallback = "Não informado") {
  return String(value || fallback)
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, 80);
}

// ==========================================
// PAINEL COMPONENTS V2
// ==========================================

function panel(status = "active") {
  const done = status === "completed";
  const cancelled = status === "cancelled";
  const finished = done || cancelled;

  const count = confirmed.size;
  const total = players.length;

  const title = done
    ? "Presenças confirmadas"
    : cancelled
      ? "Ready Check encerrado"
      : "Confirme sua presença";

  const statusText = done
    ? "Todos os jogadores confirmaram presença."
    : cancelled
      ? "O prazo terminou ou a etapa foi cancelada."
      : `Confirme até <t:${Math.ceil(deadline / 1000)}:R>.`;

  const playerList = players.length
    ? players.map((player, index) => {
        const isConfirmed = confirmed.has(player.discordId);

        return (
          `**${String(index + 1).padStart(2, "0")}.** ` +
          `<@${player.discordId}> · ` +
          `${safeText(player.nickname)}\n` +
          `-# ${isConfirmed
            ? "✅ Confirmado"
            : "⏳ Aguardando confirmação"}`
        );
      }).join("\n")
    : "Nenhum jogador registrado.";

  const container = new ContainerBuilder()
    .setAccentColor(
      done
        ? COLORS.success
        : cancelled
          ? COLORS.neutral
          : COLORS.primary
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVISIXTATIONAL\n" +
        "### READY CHECK · MATCHMAKING 5V5"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${title}**\n${statusText}\n\n` +
        `**Confirmações:** ${count}/${total}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### Jogadores\n${playerList}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        finished
          ? "-# Etapa encerrada."
          : "-# Quem não confirmar dentro do prazo poderá receber cooldown."
      )
    );

  const button = new ButtonBuilder()
    .setCustomId("ready_confirm")
    .setLabel(
      done
        ? "Presenças confirmadas"
        : cancelled
          ? "Ready Check encerrado"
          : "Confirmar presença"
    )
    .setStyle(
      done ? ButtonStyle.Secondary : ButtonStyle.Success
    )
    .setDisabled(finished);

  return {
    content: null,
    embeds: [],
    components: [
      container,
      new ActionRowBuilder().addComponents(button)
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: []
    }
  };
}

// ==========================================
// PERSISTÊNCIA
// ==========================================

function saveState() {
  const current = session();

  if (
    !current ||
    current.id !== sessionId ||
    current.stage !== "ready_check"
  ) {
    return;
  }

  const state = {
    readyCheck: {
      messageId: message?.id || null,
      channelId: message?.channelId || null
    }
  };

  db.prepare(`
    UPDATE matchmaking_sessions
    SET state_json = ?,
        deadline_at = ?,
        updated_at = ?
    WHERE id = ? AND stage = 'ready_check'
  `).run(
    JSON.stringify(state),
    deadline,
    Date.now(),
    sessionId
  );
}

// ==========================================
// TEMPORIZADOR
// ==========================================

function scheduleTimeout() {
  clearTimer();

  if (!active || finishing || !deadline) return;

  timer = setTimeout(() => {
    handleReadyCheckTimeout().catch(error =>
      console.error(
        "Erro no timeout do Ready Check:",
        error
      )
    );
  }, Math.max(0, deadline - Date.now()));
}

// ==========================================
// ATUALIZAÇÃO DO PAINEL
// ==========================================

async function editPanel(status = "active") {
  if (!message) return;

  try {
    await message.edit(panel(status));
  } catch (error) {
    console.error(
      "Erro ao atualizar Ready Check:",
      error
    );
  }
}

// ==========================================
// PENALIDADES
// ==========================================

function penaltyFor(discordId) {
  if (config.penalties?.enabled === false) return 0;

  const previous = db.prepare(`
    SELECT COUNT(*) AS total
    FROM player_penalty_history
    WHERE discord_id = ?
      AND reason = 'ready_check_timeout'
      AND created_at >= ?
  `).get(
    discordId,
    Date.now() - ESCALATION_HOURS * 3600000
  ).total;

  const index = config.penalties?.progressive === false
    ? 0
    : Math.min(previous, PENALTY_LEVELS.length - 1);

  const minutes = PENALTY_LEVELS[index];
  const expiresAt = Date.now() + minutes * 60000;

  db.prepare(`
    INSERT INTO player_penalty_history (
      discord_id, reason, duration_seconds,
      session_id, created_at
    )
    VALUES (?, 'ready_check_timeout', ?, ?, ?)
  `).run(
    discordId,
    minutes * 60,
    sessionId,
    Date.now()
  );

  db.prepare(`
    INSERT INTO player_cooldowns (
      discord_id, reason, expires_at, created_at
    )
    VALUES (?, 'ready_check_timeout', ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      reason = excluded.reason,
      expires_at = MAX(
        player_cooldowns.expires_at,
        excluded.expires_at
      )
  `).run(discordId, expiresAt, Date.now());

  return minutes;
}

// ==========================================
// INICIAR READY CHECK
// ==========================================

async function startReadyCheck(interaction, selectedPlayers) {
  if (active) {
    throw new Error("READY_CHECK_ALREADY_ACTIVE");
  }

  if (
    !Array.isArray(selectedPlayers) ||
    selectedPlayers.length !==
      config.matchmaking.requiredPlayers ||
    new Set(selectedPlayers.map(p => p.discordId)).size !==
      selectedPlayers.length
  ) {
    throw new Error("INVALID_READY_CHECK_PLAYERS");
  }

  const current = session();

  if (!current) {
    throw new Error("READY_CHECK_SESSION_NOT_FOUND");
  }

  players = [...selectedPlayers];
  confirmed = new Set();
  sessionId = current.id;
  client = interaction.client;
  active = true;
  finishing = false;
  deadline = Date.now() + READY_SECONDS * 1000;

  db.transaction(() => {
    db.prepare(`
      UPDATE matchmaking_session_players
      SET ready_confirmed = 0
      WHERE session_id = ?
    `).run(sessionId);

    db.prepare(`
      UPDATE matchmaking_sessions
      SET stage = 'ready_check',
          deadline_at = ?,
          state_json = '{}',
          updated_at = ?
      WHERE id = ?
    `).run(
      deadline,
      Date.now(),
      sessionId
    );
  })();

  try {
    message = await interaction.followUp({
      ...panel(),
      fetchReply: true
    });

    saveState();
    scheduleTimeout();
  } catch (error) {
    resetReadyCheck();
    throw error;
  }
}

// ==========================================
// CONFIRMAR PRESENÇA
// ==========================================

async function handleReadyCheck(interaction) {
  const current = session();

  if (
    !active ||
    finishing ||
    !current ||
    current.id !== sessionId ||
    current.stage !== "ready_check"
  ) {
    return interaction.reply({
      content: "Não existe um Ready Check ativo.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (Date.now() >= deadline) {
    await interaction.reply({
      content: "O prazo para confirmar terminou.",
      flags: MessageFlags.Ephemeral
    });

    await handleReadyCheckTimeout();
    return;
  }

  const id = interaction.user.id;

  if (!players.some(p => p.discordId === id)) {
    return interaction.reply({
      content: "Você não participa deste Ready Check.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (confirmed.has(id)) {
    return interaction.reply({
      content: "Você já confirmou presença.",
      flags: MessageFlags.Ephemeral
    });
  }

  const result = db.prepare(`
    UPDATE matchmaking_session_players
    SET ready_confirmed = 1
    WHERE session_id = ?
      AND discord_id = ?
      AND ready_confirmed = 0
  `).run(sessionId, id);

  if (!result.changes) {
    return interaction.reply({
      content: "Sua presença já foi registrada.",
      flags: MessageFlags.Ephemeral
    });
  }

  confirmed.add(id);

  await interaction.deferUpdate();

  if (confirmed.size === players.length) {
    await finishReadyCheck(interaction);
  } else {
    await editPanel();
  }
}

// ==========================================
// FINALIZAR READY CHECK
// ==========================================

async function finishReadyCheck(interaction = null) {
  if (!active || finishing) return;

  if (confirmed.size !== players.length) return;

  finishing = true;
  clearTimer();

  const current = session();

  if (!current || current.id !== sessionId) {
    finishing = false;
    throw new Error("READY_CHECK_SESSION_LOST");
  }

  db.prepare(`
    UPDATE matchmaking_sessions
    SET stage = 'captain_vote',
        deadline_at = NULL,
        state_json = ?,
        updated_at = ?
    WHERE id = ? AND stage = 'ready_check'
  `).run(
    JSON.stringify({ readyCheckCompleted: true }),
    Date.now(),
    sessionId
  );

  await editPanel("completed");

  const context = interaction || {
    client,
    followUp: async payload => {
      const channel = await client.channels.fetch(
        message?.channelId ||
        config.discord.queueChannelId
      );
      return channel.send(payload);
    }
  };

  try {
    await startCaptainVote(context, [...players]);
    resetReadyCheck();
  } catch (error) {
    console.error(
      "Erro ao iniciar votação de capitães:",
      error
    );
    throw error;
  }
}

// ==========================================
// TIMEOUT
// ==========================================

async function handleReadyCheckTimeout() {
  if (!active || finishing) return;

  if (Date.now() < deadline) {
    scheduleTimeout();
    return;
  }

  if (confirmed.size === players.length) {
    return finishReadyCheck();
  }

  finishing = true;
  clearTimer();

  const absent = players.filter(
    p => !confirmed.has(p.discordId)
  );

  const penalties = [];

  db.transaction(() => {
    for (const player of absent) {
      const alreadyPenalized = db.prepare(`
        SELECT 1
        FROM player_penalty_history
        WHERE discord_id = ?
          AND session_id = ?
          AND reason = 'ready_check_timeout'
        LIMIT 1
      `).get(player.discordId, sessionId);

      if (!alreadyPenalized) {
        const minutes = penaltyFor(player.discordId);
        penalties.push({ player, minutes });
      }

      db.prepare(`
        DELETE FROM matchmaking_session_players
        WHERE session_id = ? AND discord_id = ?
      `).run(sessionId, player.discordId);
    }

    db.prepare(`
      UPDATE matchmaking_sessions
      SET stage = 'queue',
          deadline_at = NULL,
          state_json = '{}',
          updated_at = ?
      WHERE id = ? AND stage = 'ready_check'
    `).run(Date.now(), sessionId);
  })();

  await editPanel("cancelled");

  if (message) {
    try {
      const lines = penalties.map(
        ({ player, minutes }) =>
          `<@${player.discordId}> — ${minutes} minuto(s)`
      );

      await message.channel.send({
        content:
          "⏱️ Ready Check encerrado por falta de confirmação." +
          (lines.length
            ? "\n\n**Cooldowns aplicados:**\n" +
              lines.join("\n")
            : "")
      });
    } catch (error) {
      console.error(
        "Erro ao anunciar timeout:",
        error
      );
    }
  }

  resetReadyCheck();

  queueState.restoreQueueState();

  const { updateQueuePanel } = require("./queue");
  await updateQueuePanel();
}

// ==========================================
// RECUPERAÇÃO APÓS REINÍCIO
// ==========================================

async function restoreReadyCheck(restoredClient) {
  const current = session();

  if (!current || current.stage !== "ready_check") {
    return false;
  }

  if (active) return true;

  const rows = db.prepare(`
    SELECT sp.discord_id, sp.ready_confirmed,
           p.r6_nickname, p.r6_rank
    FROM matchmaking_session_players sp
    LEFT JOIN players p
      ON p.discord_id = sp.discord_id
    WHERE sp.session_id = ?
    ORDER BY sp.joined_at, sp.id
  `).all(current.id);

  if (!rows.length) {
    console.error(
      "Ready Check sem participantes para recuperar."
    );
    return false;
  }

  players = rows.map(row => ({
    discordId: row.discord_id,
    nickname: row.r6_nickname || row.discord_id,
    rank: row.r6_rank || "Não informado"
  }));

  confirmed = new Set(
    rows
      .filter(row => row.ready_confirmed === 1)
      .map(row => row.discord_id)
  );

  let state = {};

  try {
    state =
      JSON.parse(current.state_json || "{}")
        .readyCheck || {};
  } catch {
    state = {};
  }

  sessionId = current.id;
  client = restoredClient;
  deadline = current.deadline_at;
  active = true;
  finishing = false;

  const channel = await client.channels.fetch(
    state.channelId ||
    config.discord.queueChannelId
  );

  if (!channel?.send) {
    resetReadyCheck();
    throw new Error("READY_CHECK_CHANNEL_NOT_FOUND");
  }

  if (state.messageId && channel.messages) {
    try {
      message = await channel.messages.fetch(
        state.messageId
      );
    } catch {
      message = null;
    }
  }

  if (!message) {
    message = await channel.send(panel());
    saveState();
  } else {
    await editPanel();
  }

  if (confirmed.size === players.length) {
    await finishReadyCheck();
  } else if (!deadline || Date.now() >= deadline) {
    await handleReadyCheckTimeout();
  } else {
    scheduleTimeout();
  }

  return true;
}

// ==========================================
// CANCELAR
// ==========================================

function cancelReadyCheck() {
  if (!active) return false;

  resetReadyCheck();
  return true;
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  startReadyCheck,
  handleReadyCheck,
  handleReadyCheckTimeout,
  restoreReadyCheck,
  cancelReadyCheck,
  resetReadyCheck,
  isReadyCheckActive,
  getReadyCheckPlayers,
  getReadyPlayers
};
