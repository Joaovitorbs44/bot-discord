// Persistent waiting queue for the multi-lobby migration.
// This repository is intentionally NOT wired into the legacy single-session flow yet.
const db = require("../database/database");

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matchmaking_waiting_players (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, discord_id)
    );
    CREATE INDEX IF NOT EXISTS idx_matchmaking_waiting_order
      ON matchmaking_waiting_players(guild_id, joined_at, discord_id);
  `);
}

function playerBusy(guildId, discordId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM matchmaking_session_players sp
    JOIN matchmaking_sessions s ON s.id = sp.session_id
    WHERE s.guild_id = ? AND s.status = 'active'
      AND s.stage <> 'queue' AND sp.discord_id = ?
    LIMIT 1
  `).get(guildId, discordId)) ||
    Boolean(db.prepare(`
      SELECT 1 FROM match_players mp
      JOIN matches m ON m.id = mp.match_id
      WHERE mp.discord_id = ?
        AND m.status IN ('playing', 'pending_confirmation', 'disputed')
      LIMIT 1
    `).get(discordId));
}

function enqueue(guildId, discordId) {
  ensureTables();
  return db.transaction(() => {
    if (playerBusy(guildId, discordId)) return false;
    return db.prepare(`
      INSERT OR IGNORE INTO matchmaking_waiting_players(guild_id,discord_id,joined_at)
      VALUES(?,?,?)
    `).run(guildId, discordId, Date.now()).changes === 1;
  })();
}

function dequeue(guildId, discordId) {
  ensureTables();
  return db.prepare(`
    DELETE FROM matchmaking_waiting_players WHERE guild_id=? AND discord_id=?
  `).run(guildId, discordId).changes === 1;
}

function listWaiting(guildId) {
  ensureTables();
  return db.prepare(`
    SELECT discord_id, joined_at FROM matchmaking_waiting_players
    WHERE guild_id=? ORDER BY joined_at ASC, discord_id ASC
  `).all(guildId);
}

// Reserve ten players atomically, without changing the current singleton session.
// Once the per-session controllers are ready, this becomes the handoff boundary.
function reserveGroup(guildId, count = 10) {
  ensureTables();
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("Invalid group size");
  return db.transaction(() => {
    const rows = db.prepare(`
      SELECT discord_id FROM matchmaking_waiting_players
      WHERE guild_id=? ORDER BY joined_at ASC, discord_id ASC LIMIT ?
    `).all(guildId, count);
    if (rows.length !== count) return null;
    if (rows.some(row => playerBusy(guildId, row.discord_id))) {
      // Busy players cannot be reserved; leave the queue unchanged for reconciliation.
      return null;
    }
    const remove = db.prepare(`
      DELETE FROM matchmaking_waiting_players WHERE guild_id=? AND discord_id=?
    `);
    for (const row of rows) {
      if (remove.run(guildId, row.discord_id).changes !== 1) {
        throw new Error("QUEUE_RESERVATION_CONFLICT");
      }
    }
    return rows.map(row => row.discord_id);
  })();
}

function restoreGroup(guildId, discordIds) {
  ensureTables();
  return db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO matchmaking_waiting_players(guild_id,discord_id,joined_at)
      VALUES(?,?,?)
    `);
    for (const id of discordIds) {
      if (!playerBusy(guildId, id)) insert.run(guildId, id, Date.now());
    }
  })();
}

module.exports = {ensureTables, playerBusy, enqueue, dequeue, listWaiting, reserveGroup, restoreGroup};
