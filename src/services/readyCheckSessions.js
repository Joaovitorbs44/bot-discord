// Session-specific Ready Check controller for the multi-lobby pipeline.
// Intentionally independent from the legacy src/scripts/ready.js singleton.
const db = require("../database/database");
const sessions = require("./matchmakingSessions");

function players(sessionId) {
  return db.prepare(`
    SELECT discord_id, ready_confirmed FROM matchmaking_session_players
    WHERE session_id=? ORDER BY joined_at ASC,id ASC
  `).all(sessionId);
}

function snapshot(sessionId) {
  const session = sessions.getSession(sessionId);
  if (!session) return null;
  const roster = players(session.id);
  return {
    sessionId: session.id,
    stage: session.stage,
    status: session.status,
    deadline: session.deadline_at,
    confirmed: roster.filter(p => p.ready_confirmed === 1).map(p => p.discord_id),
    waiting: roster.filter(p => p.ready_confirmed !== 1).map(p => p.discord_id),
    total: roster.length
  };
}

function setDeadline(sessionId, seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new Error("INVALID_READY_SECONDS");
  return db.transaction(() => {
    const s = sessions.getSession(sessionId);
    if (!s || s.status !== "active" || s.stage !== "ready_check") return null;
    const deadline = Date.now() + seconds * 1000;
    const result = db.prepare(`
      UPDATE matchmaking_sessions SET deadline_at=?,updated_at=?
      WHERE id=? AND stage='ready_check' AND status='active'
    `).run(deadline,Date.now(),s.id);
    return result.changes === 1 ? deadline : null;
  })();
}

function confirm(sessionId, discordId, guildId) {
  return db.transaction(() => {
    const session = sessions.getSession(sessionId);
    if (!session || session.guild_id !== guildId || session.status !== "active" ||
        session.stage !== "ready_check") return {ok:false,reason:"stale"};
    if (!session.deadline_at || Date.now() > session.deadline_at) return {ok:false,reason:"expired"};
    const result = db.prepare(`
      UPDATE matchmaking_session_players SET ready_confirmed=1
      WHERE session_id=? AND discord_id=? AND ready_confirmed=0
    `).run(session.id,discordId);
    if (result.changes !== 1) {
      const exists = db.prepare(`
        SELECT ready_confirmed FROM matchmaking_session_players
        WHERE session_id=? AND discord_id=?
      `).get(session.id,discordId);
      return {ok:false,reason:exists ? "already_confirmed" : "not_member"};
    }
    const current = snapshot(session.id);
    return {ok:true,complete:current.waiting.length === 0, snapshot:current};
  })();
}

function finishIfReady(sessionId, requiredPlayers) {
  return db.transaction(() => {
    const current = snapshot(sessionId);
    if (!current || current.stage !== "ready_check" || current.status !== "active" ||
        current.total !== requiredPlayers || current.waiting.length) return null;
    return sessions.advance(sessionId,"ready_check","captain_vote",{readyCheckCompletedAt:Date.now()});
  })();
}

function expire(sessionId) {
  return db.transaction(() => {
    const current = snapshot(sessionId);
    if (!current || current.stage !== "ready_check" || current.status !== "active" ||
        !current.deadline || Date.now() < current.deadline) return null;
    // Only marks the session cancelled. Penalties/requeue must be handled by
    // the orchestrator with idempotent action records.
    return sessions.advance(sessionId,"ready_check","cancelled",{readyCheckExpiredAt:Date.now()});
  })();
}

function recover(guildId) {
  return sessions.getActiveSessions(guildId)
    .filter(s => s.stage === "ready_check")
    .map(s => snapshot(s.id));
}

module.exports = {players,snapshot,setDeadline,confirm,finishIfReady,expire,recover};
