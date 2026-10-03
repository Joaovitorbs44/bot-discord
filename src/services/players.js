const db = require("../database/database");

function getPlayerByDiscordId(discordId) {
  return db
    .prepare(`
      SELECT *
      FROM players
      WHERE discord_id = ?
    `)
    .get(discordId);
}

function createPlayerFromRequest(request) {
  return db
    .prepare(`
      INSERT INTO players (
        discord_id,
        discord_username,
        name,
        r6_nickname,
        r6_rank
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      request.discord_id,
      request.discord_username,
      request.name,
      request.r6_nickname,
      request.r6_rank
    );
}

module.exports = {
  getPlayerByDiscordId,
  createPlayerFromRequest
};