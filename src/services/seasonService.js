const db = require(
  "../database/database"
);

const config = require(
  "../config/config"
);

/*
 * Retorna a temporada ativa.
 */
function getActiveSeason() {
  return db.prepare(`
    SELECT *
    FROM seasons
    WHERE status = 'active'
    ORDER BY id DESC
    LIMIT 1
  `).get();
}

/*
 * Busca temporada pelo ID.
 */
function getSeasonById(
  seasonId
) {
  return db.prepare(`
    SELECT *
    FROM seasons
    WHERE id = ?
  `).get(
    seasonId
  );
}

/*
 * Retorna a última temporada criada.
 */
function getLastSeason() {
  return db.prepare(`
    SELECT *
    FROM seasons
    ORDER BY id DESC
    LIMIT 1
  `).get();
}

/*
 * Calcula o fim da temporada.
 */
function calculateSeasonEnd(
  startDate
) {
  const date =
    new Date(
      startDate
    );

  date.setUTCDate(
    date.getUTCDate() +
      config.seasons.durationDays
  );

  return date;
}

/*
 * Converte Date para formato
 * aceito pelo SQLite.
 */
function toSqliteDate(
  date
) {
  return date
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
}

/*
 * Cria registros de todos os
 * jogadores na temporada.
 */
function createSeasonPlayers(
  seasonId
) {
  const players =
    db.prepare(`
      SELECT id
      FROM players
      WHERE is_banned = 0
    `).all();

  const insert =
    db.prepare(`
      INSERT OR IGNORE INTO season_players (
        season_id,
        player_id,
        points,
        wins,
        losses,
        matches_played
      )

      VALUES (
        ?,
        ?,
        0,
        0,
        0,
        0
      )
    `);

  for (
    const player
    of players
  ) {
    insert.run(
      seasonId,
      player.id
    );
  }
}

/*
 * Cria uma nova temporada.
 */
function createSeason() {
  const lastSeason =
    getLastSeason();

  const seasonNumber =
    lastSeason
      ? lastSeason.id + 1
      : 1;

  const startsAt =
    new Date();

  const endsAt =
    calculateSeasonEnd(
      startsAt
    );

  const result =
    db.prepare(`
      INSERT INTO seasons (
        name,
        status,
        starts_at,
        ends_at
      )

      VALUES (
        ?,
        'active',
        ?,
        ?
      )
    `).run(
      `Temporada ${seasonNumber}`,
      toSqliteDate(
        startsAt
      ),
      toSqliteDate(
        endsAt
      )
    );

  const seasonId =
    Number(
      result.lastInsertRowid
    );

  createSeasonPlayers(
    seasonId
  );

  return getSeasonById(
    seasonId
  );
}

/*
 * Garante que exista uma
 * temporada ativa.
 */
function ensureActiveSeason() {
  const activeSeason =
    getActiveSeason();

  if (activeSeason) {
    return activeSeason;
  }

  return createSeason();
}

/*
 * Verifica se uma temporada
 * já terminou.
 */
function isSeasonExpired(
  season
) {
  if (!season) {
    return true;
  }

  const endsAt =
    new Date(
      `${season.ends_at} UTC`
    );

  return (
    Date.now() >=
    endsAt.getTime()
  );
}

/*
 * Garante que determinado jogador
 * esteja registrado na temporada.
 */
function ensurePlayerInSeason(
  playerId,
  seasonId = null
) {
  let targetSeasonId =
    seasonId;

  if (!targetSeasonId) {
    const season =
      ensureActiveSeason();

    targetSeasonId =
      season.id;
  }

  db.prepare(`
    INSERT OR IGNORE INTO season_players (
      season_id,
      player_id,
      points,
      wins,
      losses,
      matches_played
    )

    VALUES (
      ?,
      ?,
      0,
      0,
      0,
      0
    )
  `).run(
    targetSeasonId,
    playerId
  );

  return db.prepare(`
    SELECT *
    FROM season_players
    WHERE
      season_id = ?
      AND player_id = ?
  `).get(
    targetSeasonId,
    playerId
  );
}

/*
 * Ranking de uma temporada.
 */
function getSeasonRanking(
  seasonId,
  limit = 10
) {
  return db.prepare(`
    SELECT
      season_players.*,

      players.discord_id,
      players.discord_username,
      players.name,
      players.twitch_nickname,
      players.r6_nickname,
      players.r6_rank

    FROM season_players

    INNER JOIN players
      ON players.id =
        season_players.player_id

    WHERE
      season_players.season_id = ?

    ORDER BY
      season_players.points DESC,
      season_players.wins DESC,
      season_players.matches_played ASC,
      players.r6_nickname ASC

    LIMIT ?
  `).all(
    seasonId,
    limit
  );
}

/*
 * Estatísticas de um jogador
 * em uma temporada.
 */
function getPlayerSeasonStats(
  playerId,
  seasonId
) {
  return db.prepare(`
    SELECT *
    FROM season_players
    WHERE
      season_id = ?
      AND player_id = ?
  `).get(
    seasonId,
    playerId
  );
}

/*
 * Finaliza a temporada atual
 * e cria a próxima.
 */
function rotateSeasonIfNeeded() {
  const activeSeason =
    ensureActiveSeason();

  if (
    !isSeasonExpired(
      activeSeason
    )
  ) {
    return {
      changed: false,
      season:
        activeSeason,
      finishedSeason:
        null,
      finalRanking:
        null
    };
  }

  const finalRanking =
    getSeasonRanking(
      activeSeason.id,
      10000
    );

  const transaction =
    db.transaction(() => {
      /*
       * Verifica novamente dentro
       * da transação para evitar
       * duas rotações simultâneas.
       */
      const currentActive =
        getActiveSeason();

      if (
        !currentActive ||
        currentActive.id !==
          activeSeason.id ||
        !isSeasonExpired(
          currentActive
        )
      ) {
        return {
          changed: false,
          season:
            currentActive ||
            ensureActiveSeason(),
          finishedSeason:
            null,
          finalRanking:
            null
        };
      }

      db.prepare(`
        UPDATE seasons
        SET status = 'finished'
        WHERE id = ?
      `).run(
        currentActive.id
      );

      const lastSeason =
        getLastSeason();

      const nextNumber =
        lastSeason
          ? lastSeason.id + 1
          : 1;

      const startsAt =
        new Date();

      const endsAt =
        calculateSeasonEnd(
          startsAt
        );

      const result =
        db.prepare(`
          INSERT INTO seasons (
            name,
            status,
            starts_at,
            ends_at
          )

          VALUES (
            ?,
            'active',
            ?,
            ?
          )
        `).run(
          `Temporada ${nextNumber}`,
          toSqliteDate(
            startsAt
          ),
          toSqliteDate(
            endsAt
          )
        );

      const newSeasonId =
        Number(
          result.lastInsertRowid
        );

      createSeasonPlayers(
        newSeasonId
      );

      return {
        changed: true,

        season:
          getSeasonById(
            newSeasonId
          ),

        finishedSeason:
          {
            ...currentActive,
            status:
              "finished"
          },

        finalRanking
      };
    });

  return transaction();
}

/*
 * Usado pelos comandos e
 * criação de partidas.
 */
function refreshSeason() {
  return rotateSeasonIfNeeded();
}

module.exports = {
  getActiveSeason,
  getSeasonById,
  getLastSeason,
  createSeason,
  ensureActiveSeason,
  ensurePlayerInSeason,
  isSeasonExpired,
  getSeasonRanking,
  getPlayerSeasonStats,
  rotateSeasonIfNeeded,
  refreshSeason
};
