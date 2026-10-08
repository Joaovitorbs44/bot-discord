const db = require("../database/database");
const config = require("../config/config");

// ==========================================
// ESTADO EM MEMÓRIA
// ==========================================

const queue = new Map();
const cooldowns = new Map();

let queueMessage = null;
let queueLocked = false;

// ==========================================
// CONFIGURAÇÃO
// ==========================================

function getGuildId() {
  return config.discord.guildId;
}

// ==========================================
// SESSÃO PERSISTENTE
// ==========================================

function getActiveSession() {
  return db.prepare(`
    SELECT *
    FROM matchmaking_sessions
    WHERE guild_id = ?
      AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
  `).get(getGuildId()) || null;
}

function getOrCreateSession() {
  const existing = getActiveSession();

  if (existing) {
    return existing;
  }

  db.prepare(`
    INSERT INTO matchmaking_sessions (
      guild_id,
      channel_id,
      stage,
      status,
      state_json
    )
    VALUES (?, ?, 'queue', 'active', '{}')
  `).run(
    getGuildId(),
    config.discord.queueChannelId
  );

  return getActiveSession();
}

function updateSession(fields = {}) {
  const session = getOrCreateSession();

  const allowed = [
    "channel_id",
    "message_id",
    "stage",
    "status",
    "captain_a_discord_id",
    "captain_b_discord_id",
    "current_turn_discord_id",
    "deadline_at",
    "state_json",
    "match_id"
  ];

  const entries = Object.entries(fields)
    .filter(([key]) => allowed.includes(key));

  if (!entries.length) {
    return session;
  }

  const assignments = entries
    .map(([key]) => `${key} = ?`)
    .join(", ");

  const values = entries.map(
    ([, value]) => value
  );

  db.prepare(`
    UPDATE matchmaking_sessions
    SET ${assignments},
        updated_at = ?
    WHERE id = ?
  `).run(
    ...values,
    Date.now(),
    session.id
  );

  return getActiveSession();
}

// ==========================================
// RESTAURAÇÃO DA FILA
// ==========================================

function restoreQueueState() {
  queue.clear();

  const session = getActiveSession();

  if (!session) {
    queueLocked = false;

    console.log(
      "Nenhuma sessão anterior encontrada."
    );

    return {
      restored: 0,
      locked: false,
      stage: "queue"
    };
  }

  const rows = db.prepare(`
    SELECT
      sp.discord_id,
      p.r6_nickname,
      p.r6_rank
    FROM matchmaking_session_players sp
    LEFT JOIN players p
      ON p.discord_id = sp.discord_id
    WHERE sp.session_id = ?
    ORDER BY sp.joined_at ASC, sp.id ASC
  `).all(session.id);

  for (const row of rows) {
    queue.set(row.discord_id, {
      discordId: row.discord_id,
      nickname:
        row.r6_nickname || row.discord_id,
      rank:
        row.r6_rank || "Não informado"
    });
  }

  queueLocked = session.stage !== "queue";

  console.log(
    `Fila recuperada: ${queue.size} jogadores. Etapa: ${session.stage}.`
  );

  return {
    restored: queue.size,
    locked: queueLocked,
    stage: session.stage,
    sessionId: session.id
  };
}

// ==========================================
// ADICIONAR JOGADOR
// ==========================================

function addPlayer(player) {
  if (
    !player ||
    !player.discordId ||
    queue.has(player.discordId) ||
    isQueueLocked()
  ) {
    return false;
  }

  const session = getOrCreateSession();

  if (session.stage !== "queue") {
    return false;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO
      matchmaking_session_players (
        session_id,
        discord_id
      )
    VALUES (?, ?)
  `).run(
    session.id,
    player.discordId
  );

  if (insert.changes === 0) {
    return false;
  }

  queue.set(player.discordId, player);

  return true;
}

// ==========================================
// REMOVER JOGADOR
// ==========================================

function removePlayer(discordId) {
  const session = getActiveSession();

  if (session) {
    db.prepare(`
      DELETE FROM matchmaking_session_players
      WHERE session_id = ?
        AND discord_id = ?
    `).run(
      session.id,
      discordId
    );
  }

  return queue.delete(discordId);
}

// ==========================================
// REMOVER VÁRIOS
// =================================
