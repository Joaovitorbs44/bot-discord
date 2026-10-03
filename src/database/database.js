const fs = require("fs");
const path = require("path");

const Database = require(
  "better-sqlite3"
);

const databasePath =
  path.join(
    __dirname,
    "../../data/database.sqlite"
  );

/*
 * Cria a pasta data automaticamente
 * caso ela ainda não exista.
 */
fs.mkdirSync(
  path.dirname(
    databasePath
  ),
  {
    recursive: true
  }
);

const db =
  new Database(
    databasePath
  );

/*
 * WAL melhora a forma como
 * o SQLite trabalha com leituras
 * e gravações.
 */
db.pragma(
  "journal_mode = WAL"
);

/*
 * Ativa foreign keys.
 */
db.pragma(
  "foreign_keys = ON"
);

module.exports = db;