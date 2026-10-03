const {
  EmbedBuilder
} = require("discord.js");

const db = require(
  "../src/database/database"
);

const {
  refreshSeason,
  getActiveSeason,
  getSeasonById,
  getSeasonRanking
} = require(
  "../src/services/seasonService"
);

/*
 * /temporada
 *
 * /temporada numero:1
 */
async function handleSeason(
  interaction
) {
  /*
   * Primeiro garantimos que
   * a temporada atual está correta.
   */
  refreshSeason();

  const requestedNumber =
    interaction.options.getInteger(
      "numero"
    );

  let season;

  /*
   * Sem número:
   * mostra temporada atual.
   */
  if (
    requestedNumber === null
  ) {
    season =
      getActiveSeason();
  } else {
    season =
      getSeasonById(
        requestedNumber
      );
  }

  if (!season) {
    return interaction.reply({
      content:
        "Essa temporada não existe.",
      ephemeral: true
    });
  }

  const ranking =
    getSeasonRanking(
      season.id,
      10
    );

  const stats =
    getSeasonStats(
      season.id
    );

  const rankingText =
    createRankingText(
      ranking
    );

  const status =
    season.status === "active"
      ? "Em andamento"
      : "Finalizada";

  const startDate =
    formatDate(
      season.starts_at
    );

  const endDate =
    formatDate(
      season.ends_at
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        season.name
      )
      .setDescription(
        season.status === "active"
          ? "Classificação atual da temporada."
          : "Classificação final arquivada."
      )
      .addFields(
        {
          name:
            "Status",
          value:
            status,
          inline: true
        },
        {
          name:
            "Início",
          value:
            startDate,
          inline: true
        },
        {
          name:
            "Fim",
          value:
            endDate,
          inline: true
        },
        {
          name:
            "Partidas",
          value:
            String(
              stats.finishedMatches
            ),
          inline: true
        },
        {
          name:
            "Participantes",
          value:
            String(
              stats.participants
            ),
          inline: true
        },
        {
          name:
            "Classificação",
          value:
            rankingText,
          inline: false
        }
      )
      .setFooter({
        text:
          season.status === "active"
            ? "Vitória +5 • Derrota -3"
            : "Resultado arquivado"
      })
      .setTimestamp();

  await interaction.reply({
    embeds: [
      embed
    ]
  });
}

/*
 * /temporadas
 *
 * Lista temporadas existentes.
 */
async function handleSeasons(
  interaction
) {
  refreshSeason();

  const seasons =
    db.prepare(`
      SELECT
        seasons.*,

        (
          SELECT COUNT(*)

          FROM matches

          WHERE
            matches.season_id =
              seasons.id

            AND matches.status =
              'finished'
        ) AS finished_matches,

        (
          SELECT COUNT(*)

          FROM season_players

          WHERE
            season_players.season_id =
              seasons.id

            AND
            season_players.matches_played > 0
        ) AS participants

      FROM seasons

      ORDER BY
        seasons.id DESC

      LIMIT 20
    `).all();

  if (
    seasons.length === 0
  ) {
    return interaction.reply({
      content:
        "Ainda não existem temporadas.",
      ephemeral: true
    });
  }

  const list =
    seasons
      .map(
        (season) => {
          const status =
            season.status === "active"
              ? "🟢 Em andamento"
              : "✓ Finalizada";

          return (
            `**${season.name}**\n` +
            `${status} • ` +
            `${season.finished_matches} partidas • ` +
            `${season.participants} participantes`
          );
        }
      )
      .join(
        "\n\n"
      );

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Temporadas"
      )
      .setDescription(
        list
      )
      .setFooter({
        text:
          "Use /temporada numero:X para consultar uma temporada."
      })
      .setTimestamp();

  await interaction.reply({
    embeds: [
      embed
    ]
  });
}

/*
 * Estatísticas gerais
 * da temporada.
 */
function getSeasonStats(
  seasonId
) {
  const matchStats =
    db.prepare(`
      SELECT
        COUNT(*) AS total

      FROM matches

      WHERE
        season_id = ?
        AND status = 'finished'
    `).get(
      seasonId
    );

  const participantStats =
    db.prepare(`
      SELECT
        COUNT(*) AS total

      FROM season_players

      WHERE
        season_id = ?
        AND matches_played > 0
    `).get(
      seasonId
    );

  return {
    finishedMatches:
      matchStats.total,

    participants:
      participantStats.total
  };
}

/*
 * Cria Top 10.
 */
function createRankingText(
  ranking
) {
  if (
    ranking.length === 0
  ) {
    return (
      "Nenhum jogador possui partidas nesta temporada."
    );
  }

  return ranking
    .map(
      (player, index) => {
        const position =
          index + 1;

        let positionLabel =
          `**${position}º**`;

        if (
          position === 1
        ) {
          positionLabel =
            "🥇";
        }

        if (
          position === 2
        ) {
          positionLabel =
            "🥈";
        }

        if (
          position === 3
        ) {
          positionLabel =
            "🥉";
        }

        return (
          `${positionLabel} ` +
          `**${player.r6_nickname}** — ` +
          `${player.points} pts\n` +
          `${player.wins}V • ` +
          `${player.losses}D • ` +
          `${player.matches_played} partidas`
        );
      }
    )
    .join(
      "\n\n"
    );
}

/*
 * Data do SQLite para
 * horário brasileiro.
 */
function formatDate(
  value
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(
      `${value.replace(
        " ",
        "T"
      )}Z`
    );

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle:
        "short",

      timeStyle:
        "short",

      timeZone:
        "America/Sao_Paulo"
    }
  ).format(
    date
  );
}

module.exports = {
  handleSeason,
  handleSeasons
};