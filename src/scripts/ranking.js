const {
  EmbedBuilder
} = require("discord.js");

const db = require(
  "../database/database"
);

async function handleRanking(
  interaction
) {
  // ==========================================
  // BUSCAR RANKING
  // ==========================================

  const players =
    db.prepare(`
      SELECT
        id,
        discord_id,
        r6_nickname,
        r6_rank,
        points,
        wins,
        losses,
        matches_played
      FROM players
      WHERE is_banned = 0
      ORDER BY
        points DESC,
        wins DESC,
        matches_played ASC,
        id ASC
      LIMIT 10
    `).all();

  // ==========================================
  // SEM JOGADORES
  // ==========================================

  if (players.length === 0) {
    return interaction.reply({
      content:
        "Ainda não existem jogadores no ranking.",
      ephemeral: true
    });
  }

  // ==========================================
  // MONTAR CLASSIFICAÇÃO
  // ==========================================

  const medals = [
    "🥇",
    "🥈",
    "🥉"
  ];

  const rankingText =
    players
      .map(
        (player, index) => {
          const position =
            index < 3
              ? medals[index]
              : `**${index + 1}º**`;

          const matches =
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
            matches > 0
              ? (
                  (
                    wins /
                    matches
                  ) * 100
                ).toFixed(1)
              : "0.0";

          return (
            `${position} ` +
            `**${player.r6_nickname}**\n` +
            `<@${player.discord_id}> • ` +
            `${player.r6_rank}\n` +
            `**${points} pts** • ` +
            `${wins}V ${losses}D • ` +
            `${winrate}% WR`
          );
        }
      )
      .join("\n\n");

  // ==========================================
  // TOTAL DE JOGADORES
  // ==========================================

  const totalPlayers =
    db.prepare(`
      SELECT
        COUNT(*) AS total
      FROM players
      WHERE is_banned = 0
    `).get();

  // ==========================================
  // TOTAL DE PARTIDAS FINALIZADAS
  // ==========================================

  let totalMatches = 0;

  try {
    const matchStats =
      db.prepare(`
        SELECT
          COUNT(*) AS total
        FROM matches
        WHERE status = 'finished'
      `).get();

    totalMatches =
      matchStats?.total || 0;
  } catch (error) {
    totalMatches = 0;
  }

  // ==========================================
  // EMBED
  // ==========================================

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Classificação"
      )
      .setDescription(
        rankingText
      )
      .addFields(
        {
          name:
            "Jogadores",
          value:
            String(
              totalPlayers.total
            ),
          inline: true
        },
        {
          name:
            "Partidas",
          value:
            String(
              totalMatches
            ),
          inline: true
        },
        {
          name:
            "Pontuação",
          value:
            "Vitória **+5** • Derrota **-3**",
          inline: true
        }
      )
      .setFooter({
        text:
          "Top 10 do matchmaking"
      })
      .setTimestamp();

  // ==========================================
  // RESPONDER
  // ==========================================

  await interaction.reply({
    embeds: [
      embed
    ]
  });
}

module.exports =
  handleRanking;