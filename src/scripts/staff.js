
const db = require("../database/database");

const {
  ensurePlayerInSeason
} = require("./season");

const WIN_POINTS = 5;
const LOSS_POINTS = -3;

// ==========================================
// APLICAR RESULTADO DA PARTIDA
// ==========================================

function applyMatchResult({
  matchId,
  winnerTeam,
  confirmedBy = null
}) {
  if (!["A", "B"].includes(winnerTeam)) {
    throw new Error("INVALID_WINNER");
  }

  return db.transaction(() => {
    const match = db.prepare(`
      SELECT *
      FROM matches
      WHERE id = ?
    `).get(matchId);

    if (!match) {
      throw new Error("MATCH_NOT_FOUND");
    }

    if (
      ["finished", "cancelled"].includes(
        match.status
      )
    ) {
      throw new Error("RESULT_ALREADY_PROCESSED");
    }

    const players = db.prepare(`
      SELECT *
      FROM match_players
      WHERE match_id = ?
    `).all(matchId);

    const teamA = players.filter(
      player => player.team === "A"
    );

    const teamB = players.filter(
      player => player.team === "B"
    );

    if (
      players.length !== 10 ||
      teamA.length !== 5 ||
      teamB.length !== 5
    ) {
      throw new Error("INVALID_MATCH_PLAYERS");
    }

    // ========================================
    // ATUALIZAR PONTOS GERAIS
    // ========================================

    const updateGeneral = db.prepare(`
      UPDATE players
      SET
        points = points + ?,
        wins = wins + ?,
        losses = losses + ?,
        matches_played = matches_played + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE discord_id = ?
    `);

    // ========================================
    // ATUALIZAR PONTOS DA TEMPORADA
    // ========================================

    const updateSeason = db.prepare(`
      UPDATE season_players
      SET
        points = points + ?,
        wins = wins + ?,
        losses = losses + ?,
        matches_played = matches_played + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE season_id = ?
        AND player_id = ?
    `);

    // ========================================
    // PROCESSAR OS 10 JOGADORES
    // ========================================

    for (const entry of players) {
      const won = entry.team === winnerTeam;

      const points = won
        ? WIN_POINTS
        : LOSS_POINTS;

      const player = db.prepare(`
        SELECT id
        FROM players
        WHERE discord_id = ?
      `).get(entry.discord_id);

      if (!player) {
        throw new Error(
          "MATCH_PLAYER_NOT_REGISTERED"
        );
      }

      updateGeneral.run(
        points,
        won ? 1 : 0,
        won ? 0 : 1,
        entry.discord_id
      );

      if (match.season_id) {
        ensurePlayerInSeason(
          player.id,
          match.season_id
        );

        updateSeason.run(
          points,
          won ? 1 : 0,
          won ? 0 : 1,
          match.season_id,
          player.id
        );
      }
    }

    // ========================================
    // FINALIZAR PARTIDA
    // ========================================

    db.prepare(`
      UPDATE matches
      SET
        winner_team = ?,
        status = 'finished',
        result_confirmed_by = ?,
        result_confirmed_at = CURRENT_TIMESTAMP,
        finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      winnerTeam,
      confirmedBy,
      matchId
    );

    return {
      match,
      players,
      winnerTeam
    };
  })();
}

// ==========================================
// CANCELAR PARTIDA
// ==========================================

function cancelMatch({
  matchId,
  cancelledBy = null
}) {
  return db.transaction(() => {
    const match = db.prepare(`
      SELECT *
      FROM matches
      WHERE id = ?
    `).get(matchId);

    if (!match) {
      throw new Error("MATCH_NOT_FOUND");
    }

    if (
      ["finished", "cancelled"].includes(
        match.status
      )
    ) {
      throw new Error("RESULT_ALREADY_PROCESSED");
    }

    db.prepare(`
      UPDATE matches
      SET
        winner_team = NULL,
        status = 'cancelled',
        result_confirmed_by = ?,
        result_confirmed_at = CURRENT_TIMESTAMP,
        finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      cancelledBy,
      matchId
    );

    return match;
  })();
}

module.exports = {
  WIN_POINTS,
  LOSS_POINTS,
  applyMatchResult,
  cancelMatch
};
