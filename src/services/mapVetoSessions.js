// Persisted map veto for concurrent lobbies. Nine maps, alternating bans.
const db=require("../database/database");
const sessions=require("./matchmakingSessions");
const {MAP_POOL}=require("../scripts/mapVetoImage");
function snapshot(id){
  const session=sessions.getSession(id);
  if(!session)return null;
  const state=sessions.parseState(session);
  const banned=Array.isArray(state.bannedMaps)?state.bannedMaps:[];
  const available=MAP_POOL.filter(map=>!banned.includes(map));
  return {session,state,banned,available,turn:banned.length%2===0?"A":"B"};
}
function ban(id,guildId,actorId,map){
  return db.transaction(()=>{
    const data=snapshot(id);
    if(!data||data.session.guild_id!==guildId||data.session.status!=="active"||data.session.stage!=="map_veto")
      return {ok:false,reason:"stale"};
    const captain=data.turn==="A"?data.session.captain_a_discord_id:data.session.captain_b_discord_id;
    if(actorId!==captain)return {ok:false,reason:"not_your_turn"};
    if(!data.available.includes(map)||data.available.length<=1)return {ok:false,reason:"invalid_map"};
    const banned=[...data.banned,map];
    const remaining=MAP_POOL.filter(value=>!banned.includes(value));
    if(remaining.length===1){
      sessions.advance(id,"map_veto","side_choice",{bannedMaps:banned,selectedMap:remaining[0],vetoCompletedAt:Date.now()});
    }else sessions.updateState(id,"map_veto",{bannedMaps:banned});
    return {ok:true,finished:remaining.length===1,selectedMap:remaining.length===1?remaining[0]:null,banned};
  })();
}
module.exports={snapshot,ban};
