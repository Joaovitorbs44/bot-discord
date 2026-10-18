const {MessageFlags}=require("discord.js");
const config=require("../config/config");
const channelByCommand={
  ranking:"rankingChannelId",
  perfil:"rankingChannelId",
  historico:"resultsChannelId",
  partida:"resultsChannelId",
  temporada:"rankingChannelId",
  temporadas:"rankingChannelId",
  "painel-staff":"staffChannelId",
  solicitacoes:"staffChannelId",
  "remover-acesso":"staffChannelId",
  "remover-fila":"staffChannelId",
  "limpar-fila":"staffChannelId",
  "remover-timeout":"staffChannelId",
  pontos:"staffChannelId",
  preview:"staffChannelId"
};
const channelByComponent={
  queue_join:"queueChannelId",queue_leave:"queueChannelId",
  ready_confirm:"queueChannelId",captain_vote:"queueChannelId",
  draft_pick:"draftChannelId",map_veto:"mapVetoChannelId",
  side_attack:"mapVetoChannelId",side_defense:"mapVetoChannelId"
};
function expectedChannel(interaction){
  if(interaction.isChatInputCommand())return config.discord[channelByCommand[interaction.commandName]];
  if(interaction.isButton()||interaction.isStringSelectMenu()){
    const id=interaction.customId;
    if(id.startsWith("ranking_page:"))return config.discord.rankingChannelId;
    const key=Object.keys(channelByComponent).find(k=>id===k);
    return key?config.discord[channelByComponent[key]]:null;
  }
  return null;
}
async function enforceChannel(interaction){
  const channelId=expectedChannel(interaction);
  if(!channelId||interaction.channelId===channelId)return false;
  await interaction.reply({content:"Este comando ou ação só pode ser usado em <#"+channelId+">.",flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  return true;
}
module.exports={enforceChannel};
