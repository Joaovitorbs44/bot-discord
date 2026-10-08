
const fs = require("fs");
const path = require("path");

const Database = require("better-sqlite3");

// ==========================================
// CAMINHO DO BANCO DE DADOS
// ==========================================

const defaultDatabasePath = path.resolve(
  __dirname,
  "../../data/database.sqlite"
);

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : defaultDatabasePath;

// ==========================================
// DIRETÓRIO PERSISTENTE
// ==========================================

fs.mkdirSync(
  path.dirname(databasePath),
  {
    recursive: true
  }
);

// ==========================================
// CONEXÃO SQLITE
// ==========================================

const db = new Database(databasePath, {
  fileMustExist: false,
  timeout: 10000
});

// ==========================================
// CONFIGURAÇÕES SQLITE
// ==========================================

db.pragma("journal_mode = WAL");

db.pragma("foreign_keys = ON");

db.pragma("busy_timeout = 10000");

db.pragma("synchronous = NORMAL");

// ==========================================
// VERIFICAÇÃO
// ==========================================

const foreignKeysEnabled =
  db.pragma("foreign_keys", {
    simple: true
  });

if (foreignKeysEnabled !== 1) {
  throw new Error(
    "Não foi possível habilitar foreign keys no SQLite."
  );
}

// ==========================================
// EXPORTAÇÃO
// ==========================================

module.exports = db;
