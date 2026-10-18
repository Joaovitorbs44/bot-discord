const {ContainerBuilder,TextDisplayBuilder,SeparatorBuilder,SeparatorSpacingSize,MessageFlags}=require("discord.js");
const s=require("../services/competitiveStats");
async function handleProfile(interaction){
 const user=interaction.options.getUser("jogador")||interaction.user,player=s.getPlayer(user.id);
 if(!player)return interaction.reply({content:"Esse usuário não possui perfil no matchmaking.",flags:MessageFlags.Ephemeral});
 const season=s.activeSeason(),st=s.seasonStats(player.id,season?.id),pos=s.position(player.id,season?.id);
 const recent=s.matches(user.id,5,season?.id).map(m=>{
  const label=m.status==="finished"?(m.winner_team===m.team?"🟢 VITÓRIA":"🔴 DERROTA"):({playing:"🔵 EM JOGO",disputed:"🟠 DISPUTA",cancelled:"⚪ CANCELADA",pending_confirmation:"🟡 PENDENTE"}[m.status]||"—");
  return "**"+s.safe(m.match_code)+"** · "+s.safe(m.map)+" · "+label;
 }).join("\n")||"Nenhuma partida nesta temporada.";
 const panel=new ContainerBuilder().setAccentColor(0xFF3D2C)
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("## INVI SIX PRO\n-# PERFIL COMPETITIVO  /  "+s.safe(season?.name||"SEM TEMPORADA ATIVA")))
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("### "+s.safe(player.r6_nickname)+"\n<@"+player.discord_id+"> · Rank R6: **"+s.safe(player.r6_rank)+"**\n\n### "+st.points+" PTS  ·  "+(pos?"#"+pos:"—")+" NO RANKING\n**"+st.wins+"** vitórias  /  **"+st.losses+"** derrotas  /  **"+st.matches_played+"** partidas\n**"+s.winRate(st.wins,st.matches_played)+"%** win rate  ·  **"+s.streak(user.id,season?.id)+"** sequência"))
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("### ÚLTIMAS PARTIDAS\n"+recent))
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("-# O rank oficial do R6 não muda com a pontuação do lobby."));
 return interaction.reply({components:[panel],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}});
}
module.exports=handleProfile;