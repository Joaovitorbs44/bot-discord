// Publishes and restores isolated ready-check messages. This does not activate
// the new queue or transition into the legacy captain-vote singleton.
const {ContainerBuilder,TextDisplayBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags} = require("discord.js");
const sessions = require("./matchmakingSessions");
const ready = require("./readyCheckSessions");
const config = require("../config/config");

function render(snapshot) {
  if (!snapshot) throw new Error("READY_SESSION_NOT_FOUND");
  const lines = [
    `## Ready Check · Lobby #${snapshot.sessionId}`,
    `**${snapshot.confirmed.length}/${snapshot.total} confirmados**`,
    snapshot.deadline ? `Prazo: <t:${Math.ceil(snapshot.deadline/1000)}:R>` : "Prazo não iniciado",
    ...snapshot.confirmed.map(id => `✅ <@${id}>`),
    ...snapshot.waiting.map(id => `⏳ <@${id}>`)
  ];
  const container = new ContainerBuilder().setAccentColor(0xFF3D2C)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
  if (snapshot.stage === "ready_check" && snapshot.status === "active" &&
      snapshot.deadline > Date.now()) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(sessions.componentId("ready_check",snapshot.sessionId,"confirm"))
        .setLabel("Confirmar presença").setStyle(ButtonStyle.Success)
    ));
  }
  return {components:[container],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}

async function channelFor(client, session, state) {
  const channelId = state.readyCheckPanel?.channelId || session.channel_id || config.discord.queueChannelId;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.send) throw new Error("READY_CHANNEL_UNAVAILABLE");
  return channel;
}

async function publish(client, sessionId) {
  const session = sessions.getSession(sessionId);
  if (!session || session.status !== "active" || session.stage !== "ready_check") return null;
  const state = sessions.parseState(session);
  const channel = await channelFor(client,session,state);
  const messageId = state.readyCheckPanel?.messageId;
  let message = null;
  if (messageId) {
    try { message = await channel.messages.fetch(messageId); } catch {}
  }
  const data = render(ready.snapshot(sessionId));
  if (message) {
    await message.edit(data);
  } else {
    message = await channel.send(data);
    sessions.updateState(sessionId,"ready_check",{
      readyCheckPanel:{channelId:channel.id,messageId:message.id}
    });
  }
  return message;
}

async function start(client,sessionId) {
  const session = sessions.getSession(sessionId);
  if (!session || session.stage !== "ready_check" || session.status !== "active") return null;
  if (!session.deadline_at) {
    ready.setDeadline(sessionId,config.matchmaking.readyCheckSeconds);
  }
  const message = await publish(client,sessionId);
  schedule(client,sessionId);
  return message;
}

function schedule(client,sessionId) {
  const snapshot = ready.snapshot(sessionId);
  if (!snapshot || snapshot.stage !== "ready_check" || snapshot.status !== "active") return;
  if (!snapshot.deadline) return;
  sessions.scheduleTimer(sessionId,snapshot.deadline,async () => {
    const expired = ready.expire(sessionId);
    if (!expired) return;
    // Cancelled sessions remain persisted for staff review. Do not impose
    // penalties or requeue here until those flows are made idempotent.
    const state = sessions.parseState(expired);
    const channel = await channelFor(client,expired,state);
    const messageId = state.readyCheckPanel?.messageId;
    if (messageId) {
      try {
        const message = await channel.messages.fetch(messageId);
        await message.edit(render(ready.snapshot(sessionId)));
      } catch (error) {
        console.error("[MULTILOBBY] Failed to close ready panel:",error);
      }
    }
  });
}

async function recover(client,guildId) {
  const restored = [];
  for (const snapshot of ready.recover(guildId)) {
    try {
      await start(client,snapshot.sessionId);
      restored.push(snapshot.sessionId);
    } catch (error) {
      console.error("[MULTILOBBY] Ready restore failed:",snapshot.sessionId,error);
    }
  }
  return restored;
}

module.exports = {render,publish,start,schedule,recover};
