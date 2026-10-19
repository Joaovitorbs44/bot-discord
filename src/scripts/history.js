const { badge, playerBadge } = require("../services/rankBadges");
const { matchTeam } = require("../services/teamLabels");
const {ContainerBuilder,TextDisplayBuilder,SeparatorBuilder,SeparatorSpacingSize,MessageFlags}=require("discord.js");
const db=require("../database/database"),s=require("../services/competitiveStats");
function panel(title,body,footer){return new ContainerBuilder().setAccentColor(0xFF3D2C)
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("## INVI SIX PRO\n-# "+title))
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addTextDisplayComponents(new TextDisplayBuilder().setContent("-# "+footer));}
function status(m){if(m.status==="finished")return m.winner_team===m.team?"🟢 VITÓRIA":"🔴 DERROTA";return {playing:"🔵 EM JOGO",pending_confirmation:"🟡 PENDENTE",disputed:"🟠 DISPUTA",cancelled:"⚪ CANCELADA"}[m.status]||"—";}
async function handleHistory(interaction){
 const user=interaction.options.getUser("jogador")||interaction.user,player=s.getPlayer(user.id);
 if(!player)return interaction.reply({content:"Esse usuário não possui perfil no matchmaking.",flags:MessageFlags.Ephemeral});
 const rows=s.matches(user.id,10).map(m=>"**"+s.safe(m.match_code)+"** · "+s.safe(m.map)+"\n"+status(m)+"  /  "+matchTeam(db,m,m.team)+(m.is_captain?"  /  Capitão":"")).join("\n\n")||"Nenhuma partida registrada.";
 return interaction.reply({components:[panel("HISTÓRICO  /  "+s.safe(player.r6_nickname),"### ÚLTIMAS 10 PARTIDAS\n\n"+rows,"Use /partida para consultar os times e o resultado.")],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}});
}
async function handleMatchLookup(interaction){
 const code=(interaction.options.getString("codigo")||"").trim().replace(/^#/,"");
 const match=db.prepare("SELECT * FROM matches WHERE match_code=? OR match_code=?").get(code,"#"+code);
 if(!match)return interaction.reply({content:"Partida não encontrada.",flags:MessageFlags.Ephemeral});
 const players=db.prepare("SELECT mp.discord_id,mp.team,mp.is_captain,p.r6_nickname,p.r6_rank FROM match_players mp LEFT JOIN players p ON p.discord_id=mp.discord_id WHERE mp.match_id=? ORDER BY mp.team ASC,mp.is_captain DESC,mp.id ASC").all(match.id);
 const team=t=>players.filter(p=>p.team===t).map(p=>(p.is_captain?"👑 ":"• ")+badge(p.r6_rank)+s.safe(p.r6_nickname||"Jogador")+" · "+s.safe(p.r6_rank||"Sem rank")).join("\n")||"Nenhum jogador";
 const body="### "+s.safe(match.match_code)+"  /  "+s.safe(match.map)+"\n**Status:** "+({finished:"Finalizada",playing:"Em andamento",pending_confirmation:"Aguardando confirmação",disputed:"Em disputa",cancelled:"Cancelada"}[match.status]||"—")+"  ·  **Vencedor:** "+(match.winner_team?matchTeam(db,match,match.winner_team):"Não definido")+"\n\n### "+matchTeam(db,match,"A")+" · "+s.safe(match.side_a)+"\n"+team("A")+"\n\n### "+matchTeam(db,match,"B")+" · "+s.safe(match.side_b)+"\n"+team("B");
 return interaction.reply({components:[panel("DETALHES DA PARTIDA",body,"Registro permanente do matchmaking")],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}});
}
module.exports={handleHistory,handleMatchLookup};
