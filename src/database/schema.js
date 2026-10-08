
const db = require("./database");

// ==========================================
// INICIALIZAÇÃO
// ==========================================

function initializeDatabase() {
  /*
   * Mantém as tabelas atuais.
   * CREATE TABLE IF NOT EXISTS não
   * remove os dados existentes.
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
        CHECK (
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
        CHECK (
          status IN ('active', 'finished')
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

      UNIQUE (season_id, player_id)
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
        CHECK (
          status IN (
            'playing',
            'pending_confirmation',
            'finished',
            'disputed',
            'cancelled'
          )
        ),

      winner_team TEXT
        CHECK (
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
        CHECK (team IN ('A', 'B')),

      is_captain INTEGER NOT NULL DEFAULT 0,

      FOREIGN KEY (match_id)
        REFERENCES matches(id)
        ON DELETE CASCADE,

      UNIQUE (match_id, discord_id)
    );
  `);

  // ========================================
  // MIGRAÇÕES DAS TABELAS EXISTENTES
  // ========================================

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

  // ========================================
  // NOVAS TABELAS DE MATCHMAKING
  // ========================================

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS matchmaking_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      guild_id TEXT NOT NULL,
      channel_id TEXT,
      message_id TEXT,

      stage TEXT NOT NULL DEFAULT 'queue'
        CHECK (
          stage IN (
            'queue',
            'ready_check',
            'captain_vote',
            'draft',
            'map_veto',
            'side_choice',
            'playing',
            'finished',
            'cancelled'
          )
        ),

      status TEXT NOT NULL DEFAULT 'active'
        CHECK (
          status IN (
            'active',
            'completed',
            'cancelled'
          )
        ),

      captain_a_discord_id TEXT,
      captain_b_discord_id TEXT,

      current_turn_discord_id TEXT,

      deadline_at INTEGER,

      state_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(state_json)),

      match_id INTEGER,

      created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

      updated_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

      FOREIGN KEY (match_id)
        REFERENCES matches(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS matchmaking_session_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      session_id INTEGER NOT NULL,
      discord_id TEXT NOT NULL,

      team TEXT
        CHECK (
          team IS NULL OR
          team IN ('A', 'B')
        ),

      is_captain INTEGER NOT NULL DEFAULT 0,

      ready_confirmed INTEGER NOT NULL DEFAULT 0,

      joined_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

      FOREIGN KEY (session_id)
        REFERENCES matchmaking_sessions(id)
        ON DELETE CASCADE,

      UNIQUE (session_id, discord_id)
    );

    CREATE TABLE IF NOT EXISTS matchmaking_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      session_id INTEGER NOT NULL,

      actor_discord_id TEXT,

      action_type TEXT NOT NULL,

      target TEXT,

      is_automatic INTEGER NOT NULL DEFAULT 0,

      details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json)),

      created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

      FOREIGN KEY (session_id)
        REFERENCES matchmaking_sessions(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS player_cooldowns (
      discord_id TEXT PRIMARY KEY,

      reason TEXT NOT NULL,

      expires_at INTEGER NOT NULL,

      created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS player_penalty_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      discord_id TEXT NOT NULL,

      reason TEXT NOT NULL,

      duration_seconds INTEGER NOT NULL,

      session_id INTEGER,

      created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

      FOREIGN KEY (session_id)
        REFERENCES matchmaking_sessions(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS player_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      reporter_discord_id TEXT NOT NULL,
      reported_discord_id TEXT NOT NULL,

      match_id INTEGER,

      category TEXT NOT NULL,

      description TEXT NOT NULL,

      evidence_url TEXT,

      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
          status IN (
            'pending',
            'reviewing',
            'resolved',
            'rejected'
          )
        ),

      reviewed_by TEXT,
      review_notes TEXT,

      created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

      reviewed_at INTEGER,

      FOREIGN KEY (match_id)
        REFERENCES matches(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS staff_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      staff_discord_id TEXT NOT NULL,

      action_type TEXT NOT NULL,

      target_discord_id TEXT,

      match_id INTEGER,
      report_id INTEGER,

      reason TEXT,

      details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json)),

      created_at INTEGER NOT NULL
        DEFAULT (unixepoch() * 1000),

      FOREIGN KEY (match_id)
        REFERENCES matches(id)
        ON DELETE SET NULL,

      FOREIGN KEY (report_id)
        REFERENCES player_reports(id)
        ON DELETE SET NULL
    );
  `);

  // ========================================
  // ÍNDICES
  // ========================================

  createIndexes();

  // ========================================
  // CONTROLE DE VERSÃO
  // ========================================

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (
      version,
      name
    )
    VALUES (?, ?)
  `).run(
    1,
    "Estrutura inicial de recuperação e moderação"
  );

  console.log(
    "Banco de dados inicializado com sucesso."
  );
}

// ==========================================
// ADICIONAR COLUNA SE NÃO EXISTIR
// ==========================================

function addColumnIfMissing(
  table,
  column,
  definition
) {
  const columns = db.prepare(
    `PRAGMA table_info(${table})`
  ).all();

  const exists = columns.some(
    (item) => item.name === column
  );

  if (!exists) {
    db.exec(`
      ALTER TABLE ${table}
      ADD COLUMN ${column} ${definition}
    `);

    console.log(
      `Migração aplicada: ${table}.${column}`
    );
  }
}

// ==========================================
// ÍNDICES
// ==========================================

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

    CREATE INDEX IF NOT EXISTS
      idx_matchmaking_sessions_status
      ON matchmaking_sessions(status, stage);

    CREATE INDEX IF NOT EXISTS
      idx_matchmaking_sessions_deadline
      ON matchmaking_sessions(deadline_at);

    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_matchmaking_one_active_guild
      ON matchmaking_sessions(guild_id)
      WHERE status = 'active';

    CREATE INDEX IF NOT EXISTS
      idx_session_players_discord
      ON matchmaking_session_players(discord_id);

    CREATE INDEX IF NOT EXISTS
      idx_matchmaking_actions_session
      ON matchmaking_actions(session_id);

    CREATE INDEX IF NOT EXISTS
      idx_player_cooldowns_expires
      ON player_cooldowns(expires_at);

    CREATE INDEX IF NOT EXISTS
      idx_penalty_history_player
      ON player_penalty_history(
        discord_id,
        created_at
      );

    CREATE INDEX IF NOT EXISTS
      idx_reports_status
      ON player_reports(status);

    CREATE INDEX IF NOT EXISTS
      idx_reports_reported_player
      ON player_reports(reported_discord_id);

    CREATE INDEX IF NOT EXISTS
      idx_staff_actions_staff
      ON staff_actions(staff_discord_id);

    CREATE INDEX IF NOT EXISTS
      idx_staff_actions_created
      ON staff_actions(created_at);
  `);
}

module.exports = initializeDatabase;
