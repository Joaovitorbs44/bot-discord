// Session-scoped side choice; does not call the legacy singleton match creator.
const sessions=require("./matchmakingSessions");
function choose(sessionId,guildId,actorId,side){
 const db=require("../database/database");
 return db.transaction(()=>{
  const session=sessions.getSession(sessionId);
  if(!session||session.guild_id!==guildId||session.status!=="active"||session.stage!=="side_choice")
   return {ok:false,reason:"stale"};
  if(actorId!==session.captain_a_discord_id)return {ok:false,reason:"not_captain"};
  if(!["attack","defense"].includes(side))return {ok:false,reason:"invalid_side"};
  const state=sessions.parseState(session);
  if(!state.selectedMap)return {ok:false,reason:"missing_map"};
  const sideA=side==="attack"?"Ataque":"Defesa";
  const sideB=side==="attack"?"Defesa":"Ataque";
  if(state.sideA || state.sideB)return {ok:false,reason:"already_chosen"};
  const updated=sessions.updateState(sessionId,"side_choice",{sideA,sideB,sideChosenAt:Date.now()});
  return updated?{ok:true,sideA,sideB,map:state.selectedMap}:{ok:false,reason:"stale"};
 })();
}
module.exports={choose};
