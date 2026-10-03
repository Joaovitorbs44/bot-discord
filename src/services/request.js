const db = require("../database/database");

function getRequestByDiscordId(discordId) {
  return db.prepare(`
    SELECT * FROM access_requests WHERE discord_id = ?
  `)

  .get(discordId);
}

function getRequestById(requestId) {
  return db.prepare(`
    SELECT * FROM access_requests WHERE id = ?
  `)

  .get(requestId);
}

function createRequest({discordId, discordUsername, name, r6Nickname, r6Rank}) {
  return db.prepare(`
    INSERT INTO access_requests (discord_id, discord_username, name, r6_nickname, r6_rank) VALUES (?, ?, ?, ?, ?)
  `) 

  .run(discordId, discordUsername, name, r6Nickname, r6Rank);
}

function approveRequest(requestId, staffDiscordId) {
  return db.prepare(`
    UPDATE access_requests SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'
  `)

  .run(staffDiscordId, requestId);
}

function rejectRequest(requestId, staffDiscordId) {
  return db.prepare(`
    UPDATE access_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'
  `)
  
  .run(staffDiscordId, requestId);
}

module.exports = {
  getRequestByDiscordId,
  getRequestById,
  createRequest,
  approveRequest,
  rejectRequest
};