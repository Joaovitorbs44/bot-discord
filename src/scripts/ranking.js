const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const db = require("../database/database");
const stats = require("../services/competitiveStats");

const PAGE_SIZE = 10;
function buildRanking(page = 0) {
  const season = stats.activeSeason();
  const total = season ? db.prepare("SELECT COUNT(*) AS total FROM season_players sp JOIN players p ON p.id=sp.player_id WHERE sp.season_id=? AND p.is_banned=0").get(season.id).total : 0;
  const finished = season ? db.prepare("SELECT COUNT(*) AS total FROM matches WHERE season_id=? AND status='finished'").get(season.id).total : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.max(0, Math.min(Number.isSafeInteger(page) ? page : 0, pages - 1));
  const players = season ? db.prepare("SELECT p.r6_nickname,p.r6_rank,sp.points,sp.wins,sp.losses,sp.matches_played FROM season_players sp JOIN players p ON p.id=sp.player_id WHERE sp.season_id=? AND p.is_banned=0 ORDER BY sp.points DESC,sp.wins DESC,sp.matches_played ASC,p.id ASC LIMIT ? OFFSET ?").all(season.id, PAGE_SIZE, current * PAGE_SIZE) : [];
  const rows = players.map((p,i) => {
    const pos = current * PAGE_SIZE + i + 1;
    const marker = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "**" + pos + ".**";
    return marker + " **" + stats.safe(p.r6_nickname) + "** · **" + p.points + " pts**\n-# " + p.wins + "V / " + p.losses + "D · " + stats.winRate(p.wins,p.matches_played) + "% WR · " + stats.safe(p.r6_rank);
  }).join("\n\n") || "Nenhum jogador inscrito nesta temporada.";
  const panel = new ContainerBuilder().setAccentColor(0xFF3D2C)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("## INVI SIX PRO\n-# RANKING COMPETITIVO / " + stats.safe(season?.name || "SEM TEMPORADA ATIVA")))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("### CLASSIFICAÇÃO · " + (current+1) + "/" + pages + "\n\n" + rows))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("**" + total + "** participantes · **" + finished + "** partidas finalizadas\n-# Vitória +5 pts / Derrota −3 pts"));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ranking_page:" + (current-1)).setLabel("Anterior").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId("ranking_page:" + (current+1)).setLabel("Próxima").setStyle(ButtonStyle.Secondary).setDisabled(current >= pages-1)
  );
  return { components: [panel, buttons], flags: MessageFlags.IsComponentsV2, allowedMentions: {parse:[]} };
}
async function handleRanking(interaction) { return interaction.reply(buildRanking(0)); }
async function handleRankingPage(interaction) {
  const page = Number(interaction.customId.slice("ranking_page:".length));
  if (!Number.isSafeInteger(page)) return interaction.reply({content:"Página inválida.",flags:MessageFlags.Ephemeral});
  return interaction.update(buildRanking(page));
}
module.exports = handleRanking;
module.exports.handleRankingPage = handleRankingPage;
