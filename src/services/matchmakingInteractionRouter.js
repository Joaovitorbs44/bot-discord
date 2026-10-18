// Router for session-scoped Discord interactions. Legacy controls remain unchanged.
// Stage-specific handlers can be registered incrementally without enabling
// multi-lobby queue handoff or removing the legacy database constraint.
const {MessageFlags} = require("discord.js");
const sessions = require("./matchmakingSessions");
const ready = require("./readyCheckSessions");
const panels = require("./readyCheckPanels");
const captains = require("./captainVoteSessions");
const captainPanels = require("./captainVotePanels");
const drafts = require("./draftSessions");
const draftPanels = require("./draftPanels");
const mapVeto = require("./mapVetoSessions");
const mapVetoPanels = require("./mapVetoPanels");
const sideChoices = require("./sideChoiceSessions");
const sidePanels = require("./sideChoicePanels");
const config = require("../config/config");

async function reject(interaction, content) {
  const payload = {content, flags:MessageFlags.Ephemeral};
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function handleReady(interaction, parsed) {
  if (parsed.action !== "confirm") return reject(interaction,"Ação desconhecida.");
  const result = ready.confirm(parsed.sessionId,interaction.user.id,interaction.guildId);
  if (!result.ok) {
    const messages = {
      expired:"O prazo deste Ready Check terminou.",
      already_confirmed:"Sua presença já está confirmada.",
      not_member:"Você não pertence a este lobby.",
      stale:"Este Ready Check não está mais ativo."
    };
    return reject(interaction,messages[result.reason] || "Não foi possível confirmar.");
  }
  try { await panels.publish(interaction.client,parsed.sessionId); }
  catch (error) { console.error("[MULTILOBBY] Ready panel refresh failed:",error); }
  if (result.complete) {
    const next = ready.finishIfReady(parsed.sessionId,config.matchmaking.requiredPlayers);
    if (next) {
      try { await captainPanels.publish(interaction.client,parsed.sessionId); }
      catch (error) { console.error("[MULTILOBBY] Captain panel publish failed:",error); }
    }
  }
  return reject(interaction,
    result.complete
      ? "Presença confirmada. Todos confirmaram; aguardando início da votação."
      : "Presença confirmada neste lobby.");
}

async function handleSessionComponent(interaction) {
  if (!interaction.isButton?.() && !interaction.isStringSelectMenu?.()) return false;
  const parsed = sessions.parseComponentId(interaction.customId);
  if (!parsed) return false;
  if (!interaction.guildId) {
    await reject(interaction,"Este controle só funciona no servidor.");
    return true;
  }
  const authorized = sessions.authorize(interaction);
  if (!authorized) {
    await reject(interaction,"Este lobby não está ativo ou você não participa dele.");
    return true;
  }
  const channelId = parsed.stage === "ready_check"
    ? (authorized.state.readyCheckPanel?.channelId || authorized.session.channel_id)
    : parsed.stage === "captain_vote"
      ? (authorized.state.captainVotePanel?.channelId || config.discord.draftChannelId)
      : parsed.stage === "draft"
        ? (authorized.state.draftPanel?.channelId || config.discord.draftChannelId)
        : parsed.stage === "map_veto"
          ? (authorized.state.mapVetoPanel?.channelId || config.discord.mapVetoChannelId)
          : parsed.stage === "side_choice"
            ? (authorized.state.sideChoicePanel?.channelId || config.discord.mapVetoChannelId)
            : authorized.session.channel_id;
  if (!channelId || interaction.channelId !== channelId) {
    await reject(interaction,"Este controle pertence a outro canal do lobby.");
    return true;
  }
  if (parsed.stage === "ready_check" && interaction.isButton()) {
    await handleReady(interaction,parsed);
    return true;
  }
  if (parsed.stage === "captain_vote" && interaction.isStringSelectMenu() &&
      parsed.action === "vote") {
    const choice = interaction.values?.[0];
    const result = captains.vote(parsed.sessionId,interaction.guildId,interaction.user.id,choice);
    if (!result.ok) {
      await reject(interaction,{
        stale:"A votação deste lobby não está ativa.",
        not_member:"Você não participa deste lobby.",
        not_eligible:"O jogador escolhido não é elegível.",
        already_voted:"Você já votou."
      }[result.reason] || "Voto não registrado.");
      return true;
    }
    await reject(interaction,`Voto registrado (${result.count}/${result.total}).`);
    if (result.count < result.total) {
      try { await captainPanels.publish(interaction.client,parsed.sessionId); }
      catch (error) { console.error("[MULTILOBBY] Captain panel refresh failed:",error); }
    }
    if (result.count === result.total) {
      try {
        const finished = captains.finish(parsed.sessionId);
        if (finished) await draftPanels.publish(interaction.client,parsed.sessionId);
      } catch (error) { console.error("[MULTILOBBY] Captain vote handoff failed:",error); }
    }
    return true;
  }
  if (parsed.stage === "draft" && interaction.isStringSelectMenu() && parsed.action === "pick") {
    const result = drafts.pick(parsed.sessionId,interaction.guildId,interaction.user.id,interaction.values?.[0]);
    if (!result.ok) {
      await reject(interaction,"Escolha inválida ou não é sua vez neste lobby.");
      return true;
    }
    await reject(interaction,result.finished ? "Draft concluído. Preparando veto de mapas." : "Jogador selecionado.");
    try {
      if (result.finished) await mapVetoPanels.publish(interaction.client,parsed.sessionId);
      else await draftPanels.publish(interaction.client,parsed.sessionId);
    } catch (error) { console.error("[MULTILOBBY] Draft handoff failed:",error); }
    return true;
  }
  if (parsed.stage === "map_veto" && interaction.isStringSelectMenu() && parsed.action === "ban") {
    const result = mapVeto.ban(parsed.sessionId,interaction.guildId,interaction.user.id,interaction.values?.[0]);
    if (!result.ok) {
      await reject(interaction,"Banimento inválido ou não é sua vez neste lobby.");
      return true;
    }
    await reject(interaction,result.finished ? `Mapa definido: **${result.selectedMap}**.` : "Mapa banido.");
    try {
      if (result.finished) await sidePanels.publish(interaction.client,parsed.sessionId);
      else await mapVetoPanels.publish(interaction.client,parsed.sessionId);
    } catch (error) { console.error("[MULTILOBBY] Map veto handoff failed:",error); }
    return true;
  }
  if (parsed.stage === "side_choice" && interaction.isButton() &&
      ["attack","defense"].includes(parsed.action)) {
    const result = sideChoices.choose(parsed.sessionId,interaction.guildId,interaction.user.id,parsed.action);
    await reject(interaction,result.ok
      ? `Lados registrados: Time A — ${result.sideA}; Time B — ${result.sideB}. Aguardando criação da partida.`
      : "Somente o capitão A pode escolher os lados.");
    return true;
  }
  await reject(interaction,"Esta etapa do multi-lobby ainda não foi habilitada.");
  return true;
}

module.exports = {handleSessionComponent};
