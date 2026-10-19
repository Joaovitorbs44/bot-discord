const {ChannelType,PermissionFlagsBits}=require('discord.js');
const db=require('../database/database');
const config=require('../config/config');
const pending=new Map();
async function ensure(client,sessionId,moveMembers=true){
 if(pending.has(sessionId))return pending.get(sessionId);
 const job=create(client,sessionId,moveMembers);pending.set(sessionId,job);
 try{return await job;}finally{pending.delete(sessionId);}
}
async function create(client,sessionId,moveMembers){
 const s=db.prepare('SELECT * FROM matchmaking_sessions WHERE id=? AND guild_id=?').get(sessionId,config.discord.guildId);
 if(!s||!['map_veto','side_choice','playing'].includes(s.stage)||s.status==='cancelled')throw new Error('As salas ficam disponíveis após a escolha completa dos times.');
 if(s.match_id){const m=db.prepare('SELECT status FROM matches WHERE id=?').get(s.match_id);if(!m||!['playing','pending_confirmation','disputed'].includes(m.status))throw new Error('Esta partida já foi encerrada.');}
 const roster=db.prepare('SELECT sp.discord_id,sp.team,p.r6_nickname FROM matchmaking_session_players sp LEFT JOIN players p ON p.discord_id=sp.discord_id WHERE sp.session_id=?').all(sessionId);
 if(roster.length!==10||roster.some(p=>!['A','B'].includes(p.team)))throw new Error('Os dois times ainda não estão completos.');
 const guild=await client.guilds.fetch(s.guild_id);
 const me=await guild.members.fetchMe();
 if(!me.permissions.has(PermissionFlagsBits.ManageChannels)||!me.permissions.has(PermissionFlagsBits.MoveMembers))throw new Error('O bot precisa de Gerenciar canais e Mover membros para criar as salas e mover os jogadores.');
 let parent=null;
 if(process.env.TEAM_VOICE_CATEGORY_ID){const category=await guild.channels.fetch(process.env.TEAM_VOICE_CATEGORY_ID);if(category?.type!==ChannelType.GuildCategory)throw new Error('A categoria configurada para as salas não é válida.');parent=category.id;}
 else {const queue=await guild.channels.fetch(config.discord.queueChannelId);parent=queue?.parentId||null;}
 const results=[];
 for(const team of ['A','B']){
  const players=roster.filter(p=>p.team===team),captain=players.find(p=>p.discord_id===(team==='A'?s.captain_a_discord_id:s.captain_b_discord_id));
  const name=`Lobby ${sessionId} · Time ${captain?.r6_nickname||team}`.slice(0,100);
  let saved=db.prepare('SELECT channel_id FROM lobby_voice_channels WHERE session_id=? AND team=?').get(sessionId,team),channel=null;
  if(saved)try{channel=await guild.channels.fetch(saved.channel_id);}catch{}
  if(!channel){
   // Reconcile a completed Discord creation if the process stopped before saving its ID.
   const channels=await guild.channels.fetch();
   channel=channels.find(c=>c?.type===ChannelType.GuildVoice&&c.name===name&&c.permissionOverwrites.cache.get(client.user.id)?.allow.has(PermissionFlagsBits.ManageChannels));
   if(!channel){
    const allow=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak];
    const overwrites=[{id:guild.id,deny:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect]},
      {id:client.user.id,allow:[...allow,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.MoveMembers]},
      ...players.map(p=>({id:p.discord_id,allow}))];
    if(config.discord.staffRoleId)overwrites.push({id:config.discord.staffRoleId,allow});
    channel=await guild.channels.create({name,type:ChannelType.GuildVoice,parent,permissionOverwrites:overwrites,reason:`Times do lobby ${sessionId}`});
   }
   db.prepare('INSERT INTO lobby_voice_channels VALUES(?,?,?) ON CONFLICT(session_id,team) DO UPDATE SET channel_id=excluded.channel_id').run(sessionId,team,channel.id);
  }
  let moved=0,failed=0;
  for(const p of (moveMembers?players:[])){
   try{const member=await guild.members.fetch(p.discord_id);if(member.voice.channelId&&member.voice.channelId!==channel.id){await member.voice.setChannel(channel,'Times definidos no draft');moved++;}}catch{failed++;}
  }
  results.push({team,teamName:captain?.r6_nickname||"Capitão",channelId:channel.id,moved,failed});
 }
 return results;
}
async function cleanup(client){
 const rows=db.prepare(`SELECT v.*,s.status,s.match_id,m.status AS match_status FROM lobby_voice_channels v JOIN matchmaking_sessions s ON s.id=v.session_id LEFT JOIN matches m ON m.id=s.match_id WHERE s.status='cancelled' OR m.status IN ('finished','cancelled')`).all();
 for(const row of rows){
  try{const channel=await client.channels.fetch(row.channel_id);if(channel&&channel.members.size>0)continue;if(channel)await channel.delete('Lobby encerrado; sala vazia');db.prepare('DELETE FROM lobby_voice_channels WHERE session_id=? AND team=?').run(row.session_id,row.team);}catch(error){if(error.code===10003)db.prepare('DELETE FROM lobby_voice_channels WHERE session_id=? AND team=?').run(row.session_id,row.team);else console.warn('[VOICE] Limpeza:',error.code||error.message);}
 }
}
async function afterDraft(client,sessionId){try{await ensure(client,sessionId);}catch(error){console.warn('[VOICE] Lobby',sessionId,error.message);}}
async function recover(client){
 const guild=await client.guilds.fetch(config.discord.guildId);
 const me=await guild.members.fetchMe();
 console.log("[VOICE] Permissões:",JSON.stringify({manageChannels:me.permissions.has(PermissionFlagsBits.ManageChannels),moveMembers:me.permissions.has(PermissionFlagsBits.MoveMembers),connect:me.permissions.has(PermissionFlagsBits.Connect)}));
 const rows=db.prepare("SELECT s.id FROM matchmaking_sessions s LEFT JOIN matches m ON m.id=s.match_id WHERE s.guild_id=? AND ((s.status='active' AND s.stage IN ('map_veto','side_choice')) OR (s.stage='playing' AND m.status IN ('playing','pending_confirmation','disputed')))").all(config.discord.guildId);
 for(const s of rows)try{await ensure(client,s.id,false);}catch(error){console.warn("[VOICE] Recuperação do lobby",s.id,error.message);}
 await cleanup(client);
}
module.exports={ensure,afterDraft,recover,cleanup};
