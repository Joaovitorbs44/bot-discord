// Independent captain-vote persistence. No singleton state.
const db = require("../database/database");
const sessions = require("./matchmakingSessions");
const RANKS = ["cobre","bronze","prata","ouro","platina","esmeralda","diamante","campeao"];
function rankIndex(value) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  return RANKS.findIndex(rank => normalized.startsWith(rank));
}
function roster(sessionId) {
  return db.prepare(`SELECT sp.discord_id, p.r6_rank
    FROM matchmaking_session_players sp
    LEFT JOIN players p ON p.discord_id=sp.discord_id
    WHERE sp.session_id=? ORDER BY sp.joined_at,sp.id`).all(sessionId);
}
function eligible(sessionId) {
  const people = roster(sessionId);
  if (people.length !== 10 || people.some(p => rankIndex(p.r6_rank)<0)) {
    throw new Error("CAPTAIN_VOTE_INVALID_ROSTER");
  }
  const ranks = [...new Set(people.map(p => rankIndex(p.r6_rank)))].sort((a,b)=>b-a);
  return people.filter(p => ranks.slice(0,2).includes(rankIndex(p.r6_rank)))
    .map(p => p.discord_id);
}
function vote(sessionId,guildId,voterId,candidateId) {
  return db.transaction(() => {
    const session = sessions.getSession(sessionId);
    if (!session || session.guild_id !== guildId ||
        session.status !== "active" || session.stage !== "captain_vote") {
      return {ok:false,reason:"stale"};
    }
    const people = roster(sessionId).map(p => p.discord_id);
    if (!people.includes(voterId)) return {ok:false,reason:"not_member"};
    if (!eligible(sessionId).includes(candidateId)) return {ok:false,reason:"not_eligible"};
    const state = sessions.parseState(session);
    const votes = state.captainVotes || {};
    if (Object.prototype.hasOwnProperty.call(votes,voterId)) {
      return {ok:false,reason:"already_voted"};
    }
    const next = {...votes,[voterId]:candidateId};
    sessions.updateState(sessionId,"captain_vote",{captainVotes:next});
    return {ok:true,count:Object.keys(next).length,total:people.length};
  })();
}
function finish(sessionId) {
  return db.transaction(() => {
    const session = sessions.getSession(sessionId);
    if (!session || session.status !== "active" || session.stage !== "captain_vote") return null;
    const people = roster(sessionId).map(p => p.discord_id);
    const state = sessions.parseState(session);
    const votes = state.captainVotes || {};
    if (people.length !== 10 || people.some(id => !Object.hasOwn(votes,id))) return null;
    const candidates = eligible(sessionId);
    const scores = new Map(candidates.map(id => [id,0]));
    for (const choice of Object.values(votes)) {
      if (!scores.has(choice)) return null;
      scores.set(choice,scores.get(choice)+1);
    }
    const ordered = candidates.sort((a,b) => scores.get(b)-scores.get(a) || a.localeCompare(b));
    if (ordered.length < 2) return null;
    const [captainA,captainB] = ordered;
    const changed = sessions.advance(sessionId,"captain_vote","draft",{
      captainA,captainB,captainVoteFinishedAt:Date.now()
    });
    if (!changed) return null;
    db.prepare(`UPDATE matchmaking_session_players
      SET is_captain=CASE WHEN discord_id IN (?,?) THEN 1 ELSE 0 END,
      team=CASE WHEN discord_id=? THEN 'A' WHEN discord_id=? THEN 'B' ELSE NULL END
      WHERE session_id=?`).run(captainA,captainB,captainA,captainB,sessionId);
    return {session:changed,captainA,captainB};
  })();
}
module.exports = {roster,eligible,vote,finish};
