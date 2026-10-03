const db = require(
  "../database/database"
);

const WIN_POINTS = 5;
const LOSS_POINTS = -3;

/*
 * Aplica o resultado definitivo
 * de uma partida.
 *
 * Essa função pode ser utilizada:
 *
 * - pela confirmação dos capitães;
 * - pela decisão da Staff.
 */
function applyMatchResult({
  matchId,
  winnerTeam,
  confirmedBy = null
}) {
  if (
    winnerTeam !== "A" &&
    winnerTeam !== "B"
  ) {
    throw new Error(
      "INVALID_WINNER"
    );
  }

  const transaction =
    db.transaction(() => {
      /*
       * Busca novamente dentro
       * da transaction.
       */
      const match =
        db.prepare(`
          SELECT *
          FROM matches
          WHERE id = ?
        `).get(
          matchId
        );

      if (!match) {
        throw new Error(
          "MATCH_NOT_FOUND"
        );
      }

      /*
       * Uma partida finalizada ou
       * cancelada nunca pode receber
       * pontos novamente.
       */
      if (
        match.status === "finished" ||
        match.status === "cancelled"
      ) {
        throw new Error(
          "RESULT_ALREADY_PROCESSED"
        );
      }

      const players =
        db.prepare(`
          SELECT *
          FROM match_players
          WHERE match_id = ?
        `).all(
          matchId
        );

      /*
       * Uma partida válida precisa
       * possuir exatamente 10 jogadores.
       */
      if (
        players.length !== 10
      ) {
        throw new Error(
          "INVALID_MATCH_PLAYERS"
        );
      }

      /*
       * Atualiza os 10 jogadores.
       */
      const updateWinner =
        db.prepare(`
          UPDATE players

          SET
            points = points + ?,
            wins = wins + 1,
            matches_played =
              matches_played + 1,
            updated_at =
              CURRENT_TIMESTAMP

          WHERE discord_id = ?
        `);

      const updateLoser =
        db.prepare(`
          UPDATE players

          SET
            points = points + ?,
            losses = losses + 1,
            matches_played =
              matches_played + 1,
            updated_at =
              CURRENT_TIMESTAMP

          WHERE discord_id = ?
        `);

      for (
        const player
        of players
      ) {
        const won =
          player.team ===
          winnerTeam;

        if (won) {
          updateWinner.run(
            WIN_POINTS,
            player.discord_id
          );
        } else {
          updateLoser.run(
            LOSS_POINTS,
            player.discord_id
          );
        }
      }

      /*
       * Finaliza a partida.
       */
      db.prepare(`
        UPDATE matches

        SET
          winner_team = ?,
          status = 'finished',
          result_confirmed_by = ?,
          result_confirmed_at =
            CURRENT_TIMESTAMP,
          finished_at =
            CURRENT_TIMESTAMP

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
    });

  return transaction();
}

/*
 * Cancela uma partida.
 *
 * Nenhum ponto é aplicado.
 */
function cancelMatch({
  matchId,
  cancelledBy = null
}) {
  const transaction =
    db.transaction(() => {
      const match =
        db.prepare(`
          SELECT *
          FROM matches
          WHERE id = ?
        `).get(
          matchId
        );

      if (!match) {
        throw new Error(
          "MATCH_NOT_FOUND"
        );
      }

      if (
        match.status === "finished" ||
        match.status === "cancelled"
      ) {
        throw new Error(
          "RESULT_ALREADY_PROCESSED"
        );
      }

      db.prepare(`
        UPDATE matches

        SET
          winner_team = NULL,
          status = 'cancelled',
          result_confirmed_by = ?,
          result_confirmed_at =
            CURRENT_TIMESTAMP,
          finished_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
      `).run(
        cancelledBy,
        matchId
      );

      return match;
    });

  return transaction();
}

module.exports = {
  WIN_POINTS,
  LOSS_POINTS,
  applyMatchResult,
  cancelMatch
};