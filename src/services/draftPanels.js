const {ContainerBuilder,TextDisplayBuilder,ActionRowBuilder,StringSelectMenuBuilder,MessageFlags} = require("discord.js");
const sessions = require("./matchmakingSessions");
const drafts = require("./draftSessions");
const config = require("../config/config");
function render(sessionId) {
  const data = drafts.snapshot(sessionId);
  if (!data || data.session.status !== "active" || data.session.stage !== "draft") return null;
  const unpicked = data.roster.filter(p=>!p.team);
  const teams = ["A","B"].map(team=>`**Equipe ${team}:** ${data.roster.filter(p=>p.team===team).map(p=>`<@${p.discord_id}>`).join(", ") || "—"}`).join("\n");
  const container = new ContainerBuilder().setAccentColor(0xFF3D2C)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Lobby #${sessionId} · Draft\n${teams}\n**Escolha ${data.picks+1}/8** · Capitão ${data.turn}: <@${data.turn==="A"?data.session.captain_a_discord_id:data.session.captain_b_discord_id}>`
    ));
  if (unpicked.length) container.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(sessions.componentId("draft",sessionId,"pick"))
      .setPlaceholder("Escolher jogador")
      .addOptions(unpicked.map(p=>({label:p.discord_id,value:p.discord_id})))
  ));
  return {components:[container],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
async function publish(client,sessionId) {
  const session = sessions.getSession(sessionId);
  const payload = render(sessionId);
  if (!payload) return null;
  const state = sessions.parseState(session);
  const channelId = state.draftPanel?.channelId || config.discord.draftChannelId;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.send) throw new Error("DRAFT_CHANNEL_UNAVAILABLE");
  let message;
  if (state.draftPanel?.messageId) {
    try { message = await channel.messages.fetch(state.draftPanel.messageId); } catch {}
  }
  if (message) await message.edit(payload);
  else {
    message = await channel.send(payload);
    sessions.updateState(sessionId,"draft",{draftPanel:{channelId:channel.id,messageId:message.id}});
  }
  return message;
}
async function recover(client,guildId) {
  const ids=[];
  for (const session of sessions.getActiveSessions(guildId).filter(s=>s.stage==="draft")) {
    try {await publish(client,session.id);ids.push(session.id);}
    catch(error){console.error("[MULTILOBBY] Draft recovery failed:",session.id,error);}
  }
  return ids;
}
module.exports={render,publish,recover};
