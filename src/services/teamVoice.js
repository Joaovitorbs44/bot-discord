const {ChannelType,PermissionFlagsBits}=require('discord.js');
const db=require('../database/database');
const config=require('../config/config');
const rooms={A:'1555960315835842600',B:'1555960732234027170'};
const pending=new Map();
function canUse(channel,me){const p=channel.permissionsFor(me);return Boolean(p?.has(PermissionFlagsBits.ViewChannel)&&p.has(PermissionFlagsBits.Connect)&&p.has(PermissionFlagsBits.MoveMembers));}
async function ensure(client,sessionId,moveMembers=true){
 if(pending.has(sessionId))return pending.get(sessionId);
 const job=assign(client,sessionId,moveMembers);pending.set(sessionId,job);
 try{return await job;}finally{pending.delete(sessionId);}
}
async function assign(client,sessionId,moveMembers){
 const s=db.prepare('SELECT * FROM matchmaking_sessions WHERE id=? AND guild_id=?').get(sessionId,config.discord.guildId);
 if(!s||!['map_veto','side_choice','playing'].includes(s.stage)||s.status==='cancelled')throw new Error('As salas ficam disponíveis após a escolha completa dos times.');
 if(s.match_id){const m=db.prepare('SELECT status FROM matches WHERE id=?').get(s.match_id);if(!m||!['playing','pending_confirmation','disputed'].includes(m.status))throw new Error('Esta partida já foi encerrada.');}
 const roster=db.prepare('SELECT sp.discord_id,sp.team,p.r6_nickname FROM matchmaking_session_players sp LEFT JOIN players p ON p.discord_id=sp.discord_id WHERE sp.session_id=?').all(sessionId);
 if(roster.length!==10||['A','B'].some(t=>roster.filter(p=>p.team===t).length!==5))throw new Error('Os dois times ainda não estão completos.');
 const guild=await client.guilds.fetch(s.guild_id),me=await guild.members.fetchMe(),channels={};
 for(const team of ['A','B']){
  const c=await guild.channels.fetch(rooms[team]);
  if(c?.type!==ChannelType.GuildVoice||c.guildId!==guild.id)throw new Error('Uma das salas fixas de voz não está disponível neste servidor.');
  if(!canUse(c,me))throw new Error(`Ative Ver canal, Conectar e Mover membros para o bot na sala ${team==='A'?'Time Azul':'Time Laranja'}.`);
  channels[team]=c;
 }
 // Claim the fixed pair before moving anyone. Concurrent lobbies must not mix.
 db.transaction(()=>{
  const busy=db.prepare(`SELECT 1 FROM lobby_voice_channels v JOIN matchmaking_sessions s ON s.id=v.session_id LEFT JOIN matches m ON m.id=s.match_id
   WHERE v.channel_id IN (?,?) AND v.session_id<>? AND (s.status='active' OR m.status IN ('playing','pending_confirmation','disputed')) LIMIT 1`).get(rooms.A,rooms.B,sessionId);
  if(busy)throw new Error('As salas de voz estão em uso por outro lobby. Aguarde o encerramento ou procure a staff.');
  for(const team of ['A','B'])db.prepare('INSERT INTO lobby_voice_channels VALUES(?,?,?) ON CONFLICT(session_id,team) DO UPDATE SET channel_id=excluded.channel_id').run(sessionId,team,rooms[team]);
 })();
 const results=[];
 for(const team of ['A','B']){
  const players=roster.filter(p=>p.team===team),captain=players.find(p=>p.discord_id===(team==='A'?s.captain_a_discord_id:s.captain_b_discord_id));
  let moved=0,failed=0;
  for(const p of (moveMembers?players:[])){
   try{const member=await guild.members.fetch(p.discord_id);if(member.voice.channelId&&member.voice.channelId!==rooms[team]){await member.voice.setChannel(channels[team],'Times definidos no draft');moved++;}}catch{failed++;}
  }
  results.push({team,teamName:captain?.r6_nickname||'Capitão',channelId:rooms[team],moved,failed});
 }
 return results;
}
async function cleanup(){
 // Only release assignments. These permanent user-provided channels are never deleted.
 db.prepare(`DELETE FROM lobby_voice_channels WHERE session_id IN (SELECT s.id FROM matchmaking_sessions s LEFT JOIN matches m ON m.id=s.match_id WHERE s.status='cancelled' OR m.status IN ('finished','cancelled'))`).run();
}
async function afterDraft(client,sessionId){try{await ensure(client,sessionId);}catch(error){console.warn('[VOICE] Lobby',sessionId,error.message);}}
async function recover(client){
 const guild=await client.guilds.fetch(config.discord.guildId),me=await guild.members.fetchMe();
 for(const [team,id] of Object.entries(rooms)){
  try{const c=await guild.channels.fetch(id);console.log('[VOICE] Sala fixa:',team,id,JSON.stringify({available:c?.type===ChannelType.GuildVoice,permissions:c?canUse(c,me):false}));}catch(error){console.warn('[VOICE] Sala fixa indisponível:',id,error.code||error.message);}
 }
 const rows=db.prepare("SELECT s.id FROM matchmaking_sessions s LEFT JOIN matches m ON m.id=s.match_id WHERE s.guild_id=? AND ((s.status='active' AND s.stage IN ('map_veto','side_choice')) OR (s.stage='playing' AND m.status IN ('playing','pending_confirmation','disputed')))").all(config.discord.guildId);
 await cleanup();
 for(const s of rows)try{await ensure(client,s.id,false);}catch(error){console.warn('[VOICE] Recuperação do lobby',s.id,error.message);}
}
module.exports={ensure,afterDraft,recover,cleanup};
