// Atomically create a match for one multi-lobby session.
const db=require("../database/database");
const sessions=require("./matchmakingSessions");
const {refreshSeason}=require("./seasonService");
const {generateMatchCode,validateMatchData,publishMatch}=require("../scripts/match");
function matchData(sessionId){
 const session=sessions.getSession(sessionId);
 if(!session)return null;
 const state=sessions.parseState(session);
 const rows=db.prepare(`SELECT sp.discord_id,sp.team,p.r6_nickname
 FROM matchmaking_session_players sp LEFT JOIN players p ON p.discord_id=sp.discord_id
 WHERE sp.session_id=? ORDER BY sp.joined_at,sp.id`).all(sessionId);
 const toPlayer=p=>({discordId:p.discord_id,nickname:p.r6_nickname||p.discord_id});
 const teamA=rows.filter(p=>p.team==="A").map(toPlayer);
 const teamB=rows.filter(p=>p.team==="B").map(toPlayer);
 return {map:state.selectedMap,sideA:state.sideA,sideB:state.sideB,
  captainA:{discordId:session.captain_a_discord_id},
  captainB:{discordId:session.captain_b_discord_id},teamA,teamB};
}
function create(sessionId){
 const data=matchData(sessionId);
 if(!data)throw new Error("MATCH_SESSION_NOT_FOUND");
 validateMatchData(data);
 const season=refreshSeason()?.season;
 if(!season)throw new Error("ACTIVE_SEASON_NOT_FOUND");
 const result=db.transaction(()=>{
  const session=sessions.getSession(sessionId);
  if(!session)throw new Error("MATCH_SESSION_NOT_FOUND");
  if(session.match_id){
   const previous=db.prepare("SELECT id,match_code FROM matches WHERE id=?").get(session.match_id);
   if(previous)return {matchId:previous.id,matchCode:previous.match_code,alreadyCreated:true};
  }
  if(session.stage!=="side_choice"||session.status!=="active")throw new Error("MATCH_SESSION_NOT_READY");
  const code=generateMatchCode();
  const insert=db.prepare(`INSERT INTO matches
    (match_code,season_id,map,captain_a_discord_id,captain_b_discord_id,side_a,side_b,status)
    VALUES(?,?,?,?,?,?,?,'playing')`).run(code,season.id,data.map,data.captainA.discordId,data.captainB.discordId,data.sideA,data.sideB);
  const matchId=Number(insert.lastInsertRowid);
  const add=db.prepare("INSERT INTO match_players(match_id,discord_id,team,is_captain) VALUES(?,?,?,?)");
  for(const player of data.teamA)add.run(matchId,player.discordId,"A",Number(player.discordId===data.captainA.discordId));
  for(const player of data.teamB)add.run(matchId,player.discordId,"B",Number(player.discordId===data.captainB.discordId));
  const state=sessions.parseState(session);
  state.createdMatchId=matchId;
  state.createdMatchCode=code;
  state.sideChoice={...data};
  const changed=db.prepare(`UPDATE matchmaking_sessions SET stage='playing',status='completed',
   match_id=?,state_json=?,deadline_at=NULL,current_turn_discord_id=NULL,updated_at=?
   WHERE id=? AND status='active' AND stage='side_choice'`)
   .run(matchId,JSON.stringify(state),Date.now(),sessionId);
  if(changed.changes!==1)throw new Error("MATCH_SESSION_TRANSITION_FAILED");
  return {matchId,matchCode:code,alreadyCreated:false};
 })();
 return {...result,data,season};
}
async function createAndPublish(client,sessionId){
 const result=create(sessionId);
 await publishMatch(client,result,result.data,result.season,sessionId);
 return result;
}
module.exports={matchData,create,createAndPublish};
