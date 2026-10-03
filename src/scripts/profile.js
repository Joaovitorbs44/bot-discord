const {
  EmbedBuilder
} = require("discord.js");

const db = require(
  "../database/database"
);

async function handleProfile(
  interaction
) {
  // ==========================================
  // JOGADOR CONSULTADO
  // ==========================================

  const selectedUser =
    interaction.options.getUser(
      "jogador"
    ) || interaction.user;

  // ==========================================
  // BUSCAR JOGADOR
  // ==========================================

  const player =
    db.prepare(`
      SELECT *
      FROM players
      WHERE discord_id = ?
    `).get(
      selectedUser.id
    );

  if (!player) {
    return interaction.reply({
      content:
        "Esse usuário não possui perfil no matchmaking.",
      ephemeral: true
    });
  }

  // ==========================================
  // POSIÇÃO NO RANKING
  // ==========================================

  const ranking =
    db.prepare(`
      SELECT
        id,
        discord_id,
        points
      FROM players
      WHERE is_banned = 0
      ORDER BY
        points DESC,
        wins DESC,
        matches_played ASC,
        id ASC
    `).all();

  const position =
    ranking.findIndex(
      (item) =>
        item.id === player.id
    );

  const positionText =
    position >= 0
      ? `${position + 1}º`
      : "—";

  // ==========================================
  // WINRATE
  // ==========================================

  const matchesPlayed =
    Number(
      player.matches_played || 0
    );

  const wins =
    Number(
      player.wins || 0
    );

  const losses =
    Number(
      player.losses || 0
    );

  const points =
    Number(
      player.points || 0
    );

  const winrate =
    matchesPlayed > 0
      ? (
          (
            wins /
            matchesPlayed
          ) * 100
        ).toFixed(1)
      : "0.0";

  // ==========================================
  // EMBED
  // ==========================================

  const embed =
    new EmbedBuilder()
      .setTitle(
        player.r6_nickname
      )
      .setDescription(
        `<@${player.discord_id}>\n` +
        `Rank R6: **${player.r6_rank}**`
      )
      .addFields(
        {
          name:
            "Classificação",
          value:
            `**Posição:** ${positionText}\n` +
            `**Pontos:** ${points}`,
          inline: true
        },
        {
          name:
            "Estatísticas",
          value:
            `**Partidas:** ${matchesPlayed}\n` +
            `**Vitórias:** ${wins}\n` +
            `**Derrotas:** ${losses}\n` +
            `**Winrate:** ${winrate}%`,
          inline: true
        }
      )
      .setThumbnail(
        selectedUser.displayAvatarURL({
          size: 256
        })
      )
      .setFooter({
        text:
          "O rank do R6 não muda com os pontos do lobby."
      })
      .setTimestamp();

  // ==========================================
  // RESPOSTA
  // ==========================================

  await interaction.reply({
    embeds: [
      embed
    ]
  });
}

module.exports =
  handleProfile;