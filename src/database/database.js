
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ==========================================
// CONFIGURAÇÃO DO CAMINHO
// ==========================================

const defaultDatabasePath = path.resolve(
  __dirname,
  "../../data/database.sqlite"
);

const configuredPath =
  process.env.DATABASE_PATH?.trim();

const databasePath = configuredPath
  ? path.resolve(configuredPath)
  : defaultDatabasePath;

// ==========================================
// DIRETÓRIO
// ==========================================

const databaseDirectory =
  path.dirname(databasePath);

fs.mkdirSync(databaseDirectory, {
  recursive: true
});

// ==========================================
// DIAGNÓSTICO
// ==========================================

const databaseAlreadyExists =
  fs.existsSync(databasePath);

const volumeMountPath =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();

function isInsideDirectory(filePath, directory) {
  const relative = path.relative(
    path.resolve(directory),
    path.resolve(filePath)
  );

  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

console.log("================================");
console.log("SQLITE — DIAGNÓSTICO");
console.log("================================");

console.log(
  "Caminho do banco:",
  databasePath
);

console.log(
  "Banco já existia:",
  databaseAlreadyExists ? "SIM" : "NÃO"
);

console.log(
  "DATABASE_PATH:",
  configuredPath || "NÃO CONFIGURADO"
);

console.log(
  "Volume Railway:",
  volumeMountPath || "NÃO IDENTIFICADO"
);

if (volumeMountPath) {
  const persistent = isInsideDirectory(
    databasePath,
    volumeMountPath
  );

  console.log(
    "Banco dentro do volume:",
    persistent ? "SIM" : "NÃO"
  );

  if (!persistent) {
    console.warn(
      "[SQLITE] ATENÇÃO: o banco está " +
      "fora do caminho de montagem do volume."
    );
  }
} else {
  console.warn(
    "[SQLITE] Não foi possível confirmar " +
    "a persistência do banco pelo ambiente."
  );
}

// ==========================================
// ABRIR BANCO
// ==========================================

const db = new Database(databasePath, {
  fileMustExist: false,
  timeout: 10000
});

// ==========================================
// PRAGMAS
// ==========================================

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");
db.pragma("synchronous = NORMAL");

// ==========================================
// VALIDAÇÕES
// ==========================================

const foreignKeysEnabled =
  db.pragma("foreign_keys", {
    simple: true
  });

if (foreignKeysEnabled !== 1) {
  throw new Error(
    "Não foi possível habilitar foreign keys."
  );
}

const journalMode =
  db.pragma("journal_mode", {
    simple: true
  });

console.log(
  "Journal mode:",
  journalMode
);

console.log(
  "Banco de dados SQLite conectado."
);

console.log("================================");

// ==========================================
// EXPORTAÇÃO
// ==========================================

module.exports = db;
