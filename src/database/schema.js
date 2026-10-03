const db = require(
  "./database"
);

function initializeDatabase() {
  /*
   * Primeiro cria as tabelas.
   *
   * IMPORTANTE:
   * Não criamos índices de colunas
   * novas aqui, porque bancos antigos
   * ainda podem não possuir essas
   * colunas.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      discord_id TEXT NOT NULL UNIQUE,

      discord_username TEXT NOT NULL,

      name TEXT NOT NULL,

      twitch_nickname TEXT,

      r6_nickname TEXT NOT NULL,

      r6_rank TEXT NOT NULL,

      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(
          status IN (
            'pending',
            'approved',
            'rejected'
          )
        ),

      reviewed_by TEXT,

      reviewed_at DATETIME,

      created_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      discord_id TEXT NOT NULL UNIQUE,

      discord_username TEXT NOT NULL,

      name TEXT NOT NULL,

      twitch_nickname TEXT,

      r6_nickname TEXT NOT NULL,

      r6_rank TEXT NOT NULL,

      points INTEGER NOT NULL DEFAULT 0,

      wins INTEGER NOT NULL DEFAULT 0,

      losses INTEGER NOT NULL DEFAULT 0,

      matches_played INTEGER NOT NULL DEFAULT 0,

      is_banned INTEGER NOT NULL DEFAULT 0,

      access_active INTEGER NOT NULL DEFAULT 1,

      created_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      updated_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      name TEXT NOT NULL,

      status TEXT NOT NULL DEFAULT 'active'
        CHECK(
          status IN (
            'active',
            'finished'
          )
        ),

      starts_at DATETIME NOT NULL,

      ends_at DATETIME NOT NULL,

      created_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS season_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      season_id INTEGER NOT NULL,

      player_id INTEGER NOT NULL,

      points INTEGER NOT NULL DEFAULT 0,

      wins INTEGER NOT NULL DEFAULT 0,

      losses INTEGER NOT NULL DEFAULT 0,

      matches_played INTEGER NOT NULL DEFAULT 0,

      created_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      updated_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (season_id)
        REFERENCES seasons(id)
        ON DELETE CASCADE,

      FOREIGN KEY (player_id)
        REFERENCES players(id)
        ON DELETE CASCADE,

      UNIQUE(
        season_id,
        player_id
      )
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      match_code TEXT NOT NULL UNIQUE,

      season_id INTEGER,

      map TEXT NOT NULL,

      captain_a_discord_id TEXT NOT NULL,

      captain_b_discord_id TEXT NOT NULL,

      side_a TEXT NOT NULL,

      side_b TEXT NOT NULL,

      status TEXT NOT NULL DEFAULT 'playing'
        CHECK(
          status IN (
            'playing',
            'pending_confirmation',
            'finished',
            'disputed',
            'cancelled'
          )
        ),

      winner_team TEXT
        CHECK(
          winner_team IS NULL OR
          winner_team IN ('A', 'B')
        ),

      result_submitted_by TEXT,

      result_submitted_at DATETIME,

      result_confirmed_by TEXT,

      result_confirmed_at DATETIME,

      created_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      finished_at DATETIME,

      FOREIGN KEY (season_id)
        REFERENCES seasons(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS match_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      match_id INTEGER NOT NULL,

      discord_id TEXT NOT NULL,

      team TEXT NOT NULL
        CHECK(
          team IN ('A', 'B')
        ),

      is_captain INTEGER NOT NULL DEFAULT 0,

      FOREIGN KEY (match_id)
        REFERENCES matches(id)
        ON DELETE CASCADE,

      UNIQUE(
        match_id,
        discord_id
      )
    );
  `);

  /*
   * MIGRAÇÕES
   *
   * Primeiro garantimos que todas
   * as colunas novas existam.
   */

  addColumnIfMissing(
    "access_requests",
    "twitch_nickname",
    "TEXT"
  );

  addColumnIfMissing(
    "players",
    "twitch_nickname",
    "TEXT"
  );

  addColumnIfMissing(
    "players",
    "access_active",
    "INTEGER NOT NULL DEFAULT 1"
  );

  addColumnIfMissing(
    "matches",
    "season_id",
    "INTEGER"
  );

  addColumnIfMissing(
    "matches",
    "result_submitted_by",
    "TEXT"
  );

  addColumnIfMissing(
    "matches",
    "result_submitted_at",
    "DATETIME"
  );

  addColumnIfMissing(
    "matches",
    "result_confirmed_by",
    "TEXT"
  );

  addColumnIfMissing(
    "matches",
    "result_confirmed_at",
    "DATETIME"
  );

  /*
   * Só depois das migrações
   * criamos os índices.
   */
  createIndexes();
}

function addColumnIfMissing(
  table,
  column,
  definition
) {
  const columns =
    db.prepare(
      `PRAGMA table_info(${table})`
    ).all();

  const exists =
    columns.some(
      (item) =>
        item.name === column
    );

  if (!exists) {
    db.exec(`
      ALTER TABLE ${table}
      ADD COLUMN ${column} ${definition}
    `);
  }
}

function createIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS
      idx_access_requests_status
      ON access_requests(status);

    CREATE INDEX IF NOT EXISTS
      idx_players_points
      ON players(points);

    CREATE INDEX IF NOT EXISTS
      idx_players_access_active
      ON players(access_active);

    CREATE INDEX IF NOT EXISTS
      idx_seasons_status
      ON seasons(status);

    CREATE INDEX IF NOT EXISTS
      idx_season_players_season
      ON season_players(season_id);

    CREATE INDEX IF NOT EXISTS
      idx_season_players_player
      ON season_players(player_id);

    CREATE INDEX IF NOT EXISTS
      idx_season_players_points
      ON season_players(
        season_id,
        points DESC
      );

    CREATE INDEX IF NOT EXISTS
      idx_matches_status
      ON matches(status);

    CREATE INDEX IF NOT EXISTS
      idx_matches_season
      ON matches(season_id);

    CREATE INDEX IF NOT EXISTS
      idx_match_players_match
      ON match_players(match_id);

    CREATE INDEX IF NOT EXISTS
      idx_match_players_discord
      ON match_players(discord_id);
  `);
}

module.exports =
  initializeDatabase;