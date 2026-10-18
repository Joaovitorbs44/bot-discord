
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

function session() {
  return queueState.getActiveSession();
}

function parseState(raw) {
  try {
    const value = JSON.parse(raw || "{}");

    return value &&
      typeof value === "object" &&
      !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
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

function safeText(value, fallback = "Não informado") {
  return String(value || fallback)
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, 80);
}

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
        const isConfirmed = confirmed.has(
          player.discordId
        );

        return (
          `**${String(index + 1).padStart(2, "0")}.** ` +
          `<@${player.discordId}> · ` +
          `${safeText(player.nickname)}\n` +
          `-# ${
            isConfirmed
              ? "✅ Confirmado"
              : "⏳ Aguardando confirmação"
          }`
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
      done
        ? ButtonStyle.Secondary
        : ButtonStyle.Success
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

function saveState() {
  const current = session();

  if (
    !current ||
    current.id !== sessionId ||
    current.stage !== "ready_check"
  ) {
    return false;
  }

  const state = parseState(current.state_json);

  state.readyCheck = {
    messageId: message?.id || null,
    channelId:
      message?.channelId ||
      config.discord.queueChannelId
  };

  const result = db.prepare(`
    UPDATE matchmaking_sessions
    SET state_json = ?,
        deadline_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'active'
      AND stage = 'ready_check'
  `).run(
    JSON.stringify(state),
    deadline,
    Date.now(),
    sessionId
  );

  return result.changes === 1;
}

function scheduleTimeout() {
  clearTimer();

  if (!active || finishing || !deadline) {
    return;
  }

  timer = setTimeout(() => {
    handleReadyCheckTimeout().catch(error => {
      console.error(
        "[READY] Erro no timeout:",
        error
      );
    });
  }, Math.max(0, deadline - Date.now()));
}

async function editPanel(status = "active") {
  if (!message) return false;

  try {
    await message.edit(panel(status));
    return true;
  } catch (error) {
    console.error(
      "[READY] Erro ao atualizar painel:",
      error
    );

    return false;
  }
}

async function deleteTemporaryMessage(target) {
  if (!target) return false;

  try {
    if (
      target.author?.id &&
      client?.user?.id &&
      target.author.id !== client.user.id
    ) {
      return false;
    }

    await target.delete();
    return true;
  } catch (error) {
    console.warn(
      "[READY] Não foi possível excluir mensagem temporária:",
      error.message
    );

    return false;
  }
}

function penaltyFor(discordId) {
  if (config.penalties?.enabled === false) {
    return 0;
  }

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

  const index =
    config.penalties?.progressive === false
      ? 0
      : Math.min(
          previous,
          PENALTY_LEVELS.length - 1
        );

  const minutes = PENALTY_LEVELS[index];
  const expiresAt =
    Date.now() + minutes * 60000;

  db.prepare(`
    INSERT INTO player_penalty_history (
      discord_id,
      reason,
      duration_seconds,
      session_id,
      created_at
    )
    VALUES (
      ?,
      'ready_check_timeout',
      ?,
      ?,
      ?
    )
  `).run(
    discordId,
    minutes * 60,
    sessionId,
    Date.now()
  );

  db.prepare(`
    INSERT INTO player_cooldowns (
      discord_id,
      reason,
      expires_at,
      created_at
    )
    VALUES (
      ?,
      'ready_check_timeout',
      ?,
      ?
    )
    ON CONFLICT(discord_id) DO UPDATE SET
      reason = excluded.reason,
      expires_at = MAX(
        player_cooldowns.expires_at,
        excluded.expires_at
      )
  `).run(
    discordId,
    expiresAt,
    Date.now()
  );

  return minutes;
}

async function startReadyCheck(
  interaction,
  selectedPlayers
) {
  if (active) {
    throw new Error(
      "READY_CHECK_ALREADY_ACTIVE"
    );
  }

  if (
    !Array.isArray(selectedPlayers) ||
    selectedPlayers.length !==
      config.matchmaking.requiredPlayers ||
    selectedPlayers.some(
      player => !player?.discordId
    ) ||
    new Set(
      selectedPlayers.map(
        player => player.discordId
      )
    ).size !== selectedPlayers.length
  ) {
    throw new Error(
      "INVALID_READY_CHECK_PLAYERS"
    );
  }

  const current = session();

  if (!current) {
    throw new Error(
      "READY_CHECK_SESSION_NOT_FOUND"
    );
  }

  if (!interaction?.client) {
    throw new Error(
      "READY_CHECK_CLIENT_UNAVAILABLE"
    );
  }

  const channel = await interaction.client.channels.fetch(
    config.discord.queueChannelId
  );

  if (
    !channel?.isTextBased() ||
    !channel.send
  ) {
    throw new Error(
      "READY_CHECK_CHANNEL_UNAVAILABLE"
    );
  }

  players = [...selectedPlayers];
  confirmed = new Set();

  sessionId = current.id;
  client = interaction.client;

  active = true;
  finishing = false;

  deadline =
    Date.now() + READY_SECONDS * 1000;

  const state = parseState(
    current.state_json
  );

  state.readyCheck = {
    messageId: null,
    channelId: channel.id
  };

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE matchmaking_session_players
        SET ready_confirmed = 0
        WHERE session_id = ?
      `).run(sessionId);

      const updated = db.prepare(`
        UPDATE matchmaking_sessions
        SET stage = 'ready_check',
            deadline_at = ?,
            state_json = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'active'
          AND stage IN ('queue', 'ready_check')
      `).run(
        deadline,
        JSON.stringify(state),
        Date.now(),
        sessionId
      );

      if (updated.changes !== 1) {
        throw new Error(
          "READY_CHECK_TRANSITION_FAILED"
        );
      }
    })();

    message = await channel.send(
      panel()
    );

    saveState();
    scheduleTimeout();

    console.log(
      `[READY] Ready Check iniciado: ` +
      `${sessionId}`
    );

    return message;
  } catch (error) {
    console.error(
      "[READY] Erro ao iniciar:",
      error
    );

    // Se a etapa foi persistida, o bot poderá
    // recuperá-la depois de reiniciar.
    resetReadyCheck();
    throw error;
  }
}

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
      content:
        "Não existe um Ready Check ativo.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (Date.now() >= deadline) {
    await interaction.reply({
      content:
        "O prazo para confirmar terminou.",
      flags: MessageFlags.Ephemeral
    });

    await handleReadyCheckTimeout();
    return;
  }

  const id = interaction.user.id;

  if (
    !players.some(
      player => player.discordId === id
    )
  ) {
    return interaction.reply({
      content:
        "Você não participa deste Ready Check.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (confirmed.has(id)) {
    return interaction.reply({
      content:
        "Você já confirmou presença.",
      flags: MessageFlags.Ephemeral
    });
  }

  const result = db.prepare(`
    UPDATE matchmaking_session_players
    SET ready_confirmed = 1
    WHERE session_id = ?
      AND discord_id = ?
      AND ready_confirmed = 0
  `).run(
    sessionId,
    id
  );

  if (!result.changes) {
    return interaction.reply({
      content:
        "Sua presença já foi registrada.",
      flags: MessageFlags.Ephemeral
    });
  }

  confirmed.add(id);

  await interaction.deferUpdate();

  if (confirmed.size === players.length) {
    await finishReadyCheck();
  } else {
    await editPanel();
  }
}

async function finishReadyCheck() {
  if (!active || finishing) {
    return false;
  }

  if (confirmed.size !== players.length) {
    return false;
  }

  finishing = true;
  clearTimer();

  const current = session();

  if (
    !current ||
    current.id !== sessionId ||
    current.stage !== "ready_check"
  ) {
    finishing = false;

    throw new Error(
      "READY_CHECK_SESSION_LOST"
    );
  }

  const oldMessage = message;
  const selectedPlayers = [...players];

  const context = {
    client,
    followUp: async payload => {
      const channel = await client.channels.fetch(
        config.discord.draftChannelId
      );

      if (!channel?.send) {
        throw new Error(
          "READY_CHECK_DRAFT_CHANNEL_UNAVAILABLE"
        );
      }

      return channel.send(payload);
    }
  };

  try {
    // O módulo captains.js faz a transição
    // para captain_vote e publica o painel
    // no canal de pick de players.
    await startCaptainVote(
      context,
      selectedPlayers
    );

    // Só remove o painel anterior depois
    // que a votação foi publicada.
    await deleteTemporaryMessage(oldMessage);

    console.log(
      "[READY] Ready Check concluído. " +
      "Votação publicada no canal de draft."
    );

    resetReadyCheck();
    return true;
  } catch (error) {
    console.error(
      "[READY] Falha ao iniciar votação:",
      error
    );

    // Se a transição já foi persistida,
    // não reabre o Ready Check.
    const latest = session();

    if (
      latest?.id === sessionId &&
      latest.stage === "captain_vote"
    ) {
      resetReadyCheck();
    } else {
      finishing = false;
      scheduleTimeout();
    }

    throw error;
  }
}

async function handleReadyCheckTimeout() {
  if (!active || finishing) {
    return;
  }

  if (Date.now() < deadline) {
    scheduleTimeout();
    return;
  }

  if (confirmed.size === players.length) {
    await finishReadyCheck();
    return;
  }

  finishing = true;
  clearTimer();

  const absent = players.filter(
    player => !confirmed.has(player.discordId)
  );

  const penalties = [];

  const current = session();

  if (
    !current ||
    current.id !== sessionId ||
    current.stage !== "ready_check"
  ) {
    resetReadyCheck();
    return;
  }

  const state = parseState(
    current.state_json
  );

  state.readyCheckCancelled = true;

  try {
    db.transaction(() => {
      for (const player of absent) {
        const alreadyPenalized = db.prepare(`
          SELECT 1
          FROM player_penalty_history
          WHERE discord_id = ?
            AND session_id = ?
            AND reason = 'ready_check_timeout'
          LIMIT 1
        `).get(
          player.discordId,
          sessionId
        );

        if (!alreadyPenalized) {
          const minutes = penaltyFor(
            player.discordId
          );

          penalties.push({
            player,
            minutes
          });
        }

        db.prepare(`
          DELETE FROM matchmaking_session_players
          WHERE session_id = ?
            AND discord_id = ?
        `).run(
          sessionId,
          player.discordId
        );
      }

      const updated = db.prepare(`
        UPDATE matchmaking_sessions
        SET stage = 'queue',
            deadline_at = NULL,
            state_json = ?,
            updated_at = ?
        WHERE id = ?
          AND stage = 'ready_check'
      `).run(
        JSON.stringify(state),
        Date.now(),
        sessionId
      );

      if (updated.changes !== 1) {
        throw new Error(
          "READY_CHECK_TIMEOUT_TRANSITION_FAILED"
        );
      }
    })();
  } catch (error) {
    finishing = false;

    console.error(
      "[READY] Falha ao processar timeout:",
      error
    );

    throw error;
  }

  await editPanel("cancelled");

  if (message) {
    try {
      const lines = penalties.map(
        ({ player, minutes }) =>
          `<@${player.discordId}> — ` +
          `${minutes} minuto(s)`
      );

      await message.channel.send({
        content:
          "⏱️ Ready Check encerrado por falta de confirmação." +
          (
            lines.length
              ? "\n\n**Cooldowns aplicados:**\n" +
                lines.join("\n")
              : ""
          ),
        allowedMentions: {
          parse: []
        }
      });
    } catch (error) {
      console.error(
        "[READY] Erro ao anunciar timeout:",
        error
      );
    }
  }

  const oldMessage = message;

  resetReadyCheck();

  queueState.restoreQueueState();

  const { updateQueuePanel } = require("./queue");

  await updateQueuePanel();

  // O aviso de penalidade permanece visível.
  // Apenas o painel interativo encerrado
  // é removido.
  await deleteTemporaryMessage(oldMessage);

  console.log(
    "[READY] Timeout concluído. " +
    "Fila restaurada."
  );
}

async function restoreReadyCheck(restoredClient) {
  const current = session();

  if (
    !current ||
    current.stage !== "ready_check"
  ) {
    return false;
  }

  if (active) {
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
  `).all(current.id);

  if (!rows.length) {
    console.error(
      "[READY] Sessão sem jogadores."
    );

    return false;
  }

  players = rows.map(row => ({
    discordId: row.discord_id,
    nickname:
      row.r6_nickname || row.discord_id,
    rank:
      row.r6_rank || "Não informado"
  }));

  confirmed = new Set(
    rows
      .filter(row => row.ready_confirmed === 1)
      .map(row => row.discord_id)
  );

  const state = parseState(
    current.state_json
  );

  const saved = state.readyCheck || {};

  sessionId = current.id;
  client = restoredClient;
  deadline = current.deadline_at;

  active = true;
  finishing = false;

  const channel = await client.channels.fetch(
    saved.channelId ||
    config.discord.queueChannelId
  );

  if (
    !channel?.isTextBased() ||
    !channel.send
  ) {
    resetReadyCheck();

    throw new Error(
      "READY_CHECK_CHANNEL_NOT_FOUND"
    );
  }

  if (
    saved.messageId &&
    channel.messages
  ) {
    try {
      message = await channel.messages.fetch(
        saved.messageId
      );
    } catch {
      message = null;
    }
  }

  if (!message) {
    message = await channel.send(
      panel()
    );

    saveState();
  } else {
    await editPanel();
  }

  if (confirmed.size === players.length) {
    await finishReadyCheck();
  } else if (
    !deadline ||
    Date.now() >= deadline
  ) {
    await handleReadyCheckTimeout();
  } else {
    scheduleTimeout();
  }

  console.log(
    `[READY] Recuperado: ` +
    `${confirmed.size}/${players.length}`
  );

  return true;
}

function cancelReadyCheck() {
  if (!active) {
    return false;
  }

  resetReadyCheck();
  return true;
}

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
