const { cleanup } = require("./panelLifecycle");
const {ContainerBuilder,TextDisplayBuilder,ActionRowBuilder,StringSelectMenuBuilder,MessageFlags} = require("discord.js");
const sessions = require("./matchmakingSessions");
const captains = require("./captainVoteSessions");
const config = require("../config/config");

function render(sessionId) {
  const session = sessions.getSession(sessionId);
  if (!session || session.stage !== "captain_vote" || session.status !== "active") return null;
  const state = sessions.parseState(session);
  const votes = state.captainVotes || {};
  const options = captains.eligible(sessionId).map(id => ({label:id,value:id,description:"Candidato a capitão"}));
  const container = new ContainerBuilder().setAccentColor(0xFF3D2C)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## Lobby #${sessionId} · Votação de capitães\n**${Object.keys(votes).length}/10 votos registrados**\nEscolha um dos jogadores elegíveis.`
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(sessions.componentId("captain_vote",sessionId,"vote"))
        .setPlaceholder("Escolher capitão")
        .addOptions(options)
    ));
  return {components:[container],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
async function publish(client,sessionId) {
  const session = sessions.getSession(sessionId);
  const data = render(sessionId);
  if (!data) return null;
  const state = sessions.parseState(session);
  const channelId = state.captainVotePanel?.channelId || config.discord.draftChannelId;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.send) throw new Error("CAPTAIN_VOTE_CHANNEL_UNAVAILABLE");
  let message = null;
  if (state.captainVotePanel?.messageId) {
    try { message = await channel.messages.fetch(state.captainVotePanel.messageId); } catch {}
  }
  if (message) await message.edit(data);
  else {
    message = await channel.send(data);
    sessions.updateState(sessionId,"captain_vote",{
      captainVotePanel:{channelId:channel.id,messageId:message.id}
    });
  }
  await cleanup(client, state, ["readyCheckPanel"]);
  return message;
}
async function recover(client,guildId) {
  const ids = [];
  for (const session of sessions.getActiveSessions(guildId).filter(s => s.stage === "captain_vote")) {
    try { await publish(client,session.id); ids.push(session.id); }
    catch (error) { console.error("[MULTILOBBY] Captain panel recovery failed:",session.id,error); }
  }
  return ids;
}
module.exports = {render,publish,recover};

