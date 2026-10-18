const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const config = require("../config/config");
const STAFF_PANEL_ID = "1557714957007593472";
const channelByCommand = {
  placar: "resultsChannelId", ranking: "rankingChannelId", perfil: "rankingChannelId",
  temporada: "rankingChannelId", temporadas: "rankingChannelId",
  historico: "resultsChannelId", partida: "resultsChannelId",
  solicitacoes: "staffChannelId", "remover-acesso": "staffChannelId",
  "remover-fila": "queueChannelId", "limpar-fila": "queueChannelId",
  "remover-timeout": "queueChannelId"
};
const channelByComponent = {
  queue_join: "queueChannelId", queue_leave: "queueChannelId",
  ready_confirm: "draftChannelId", captain_vote: "draftChannelId",
  draft_pick: "draftChannelId", map_veto: "mapVetoChannelId",
  side_attack: "mapVetoChannelId", side_defense: "mapVetoChannelId",
  clear_queue_confirm: "queueChannelId", clear_queue_cancel: "queueChannelId"
};
function isStaff(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.member?.roles?.cache?.has(config.discord.staffRoleId) ||
    (Array.isArray(interaction.member?.roles) && interaction.member.roles.includes(config.discord.staffRoleId)));
}
function panelAccess(interaction) {
  return interaction.inGuild?.() && interaction.guildId === config.discord.guildId &&
    isStaff(interaction);
}
async function moderationChannel(interaction) {
  if (process.env.RESULT_MODERATION_CHANNEL_ID) return process.env.RESULT_MODERATION_CHANNEL_ID;
  const matches = channel => channel.name?.split(/[|｜]/).pop().trim() === "alterar-resultados";
  let channel = interaction.guild?.channels?.cache?.find(matches);
  if (!channel && interaction.guild?.channels?.fetch) {
    const channels = await interaction.guild.channels.fetch();
    channel = channels.find(item => item && matches(item));
  }
  return channel?.id || STAFF_PANEL_ID;
}
async function expectedChannel(interaction) {
  if (interaction.isChatInputCommand()) {
    if (["preview", "homologacao", "painel-staff", "partidas"].includes(interaction.commandName)) return STAFF_PANEL_ID;
    if (interaction.commandName === "pontos") return moderationChannel(interaction);
    return config.discord[channelByCommand[interaction.commandName]];
  }
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const id = interaction.customId;
    if (id === "preview_select" || id.startsWith("preview_action:") || id.startsWith("preview_choice:") || id.startsWith("staff_panel:")) return STAFF_PANEL_ID;
    if (id.startsWith("ranking_page:")) return config.discord.rankingChannelId;
    return config.discord[channelByComponent[id]];
  }
  return null;
}
async function enforceChannel(interaction) {
  // Staff can invoke every slash command in the configured guild; match controls
  // remain bound to their real stage channel and session.
  const panel = panelAccess(interaction);
  if (panel && (interaction.isChatInputCommand() ||
    ["clear_queue_confirm", "clear_queue_cancel"].includes(interaction.customId) ||
    ["ranking_page:", "preview_action:", "preview_choice:", "staff_panel:"].some(prefix => interaction.customId?.startsWith(prefix)) ||
    interaction.customId === "preview_select")) return false;
  const channelId = await expectedChannel(interaction);
  if (!channelId || interaction.channelId === channelId) return false;
  await interaction.reply({ content: `Este comando ou ação só pode ser usado em <#${channelId}>.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  return true;
}
module.exports = { enforceChannel };
