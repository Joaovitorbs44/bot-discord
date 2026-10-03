const db = require(
  "../database/database"
);

const SEASON_DURATION_DAYS = 30;

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
 * Busca a última temporada criada.
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
 * Cria a primeira temporada
 * se ainda não existir uma ativa.
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
 * Cria uma temporada.
 */
function createSeason() {
  const activeSeason =
    getActiveSeason();

  if (activeSeason) {
    return activeSeason;
  }

  const lastSeason =
    getLastSeason();

  const seasonNumber =
    lastSeason
      ? lastSeason.id + 1
      : 1;

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
        CURRENT_TIMESTAMP,
        datetime(
          CURRENT_TIMESTAMP,
          '+${SEASON_DURATION_DAYS} days'
        )
      )
    `).run(
      `Temporada ${seasonNumber}`
    );

  const seasonId =
    result.lastInsertRowid;

  createSeasonPlayers(
    seasonId
  );

  return getSeasonById(
    seasonId
  );
}

/*
 * Coloca todos os jogadores
 * existentes na temporada.
 */
function createSeasonPlayers(
  seasonId
) {
  db.prepare(`
    INSERT OR IGNORE INTO season_players (
      season_id,
      player_id,
      points,
      wins,
      losses,
      matches_played
    )

    SELECT
      ?,
      id,
      0,
      0,
      0,
      0

    FROM players
  `).run(
    seasonId
  );
}

/*
 * Garante que determinado jogador
 * pertence à temporada.
 *
 * Isso é necessário para quem for
 * aprovado no meio da temporada.
 */
function ensurePlayerInSeason(
  playerId,
  seasonId = null
) {
  let season;

  if (seasonId) {
    season =
      getSeasonById(
        seasonId
      );
  } else {
    season =
      ensureActiveSeason();
  }

  if (!season) {
    throw new Error(
      "SEASON_NOT_FOUND"
    );
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
    season.id,
    playerId
  );

  return db.prepare(`
    SELECT *
    FROM season_players

    WHERE
      season_id = ?
      AND player_id = ?
  `).get(
    season.id,
    playerId
  );
}

/*
 * Verifica vencimento.
 */
function isSeasonExpired(
  season
) {
  if (!season) {
    return true;
  }

  const end =
    parseSQLiteDate(
      season.ends_at
    );

  return (
    Date.now() >=
    end.getTime()
  );
}

/*
 * Ranking completo de
 * determinada temporada.
 */
function getSeasonRanking(
  seasonId,
  limit = 10
) {
  return db.prepare(`
    SELECT
      season_players.*,

      players.discord_id,
      players.r6_nickname,
      players.r6_rank,

      players.created_at
        AS player_created_at

    FROM season_players

    INNER JOIN players
      ON players.id =
        season_players.player_id

    WHERE
      season_players.season_id = ?
      AND players.is_banned = 0

    ORDER BY
      season_players.points DESC,
      season_players.wins DESC,
      season_players.losses ASC,
      players.created_at ASC

    LIMIT ?
  `).all(
    seasonId,
    limit
  );
}

/*
 * Estatísticas individuais.
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
 * Finaliza uma temporada
 * e cria a próxima.
 *
 * Retorna também o ranking final
 * da temporada encerrada.
 */
function rotateSeasonIfNeeded() {
  let activeSeason =
    getActiveSeason();

  /*
   * Banco novo.
   */
  if (!activeSeason) {
    activeSeason =
      createSeason();

    return {
      changed: false,
      season:
        activeSeason
    };
  }

  /*
   * Ainda não terminou.
   */
  if (
    !isSeasonExpired(
      activeSeason
    )
  ) {
    return {
      changed: false,
      season:
        activeSeason
    };
  }

  /*
   * Capturamos a classificação
   * ANTES de encerrar.
   */
  const finalRanking =
    getSeasonRanking(
      activeSeason.id,
      10000
    );

  const transaction =
    db.transaction(() => {
      /*
       * Confere novamente.
       *
       * Evita uma segunda rotação caso
       * duas verificações ocorram muito
       * próximas.
       */
      const current =
        getActiveSeason();

      if (
        !current ||
        current.id !==
          activeSeason.id
      ) {
        return null;
      }

      db.prepare(`
        UPDATE seasons

        SET
          status = 'finished'

        WHERE
          id = ?
          AND status = 'active'
      `).run(
        activeSeason.id
      );

      /*
       * Descobre número da
       * próxima temporada.
       */
      const lastSeason =
        getLastSeason();

      const seasonNumber =
        lastSeason
          ? lastSeason.id + 1
          : 1;

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
            CURRENT_TIMESTAMP,
            datetime(
              CURRENT_TIMESTAMP,
              '+${SEASON_DURATION_DAYS} days'
            )
          )
        `).run(
          `Temporada ${seasonNumber}`
        );

      const newSeasonId =
        result.lastInsertRowid;

      createSeasonPlayers(
        newSeasonId
      );

      return getSeasonById(
        newSeasonId
      );
    });

  const newSeason =
    transaction();

  /*
   * Outra execução já realizou
   * a rotação.
   */
  if (!newSeason) {
    return {
      changed: false,
      season:
        getActiveSeason()
    };
  }

  return {
    changed: true,

    previousSeason:
      activeSeason,

    finalRanking,

    season:
      newSeason
  };
}

/*
 * Mantemos refreshSeason()
 * porque outros arquivos do projeto
 * já utilizam esse nome.
 */
function refreshSeason() {
  return rotateSeasonIfNeeded();
}

/*
 * SQLite usa:
 *
 * 2026-10-03 18:00:00
 *
 * Convertemos para UTC.
 */
function parseSQLiteDate(
  value
) {
  return new Date(
    `${value.replace(
      " ",
      "T"
    )}Z`
  );
}

module.exports = {
  SEASON_DURATION_DAYS,

  getActiveSeason,
  getSeasonById,
  ensureActiveSeason,
  createSeason,

  ensurePlayerInSeason,

  isSeasonExpired,

  getSeasonRanking,
  getPlayerSeasonStats,

  rotateSeasonIfNeeded,
  refreshSeason
};