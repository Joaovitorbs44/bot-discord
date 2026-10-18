const {ContainerBuilder,TextDisplayBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags}=require("discord.js");
const sessions=require("./matchmakingSessions");
const config=require("../config/config");
function render(id){
 const session=sessions.getSession(id);
 if(!session||session.status!=="active"||session.stage!=="side_choice")return null;
 const state=sessions.parseState(session);
 const container=new ContainerBuilder().setAccentColor(0xFF3D2C)
  .addTextDisplayComponents(new TextDisplayBuilder().setContent(
   `## Lobby #${id} · Escolha de lados\n**Mapa:** ${state.selectedMap||"Não definido"}\n**Capitão A:** <@${session.captain_a_discord_id}>\nEscolha o lado inicial do Time A.`
  ))
  .addActionRowComponents(new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId(sessions.componentId("side_choice",id,"attack")).setLabel("Ataque").setStyle(ButtonStyle.Danger),
   new ButtonBuilder().setCustomId(sessions.componentId("side_choice",id,"defense")).setLabel("Defesa").setStyle(ButtonStyle.Primary)
  ));
 return {components:[container],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
async function publish(client,id){
 const session=sessions.getSession(id),payload=render(id);
 if(!payload)return null;
 const state=sessions.parseState(session);
 const channelId=state.sideChoicePanel?.channelId||config.discord.mapVetoChannelId;
 const channel=await client.channels.fetch(channelId);
 if(!channel?.isTextBased()||!channel.send)throw new Error("SIDE_CHOICE_CHANNEL_UNAVAILABLE");
 let message=null;
 if(state.sideChoicePanel?.messageId){
  try{message=await channel.messages.fetch(state.sideChoicePanel.messageId);}catch{}
 }
 if(message)await message.edit(payload);
 else{
  message=await channel.send(payload);
  sessions.updateState(id,"side_choice",{sideChoicePanel:{channelId:channel.id,messageId:message.id}});
 }
 return message;
}
async function recover(client,guildId){
 const ids=[];
 for(const session of sessions.getActiveSessions(guildId).filter(s=>s.stage==="side_choice")){
  try{await publish(client,session.id);ids.push(session.id);}
  catch(error){console.error("[MULTILOBBY] Side choice recovery failed:",session.id,error);}
 }
 return ids;
}
module.exports={render,publish,recover};
