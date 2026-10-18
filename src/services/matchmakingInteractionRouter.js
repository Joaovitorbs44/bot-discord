// Router for session-scoped Discord interactions. Legacy controls remain unchanged.
// Stage-specific handlers can be registered incrementally without enabling
// multi-lobby queue handoff or removing the legacy database constraint.
const {MessageFlags} = require("discord.js");
const sessions = require("./matchmakingSessions");
const ready = require("./readyCheckSessions");

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
  // Do not advance automatically: the captain-vote Discord stage still uses
  // a singleton controller. The future orchestrator must handle this handoff.
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
  if (parsed.stage === "ready_check" && interaction.isButton()) {
    await handleReady(interaction,parsed);
    return true;
  }
  await reject(interaction,"Esta etapa do multi-lobby ainda não foi habilitada.");
  return true;
}

module.exports = {handleSessionComponent};
