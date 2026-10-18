const drafts = require("./draftSessions");
const { cleanup } = require("./panelLifecycle");
const {ContainerBuilder,TextDisplayBuilder,ActionRowBuilder,StringSelectMenuBuilder,MessageFlags}=require("discord.js");
const sessions=require("./matchmakingSessions");
const veto=require("./mapVetoSessions");
const config=require("../config/config");
function render(id){
 const data=veto.snapshot(id);
 if(!data||data.session.status!=="active"||data.session.stage!=="map_veto")return null;
 const captain=data.turn==="A"?data.session.captain_a_discord_id:data.session.captain_b_discord_id;
 const container=new ContainerBuilder().setAccentColor(0xFF3D2C)
  .addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## Lobby #${id} · Veto de mapas\n**Draft concluído:** ${(drafts.snapshot(id)?.roster || []).map(player => `<@${player.discord_id}>`).join(" ")}\n**Capitão da vez:** <@${captain}> (Time ${data.turn})\n**Banidos:** ${data.banned.join(", ")||"Nenhum"}\n**Disponíveis:** ${data.available.join(", ")}`
  ))
  .addActionRowComponents(new ActionRowBuilder().addComponents(
   new StringSelectMenuBuilder().setCustomId(sessions.componentId("map_veto",id,"ban"))
    .setPlaceholder("Banir mapa")
    .addOptions(data.available.map(map=>({label:map,value:map})))
  ));
 return {components:[container],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
async function publish(client,id){
 const session=sessions.getSession(id),payload=render(id);
 if(!payload)return null;
 const state=sessions.parseState(session);
 const channelId=state.mapVetoPanel?.channelId||config.discord.mapVetoChannelId;
 const channel=await client.channels.fetch(channelId);
 if(!channel?.isTextBased()||!channel.send)throw new Error("MAP_VETO_CHANNEL_UNAVAILABLE");
 let message=null;
 if(state.mapVetoPanel?.messageId){
  try{message=await channel.messages.fetch(state.mapVetoPanel.messageId);}catch{}
 }
 if(message)await message.edit(payload);
 else{
  message=await channel.send({ ...payload, allowedMentions: { parse: [], users: (drafts.snapshot(id)?.roster || []).map(player => player.discord_id) } });
  sessions.updateState(id,"map_veto",{mapVetoPanel:{channelId:channel.id,messageId:message.id}});
 }
  await cleanup(client, state, ["readyCheckPanel", "captainVotePanel", "draftPanel"]);
 return message;
}
async function recover(client,guildId){
 const ids=[];
 for(const session of sessions.getActiveSessions(guildId).filter(s=>s.stage==="map_veto")){
  try{await publish(client,session.id);ids.push(session.id);}
  catch(error){console.error("[MULTILOBBY] Map veto recovery failed:",session.id,error);}
 }
 return ids;
}
module.exports={render,publish,recover};

