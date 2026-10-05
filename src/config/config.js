require("dotenv").config();

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
    token:
      process.env.DISCORD_TOKEN,

    clientId:
      process.env.CLIENT_ID,

    guildId:
      process.env.GUILD_ID,

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

    logChannelId:
      process.env.LOG_CHANNEL_ID
  },

  matchmaking: {
    teamSize: 5,

    requiredPlayers: 10,

    winPoints: 5,

    lossPoints: -3,

    readyCheckSeconds: 60,

    queueCooldownSeconds: 5
  },

  seasons: {
    durationDays: 30,

    checkIntervalMs:
      60 * 1000
  }
};
