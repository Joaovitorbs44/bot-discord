const {ContainerBuilder,TextDisplayBuilder,SeparatorBuilder,SeparatorSpacingSize,MessageFlags}=require("discord.js");
const db=require("../database/database"),s=require("../services/competitiveStats");
async function handleRanking(interaction){
 const season=s.activeSeason(),players=s.leaderboard(season?.id,10);
 const total=season?db.prepare("SELECT COUNT(*) total FROM season_players sp JOIN players p ON p.id=sp.player_id WHERE sp.season_id=? AND p.is_banned=0").get(season.id).total:0;
 const finished=season?db.prepare("SELECT COUNT(*) total FROM matches WHERE season_id=? AND status='finished'").get(season.id).total:0;
 const rows=players.map((p,i)=>(["🥇","🥈","🥉"][i]||"**"+(i+1)+".**")+" **"+s.safe(p.r6_nickname)+"** · **"+p.points+" pts**\n-# "+p.wins+"V / "+p.losses+"D · "+s.winRate(p.wins,p.matches_played)+"% WR · "+s.safe(p.r6_rank)).join("\n\n")||"Nenhum jogador no ranking desta temporada.";
 const panel=new ContainerBuilder().setAccentColor(0xFF3D2C)
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("## INVI SIX PRO\n-# RANKING COMPETITIVO  /  "+s.safe(season?.name||"SEM TEMPORADA ATIVA")))
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("### TOP 10 · TEMPORADA\n\n"+rows))
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("**"+total+"** jogadores  ·  **"+finished+"** partidas finalizadas\n-# Vitória +5 pts  /  Derrota −3 pts"));
 return interaction.reply({components:[panel],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}});
}
module.exports=handleRanking;