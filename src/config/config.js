
require("dotenv").config();

// Homologação é opt-in e só pode usar um banco isolado.
// Esta proteção não permite executar duas instâncias com o mesmo token.
if (process.env.HOMOLOGATION_MODE === "true") {
  const path = require("node:path");
  const databasePath = process.env.DATABASE_PATH?.trim();
  const staffChannelId = process.env.STAFF_CHANNEL_ID?.trim();
  const productionVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (!databasePath || !path.isAbsolute(databasePath)) {
    throw new Error("HOMOLOGATION_MODE exige DATABASE_PATH absoluto e separado.");
  }
  if (staffChannelId !== "1557714957007593472") {
    throw new Error("HOMOLOGATION_MODE exige o canal #painel-staff autorizado.");
  }
  if (productionVolume) {
    const relative = path.relative(path.resolve(productionVolume), path.resolve(databasePath));
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new Error("HOMOLOGATION_MODE não pode usar o volume SQLite de produção.");
    }
  }
}

const requiredVariables = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "GUILD_ID",
  "ACCESS_CHANNEL_ID",
  "STAFF_CHANNEL_ID",
  "STAFF_ROLE_ID",
  "PLAYER_ROLE_ID",
  "QUEUE_CHANNEL_ID",
  "RANKING_CHANNEL_ID",
  "MAP_VETO_CHANNEL_ID",
  "DRAFT_CHANNEL_ID",
  "RESULTS_CHANNEL_ID",
  "LOG_CHANNEL_ID"
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `A variável ${variable} não foi configurada no .env`
    );
  }
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,

    accessChannelId:
      process.env.ACCESS_CHANNEL_ID,

    staffChannelId:
      process.env.STAFF_CHANNEL_ID,

    staffRoleId:
      process.env.STAFF_ROLE_ID,

    playerRoleId:
      process.env.PLAYER_ROLE_ID,

    queueChannelId:
      process.env.QUEUE_CHANNEL_ID,

    rankingChannelId:
      process.env.RANKING_CHANNEL_ID,

    mapVetoChannelId:
      process.env.MAP_VETO_CHANNEL_ID,

    draftChannelId:
      process.env.DRAFT_CHANNEL_ID,

    resultsChannelId:
      process.env.RESULTS_CHANNEL_ID,

    logChannelId:
      process.env.LOG_CHANNEL_ID
  },

  matchmaking: {
    teamSize: 5,
    requiredPlayers: 10,

    winPoints: 5,
    lossPoints: -3,

    readyCheckSeconds: 60,
    queueCooldownSeconds: 5,

    draftPickSeconds: 45,
    mapVetoSeconds: 30,

    timerCheckIntervalMs: 1000,

    autoPickOnTimeout: true,
    autoBanOnTimeout: true
  },

  penalties: {
    enabled: true,

    readyCheckCooldownMinutes: 5,

    progressive: true,

    cooldownLevelsMinutes: [
      5,
      15,
      30
    ],

    escalationWindowHours: 24
  },

  recovery: {
    enabled: true,

    restoreQueue: true,
    restoreReadyCheck: true,
    restoreCaptainVote: true,
    restoreDraft: true,
    restoreMapVeto: true,
    restoreSideChoice: true,

    reconcileExpiredTimers: true,

    logRecovery: true
  },

  staff: {
    reportsEnabled: true,
    auditLogsEnabled: true
  },

  seasons: {
    durationDays: 30,

    checkIntervalMs:
      60 * 1000
  }
};
