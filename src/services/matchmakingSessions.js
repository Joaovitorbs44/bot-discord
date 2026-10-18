// Session-scoped persistence and interaction routing for concurrent matchmaking.
// Not enabled in the legacy bot until its stage handlers are migrated.
const db = require("../database/database");
const STAGES = new Set(["ready_check","captain_vote","draft","map_veto","side_choice","playing","finished","cancelled"]);
const NEXT = {
  ready_check: ["captain_vote","cancelled"],
  captain_vote: ["draft","cancelled"],
  draft: ["map_veto","cancelled"],
  map_veto: ["side_choice","cancelled"],
  side_choice: ["playing","cancelled"],
  playing: ["finished","cancelled"],
  finished: [],
  cancelled: []
};
const timers = new Map();

function getSession(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) return null;
  return db.prepare("SELECT * FROM matchmaking_sessions WHERE id=?").get(Number(id)) || null;
}
function getActiveSessions(guildId) {
  return db.prepare("SELECT * FROM matchmaking_sessions WHERE guild_id=? AND status='active' AND stage <> 'queue' ORDER BY id").all(guildId);
}
function parseState(session) {
  try {
    const value = JSON.parse(session.state_json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function updateState(id, expectedStage, patch) {
  if (!STAGES.has(expectedStage) || !patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("INVALID_SESSION_STATE");
  return db.transaction(() => {
    const session = getSession(id);
    if (!session || session.status !== "active" || session.stage !== expectedStage) return null;
    const state = {...parseState(session), ...patch};
    const updated = db.prepare("UPDATE matchmaking_sessions SET state_json=?, updated_at=? WHERE id=? AND stage=? AND status='active'")
      .run(JSON.stringify(state), Date.now(), session.id, expectedStage);
    return updated.changes === 1 ? getSession(id) : null;
  })();
}
function advance(id, from, to, patch = {}) {
  if (!NEXT[from]?.includes(to)) throw new Error("INVALID_STAGE_TRANSITION");
  return db.transaction(() => {
    const session = getSession(id);
    if (!session || session.status !== "active" || session.stage !== from) return null;
    const status = to === "finished" ? "completed" : to === "cancelled" ? "cancelled" : "active";
    const state = {...parseState(session), ...patch};
    const changed = db.prepare("UPDATE matchmaking_sessions SET stage=?,status=?,state_json=?,deadline_at=NULL,updated_at=? WHERE id=? AND stage=? AND status='active'")
      .run(to, status, JSON.stringify(state), Date.now(), id, from);
    if (changed.changes !== 1) return null;
    clearTimer(id);
    return getSession(id);
  })();
}
function componentId(stage, sessionId, action) {
  if (!STAGES.has(stage) || !Number.isSafeInteger(Number(sessionId)) || !/^[a-z0-9_-]{1,35}$/.test(action)) throw new Error("INVALID_COMPONENT_ID");
  const id = "ml:" + stage + ":" + Number(sessionId) + ":" + action;
  if (id.length > 100) throw new Error("COMPONENT_ID_TOO_LONG");
  return id;
}
function parseComponentId(id) {
  const match = /^ml:([a-z_]+):([1-9]\d*):([a-z0-9_-]{1,35})$/.exec(String(id));
  if (!match || !STAGES.has(match[1])) return null;
  const sessionId = Number(match[2]);
  if (!Number.isSafeInteger(sessionId)) return null;
  return {stage:match[1], sessionId, action:match[3]};
}
function authorize(interaction) {
  const parsed = parseComponentId(interaction.customId);
  if (!parsed) return null;
  const session = getSession(parsed.sessionId);
  if (!session || session.guild_id !== interaction.guildId || session.status !== "active" || session.stage !== parsed.stage) return null;
  const member = db.prepare("SELECT 1 FROM matchmaking_session_players WHERE session_id=? AND discord_id=?").get(session.id, interaction.user.id);
  if (!member) return null;
  return {...parsed, session, state:parseState(session)};
}
function clearTimer(id) {
  const existing = timers.get(Number(id));
  if (existing) clearTimeout(existing);
  timers.delete(Number(id));
}
function scheduleTimer(id, deadline, callback) {
  clearTimer(id);
  if (!Number.isFinite(deadline) || typeof callback !== "function") throw new Error("INVALID_TIMER");
  const delay = Math.max(0, Math.min(deadline - Date.now(), 2147483647));
  const timer = setTimeout(async () => {
    timers.delete(Number(id));
    const session = getSession(id);
    if (session?.status === "active" && Number(session.deadline_at) <= Date.now()) {
      try { await callback(session); } catch (error) { console.error("[MULTILOBBY] Timer error:", error); }
    }
  }, delay);
  timers.set(Number(id), timer);
}
function clearAllTimers() { for (const id of timers.keys()) clearTimer(id); }
module.exports = {getSession,getActiveSessions,parseState,updateState,advance,componentId,parseComponentId,authorize,scheduleTimer,clearTimer,clearAllTimers};
