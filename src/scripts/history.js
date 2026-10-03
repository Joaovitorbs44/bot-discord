const {
  EmbedBuilder
} = require("discord.js");

const db = require(
  "../database/database"
);

// ==========================================
// /historico
// ==========================================

async function handleHistory(
  interaction
) {
  const selectedUser =
    interaction.options.getUser(
      "jogador"
    ) || interaction.user;

  // ========================================
  // VERIFICAR JOGADOR
  // ========================================

  const player =
    db.prepare(`
      SELECT *
      FROM players
      WHERE discord_id = ?
    `).get(
      selectedUser.id
    );

  if (!player) {
    return interaction.reply({
      content:
        "Esse usuário não possui perfil no matchmaking.",
      ephemeral: true
    });
  }

  // ========================================
  // BUSCAR PARTIDAS
  // ========================================

  const matches =
    db.prepare(`
      SELECT
        m.id,
        m.match_code,
        m.map,
        m.status,
        m.winner_team,
        m.created_at,
        m.finished_at,
        mp.team,
        mp.is_captain
      FROM match_players mp
      INNER JOIN matches m
        ON m.id = mp.match_id
      WHERE mp.discord_id = ?
      ORDER BY m.id DESC
      LIMIT 10
    `).all(
      selectedUser.id
    );

  // ========================================
  // SEM PARTIDAS
  // ========================================

  if (matches.length === 0) {
    return interaction.reply({
      content:
        `${selectedUser} ainda não possui partidas registradas.`,
      ephemeral: true
    });
  }

  // ========================================
  // MONTAR HISTÓRICO
  // ========================================

  const historyText =
    matches
      .map(
        (match) => {
          let result =
            getMatchResult(
              match
            );

          let captainText = "";

          if (
            Number(
              match.is_captain
            ) === 1
          ) {
            captainText =
              " • Capitão";
          }

          return (
            `**#${match.match_code}** • ` +
            `${match.map}\n` +
            `${result} • ` +
            `Time ${match.team}` +
            `${captainText}`
          );
        }
      )
      .join("\n\n");

  // ========================================
  // EMBED
  // ========================================

  const embed =
    new EmbedBuilder()
      .setTitle(
        `Histórico — ${player.r6_nickname}`
      )
      .setDescription(
        historyText
      )
      .setThumbnail(
        selectedUser.displayAvatarURL({
          size: 256
        })
      )
      .setFooter({
        text:
          "Últimas 10 partidas"
      })
      .setTimestamp();

  await interaction.reply({
    embeds: [
      embed
    ]
  });
}

// ==========================================
// /partida
// ==========================================

async function handleMatchLookup(
  interaction
) {
  let matchCode =
    interaction.options
      .getString(
        "codigo"
      )
      .trim();

  // Permite:
  // 123456
  // #123456
  matchCode =
    matchCode.replace(
      /^#/,
      ""
    );

  // ========================================
  // BUSCAR PARTIDA
  // ========================================

  const match =
    db.prepare(`
      SELECT *
      FROM matches
      WHERE match_code = ?
    `).get(
      matchCode
    );

  if (!match) {
    return interaction.reply({
      content:
        `A partida **#${matchCode}** não foi encontrada.`,
      ephemeral: true
    });
  }

  // ========================================
  // BUSCAR JOGADORES
  // ========================================

  const matchPlayers =
    db.prepare(`
      SELECT
        mp.discord_id,
        mp.team,
        mp.is_captain,
        p.r6_nickname,
        p.r6_rank
      FROM match_players mp
      LEFT JOIN players p
        ON p.discord_id =
           mp.discord_id
      WHERE mp.match_id = ?
      ORDER BY
        mp.team ASC,
        mp.is_captain DESC,
        mp.id ASC
    `).all(
      match.id
    );

  const teamA =
    matchPlayers.filter(
      (player) =>
        player.team === "A"
    );

  const teamB =
    matchPlayers.filter(
      (player) =>
        player.team === "B"
    );

  // ========================================
  // FORMATAR TIMES
  // ========================================

  const teamAText =
    formatTeam(
      teamA
    );

  const teamBText =
    formatTeam(
      teamB
    );

  // ========================================
  // STATUS
  // ========================================

  const statusText =
    getStatusText(
      match.status
    );

  let winnerText =
    "Ainda não definido";

  if (
    match.winner_team === "A"
  ) {
    winnerText =
      "Time A";
  }

  if (
    match.winner_team === "B"
  ) {
    winnerText =
      "Time B";
  }

  // ========================================
  // EMBED
  // ========================================

  const embed =
    new EmbedBuilder()
      .setTitle(
        `Partida #${match.match_code}`
      )
      .setDescription(
        `Mapa: **${match.map}**`
      )
      .addFields(
        {
          name:
            "Time A",
          value:
            teamAText,
          inline: true
        },
        {
          name:
            "Time B",
          value:
            teamBText,
          inline: true
        },
        {
          name:
            "Status",
          value:
            statusText,
          inline: true
        },
        {
          name:
            "Vencedor",
          value:
            winnerText,
          inline: true
        }
      )
      .setFooter({
        text:
          `Partida #${match.match_code}`
      })
      .setTimestamp();

  await interaction.reply({
    embeds: [
      embed
    ]
  });
}

// ==========================================
// FORMATAR TIME
// ==========================================

function formatTeam(
  players
) {
  if (
    players.length === 0
  ) {
    return "Nenhum jogador.";
  }

  return players
    .map(
      (player) => {
        const nickname =
          player.r6_nickname ||
          "Jogador";

        const rank =
          player.r6_rank ||
          "Sem rank";

        const captain =
          Number(
            player.is_captain
          ) === 1
            ? " 👑"
            : "";

        return (
          `<@${player.discord_id}>\n` +
          `**${nickname}** • ` +
          `${rank}` +
          captain
        );
      }
    )
    .join("\n\n");
}

// ==========================================
// RESULTADO PARA O JOGADOR
// ==========================================

function getMatchResult(
  match
) {
  if (
    match.status ===
      "cancelled"
  ) {
    return "🚫 Cancelada";
  }

  if (
    match.status ===
      "disputed"
  ) {
    return "⚠️ Em disputa";
  }

  if (
    match.status ===
      "pending_confirmation"
  ) {
    return "⏳ Aguardando confirmação";
  }

  if (
    match.status ===
      "playing"
  ) {
    return "🎮 Em andamento";
  }

  if (
    match.status ===
      "finished"
  ) {
    if (
      match.winner_team ===
        match.team
    ) {
      return "✅ Vitória";
    }

    return "❌ Derrota";
  }

  return "—";
}

// ==========================================
// STATUS DA PARTIDA
// ==========================================

function getStatusText(
  status
) {
  const statuses = {
    playing:
      "🎮 Em andamento",

    pending_confirmation:
      "⏳ Aguardando confirmação",

    finished:
      "✅ Finalizada",

    disputed:
      "⚠️ Em disputa",

    cancelled:
      "🚫 Cancelada"
  };

  return (
    statuses[status] ||
    status
  );
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  handleHistory,
  handleMatchLookup
};