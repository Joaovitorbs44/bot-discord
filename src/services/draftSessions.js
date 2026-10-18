// Independent, transactionally persisted 1-2-2-2-2-1 draft.
const db = require("../database/database");
const sessions = require("./matchmakingSessions");
const PICKS = ["A","B","B","A","A","B","B","A"];
function snapshot(sessionId) {
  const session = sessions.getSession(sessionId);
  if (!session) return null;
  const state = sessions.parseState(session);
  const roster = db.prepare("SELECT discord_id,team,is_captain FROM matchmaking_session_players WHERE session_id=? ORDER BY joined_at,id").all(sessionId);
  const picks = roster.filter(p=>p.team).length-2;
  return {session,roster,picks,turn:PICKS[picks] || null,state};
}
function pick(sessionId,guildId,actorId,targetId) {
  return db.transaction(()=>{
    const data = snapshot(sessionId);
    if (!data || data.session.guild_id !== guildId || data.session.status !== "active" || data.session.stage !== "draft")
      return {ok:false,reason:"stale"};
    if (data.roster.length !== 10 || !data.turn) return {ok:false,reason:"invalid_roster"};
    const captain = data.turn === "A" ? data.session.captain_a_discord_id : data.session.captain_b_discord_id;
    if (actorId !== captain) return {ok:false,reason:"not_your_turn"};
    const target = data.roster.find(p=>p.discord_id === targetId);
    if (!target || target.team || target.is_captain) return {ok:false,reason:"invalid_pick"};
    const updated = db.prepare("UPDATE matchmaking_session_players SET team=? WHERE session_id=? AND discord_id=? AND team IS NULL AND is_captain=0")
      .run(data.turn,sessionId,targetId);
    if (updated.changes !== 1) return {ok:false,reason:"conflict"};
    const finished = data.picks+1 === PICKS.length;
    if (finished) {
      sessions.advance(sessionId,"draft","map_veto",{draftCompletedAt:Date.now()});
    } else {
      sessions.updateState(sessionId,"draft",{draftPickIndex:data.picks+1});
    }
    return {ok:true,finished,team:data.turn,picks:data.picks+1};
  })();
}
module.exports = {PICKS,snapshot,pick};
