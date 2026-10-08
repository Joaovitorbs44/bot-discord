
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const { ensurePlayerInSeason } = require("../services/seasonService");

const WIN_POINTS = config.matchmaking.winPoints;
const LOSS_POINTS = config.matchmaking.lossPoints;

function getWinPoints() {
  return WIN_POINTS;
}

function getLossPoints() {
  return LOSS_POINTS;
}

function getMatchByCode(code) {
  if (!code) return null;

  return db.prepare(`
    SELECT * FROM matches WHERE match_code = ?
  `).get(code) || null;
}

function getCustomIdPart(id, index) {
  return id?.split(":")[index] || null;
}

function getStatusMessage(status) {
  const messages = {
    playing: "Essa partida ainda está em andamento.",
    pending_confirmation: "Já existe um resultado aguardando confirmação.",
    finished: "Essa partida já foi finalizada.",
    disputed: "Essa partida está sendo analisada pela Staff.",
    cancelled: "Essa partida foi cancelada."
  };

  return messages[status] ||
    "Essa partida não aceita essa ação no momento.";
}

function hasStaffRole(interaction) {
  if (!interaction.inGuild()) return false;

  const roles = interaction.member?.roles;
  const staffRoleId = config.discord.staffRoleId;

  const hasRole = Boolean(
    staffRoleId &&
    (
      roles?.cache?.has?.(staffRoleId) ||
      (Array.isArray(roles) && roles.includes(staffRoleId))
    )
  );

  const isAdministrator =
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    ) || false;

  return hasRole || isAdministrator;
}

function getOtherCaptain(match, userId) {
  if (userId === match.captain_a_discord_id) {
    return match.captain_b_discord_id;
  }

  if (userId === match.captain_b_discord_id) {
    return match.captain_a_discord_id;
  }

  return null;
}

function createFinishedMatchEmbed(match, result, options = {}) {
  const winners = result.players.filter(
    player => player.team === result.winnerTeam
  );

  const losers = result.players.filter(
    player => player.team !== result.winnerTeam
  );

  const list = players => players.map(
    player => `• <@${player.discord_id}> — ${player.r6_nickname}`
  ).join("\n") || "—";

  const embed = new EmbedBuilder()
    .setTitle(`Partida ${match.match_code} finalizada`)
    .setDescription(`O **Time ${result.winnerTeam}** venceu a partida.`)
    .addFields(
      {
        name: `Vencedores • +${WIN_POINTS}`,
        value: list(winners)
      },
      {
        name: `Derrotados • ${LOSS_POINTS}`,
        value: list(losers)
      }
    )
    .setTimestamp();

  if (options.staffResolved) {
    embed.addFields({
      name: "Decisão da Staff",
      value: `Resultado definido por <@${options.resolvedBy}>.`
    });

    embed.setFooter({
      text: "Resultado definido após contestação."
    });
  } else {
    embed.setFooter({
      text: "Resultado confirmado pelos dois capitães."
    });
  }

  return embed;
}

function recordStaffAction({
  staffId,
  actionType,
  matchId,
  reason,
  details = {}
}) {
  db.prepare(`
    INSERT INTO staff_actions (
      staff_discord_id,
      action_type,
      match_id,
      reason,
      details_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    staffId,
    actionType,
    matchId,
    reason,
    JSON.stringify(details),
    Date.now()
  );
}

// ==========================================
// APLICAR RESULTADO
// ==========================================

function applyMatchResult({
  matchId,
  winnerTeam,
  confirmedBy = null,
  allowedStatus = "pending_confirmation"
}) {
  if (!["A", "B"].includes(winnerTeam)) {
    throw new Error("INVALID_WINNER");
  }

  if (!["pending_confirmation", "disputed"].includes(allowedStatus)) {
    throw new Error("INVALID_RESULT_STATUS");
  }

  return db.transaction(() => {
    const match = db.prepare(`
      SELECT * FROM matches WHERE id = ?
    `).get(matchId);

    if (!match) throw new Error("MATCH_NOT_FOUND");

    if (match.status !== allowedStatus) {
      throw new Error("RESULT_ALREADY_PROCESSED");
    }

    if (!match.season_id) {
      throw new Error("MATCH_WITHOUT_SEASON");
    }

    const players = db.prepare(`
      SELECT
        mp.*,
        p.id AS player_id,
        p.r6_nickname,
        p.r6_rank
      FROM match_players mp
      INNER JOIN players p ON p.discord_id = mp.discord_id
      WHERE mp.match_id = ?
    `).all(matchId);

    const uniqueIds = new Set(players.map(p => p.discord_id));

    if (
      players.length !== config.matchmaking.requiredPlayers ||
      uniqueIds.size !== config.matchmaking.requiredPlayers ||
      players.filter(p => p.team === "A").length !==
        config.matchmaking.teamSize ||
      players.filter(p => p.team === "B").length !==
        config.matchmaking.teamSize
    ) {
      throw new Error("INVALID_MATCH_PLAYERS");
    }

    const winnerUpdate = db.prepare(`
      UPDATE players
      SET points = points + ?,
          wins = wins + 1,
          matches_played = matches_played + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const loserUpdate = db.prepare(`
      UPDATE players
      SET points = points + ?,
          losses = losses + 1,
          matches_played = matches_played + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const seasonWinnerUpdate = db.prepare(`
      UPDATE season_players
      SET points = points + ?,
          wins = wins + 1,
          matches_played = matches_played + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE season_id = ? AND player_id = ?
    `);

    const seasonLoserUpdate = db.prepare(`
      UPDATE season_players
      SET points = points + ?,
          losses = losses + 1,
          matches_played = matches_played + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE season_id = ? AND player_id = ?
    `);

    for (const player of players) {
      ensurePlayerInSeason(player.player_id, match.season_id);

      if (player.team === winnerTeam) {
        winnerUpdate.run(WIN_POINTS, player.player_id);
        seasonWinnerUpdate.run(
          WIN_POINTS,
          match.season_id,
          player.player_id
        );
      } else {
        loserUpdate.run(LOSS_POINTS, player.player_id);
        seasonLoserUpdate.run(
          LOSS_POINTS,
          match.season_id,
          player.player_id
        );
      }
    }

    const updated = db.prepare(`
      UPDATE matches
      SET winner_team = ?,
          status = 'finished',
          result_confirmed_by = ?,
          result_confirmed_at = CURRENT_TIMESTAMP,
          finished_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = ?
    `).run(winnerTeam, confirmedBy, matchId, allowedStatus);

    if (updated.changes !== 1) {
      throw new Error("RESULT_ALREADY_PROCESSED");
    }

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

function cancelMatch({ matchId, cancelledBy = null }) {
  return db.transaction(() => {
    const match = db.prepare(`
      SELECT * FROM matches WHERE id = ?
    `).get(matchId);

    if (!match) throw new Error("MATCH_NOT_FOUND");

    if (match.status !== "disputed") {
      throw new Error("RESULT_ALREADY_PROCESSED");
    }

    const updated = db.prepare(`
      UPDATE matches
      SET winner_team = NULL,
          status = 'cancelled',
          result_confirmed_by = ?,
          result_confirmed_at = CURRENT_TIMESTAMP,
          finished_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'disputed'
    `).run(cancelledBy, matchId);

    if (updated.changes !== 1) {
      throw new Error("RESULT_ALREADY_PROCESSED");
    }

    return match;
  })();
}

// ==========================================
// INFORMAR RESULTADO
// ==========================================

async function handleResultReport(interaction) {
  const match = getMatchByCode(
    getCustomIdPart(interaction.customId, 1)
  );

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (match.status !== "playing") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      ephemeral: true
    });
  }

  const otherCaptain = getOtherCaptain(match, interaction.user.id);

  if (!otherCaptain) {
    return interaction.reply({
      content: "Somente os capitães podem informar o resultado.",
      ephemeral: true
    });
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`result_winner:${match.match_code}:A`)
      .setLabel("Time A venceu")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`result_winner:${match.match_code}:B`)
      .setLabel("Time B venceu")
      .setStyle(ButtonStyle.Primary)
  );

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Resultado ${match.match_code}`)
        .setDescription("Informe qual time venceu a partida.")
        .addFields(
          { name: "Mapa", value: match.map, inline: true },
          {
            name: "Você é",
            value:
              interaction.user.id === match.captain_a_discord_id
                ? "Capitão do Time A"
                : "Capitão do Time B",
            inline: true
          }
        )
        .setFooter({
          text: "O outro capitão deverá confirmar o resultado."
        })
    ],
    components: [buttons],
    ephemeral: true
  });
}

// ==========================================
// SELECIONAR VENCEDOR
// ==========================================

async function handleWinnerSelection(interaction) {
  const code = getCustomIdPart(interaction.customId, 1);
  const winner = getCustomIdPart(interaction.customId, 2);

  if (!["A", "B"].includes(winner)) {
    return interaction.reply({
      content: "O vencedor informado é inválido.",
      ephemeral: true
    });
  }

  const match = getMatchByCode(code);

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (match.status !== "playing") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      ephemeral: true
    });
  }

  const otherCaptain = getOtherCaptain(match, interaction.user.id);

  if (!otherCaptain) {
    return interaction.reply({
      content: "Somente os capitães podem informar o resultado.",
      ephemeral: true
    });
  }

  const updated = db.prepare(`
    UPDATE matches
    SET winner_team = ?,
        status = 'pending_confirmation',
        result_submitted_by = ?,
        result_submitted_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'playing'
  `).run(winner, interaction.user.id, match.id);

  if (updated.changes !== 1) {
    return interaction.update({
      content: "O resultado já foi informado.",
      embeds: [],
      components: []
    });
  }

  await interaction.update({
    content: `Você informou que o **Time ${winner}** venceu.`,
    embeds: [],
    components: []
  });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`result_confirm:${code}`)
      .setLabel("Confirmar")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`result_dispute:${code}`)
      .setLabel("Contestar")
      .setStyle(ButtonStyle.Danger)
  );

  return interaction.followUp({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Confirmação de resultado ${code}`)
        .setDescription(
          `<@${interaction.user.id}> informou que o ` +
          `**Time ${winner}** venceu.\n\n` +
          `<@${otherCaptain}>, confirme ou conteste o resultado.`
        )
        .addFields(
          { name: "Mapa", value: match.map, inline: true },
          { name: "Resultado", value: `Time ${winner}`, inline: true }
        )
        .setFooter({
          text: "Os pontos só serão aplicados após a confirmação."
        })
    ],
    components: [buttons]
  });
}

// ==========================================
// CONFIRMAR RESULTADO
// ==========================================

async function handleResultConfirmation(interaction) {
  const match = getMatchByCode(
    getCustomIdPart(interaction.customId, 1)
  );

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (match.status !== "pending_confirmation") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      ephemeral: true
    });
  }

  const otherCaptain = getOtherCaptain(
    match,
    match.result_submitted_by
  );

  if (!otherCaptain || interaction.user.id !== otherCaptain) {
    return interaction.reply({
      content: "Somente o outro capitão pode confirmar o resultado.",
      ephemeral: true
    });
  }

  if (!["A", "B"].includes(match.winner_team)) {
    return interaction.reply({
      content: "O vencedor armazenado é inválido.",
      ephemeral: true
    });
  }

  let result;

  try {
    result = applyMatchResult({
      matchId: match.id,
      winnerTeam: match.winner_team,
      confirmedBy: interaction.user.id,
      allowedStatus: "pending_confirmation"
    });
  } catch (error) {
    return handleResultError(interaction, error);
  }

  return interaction.update({
    embeds: [createFinishedMatchEmbed(match, result)],
    components: []
  });
}

// ==========================================
// CONTESTAR RESULTADO
// ==========================================

async function handleResultDispute(interaction) {
  const match = getMatchByCode(
    getCustomIdPart(interaction.customId, 1)
  );

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (match.status !== "pending_confirmation") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      ephemeral: true
    });
  }

  const otherCaptain = getOtherCaptain(
    match,
    match.result_submitted_by
  );

  if (!otherCaptain || interaction.user.id !== otherCaptain) {
    return interaction.reply({
      content: "Somente o outro capitão pode contestar.",
      ephemeral: true
    });
  }

  const updated = db.prepare(`
    UPDATE matches
    SET status = 'disputed',
        result_confirmed_by = NULL,
        result_confirmed_at = NULL
    WHERE id = ? AND status = 'pending_confirmation'
  `).run(match.id);

  if (updated.changes !== 1) {
    return interaction.reply({
      content: "Não foi possível contestar essa partida.",
      ephemeral: true
    });
  }

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Partida ${match.match_code} contestada`)
        .setDescription(
          `Resultado contestado por <@${interaction.user.id}>.\n\n` +
          "Nenhum ponto foi aplicado. A Staff deverá analisar."
        )
        .setTimestamp()
    ],
    components: []
  });

  return sendDisputeToStaff(interaction, match);
}

// ==========================================
// ENVIAR DISPUTA À STAFF
// ==========================================

async function sendDisputeToStaff(interaction, match) {
  try {
    const channel = await interaction.client.channels.fetch(
      config.discord.staffChannelId
    );

    if (!channel?.isTextBased() || !channel.send) {
      return;
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`staff_result:${match.match_code}:A`)
        .setLabel("Time A venceu")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`staff_result:${match.match_code}:B`)
        .setLabel("Time B venceu")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`staff_cancel:${match.match_code}`)
        .setLabel("Cancelar partida")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Resultado contestado • ${match.match_code}`)
          .setDescription("Uma partida precisa de análise da Staff.")
          .addFields(
            {
              name: "Resultado informado",
              value: `Time ${match.winner_team || "—"}`,
              inline: true
            },
            {
              name: "Informado por",
              value: `<@${match.result_submitted_by}>`,
              inline: true
            },
            {
              name: "Contestado por",
              value: `<@${interaction.user.id}>`,
              inline: true
            },
            {
              name: "Mapa",
              value: match.map,
              inline: true
            }
          )
          .setTimestamp()
      ],
      components: [buttons]
    });
  } catch (error) {
    console.error("Erro ao enviar disputa para Staff:", error);
  }
}

// ==========================================
// STAFF DEFINE VENCEDOR
// ==========================================

async function handleStaffResult(interaction) {
  if (!hasStaffRole(interaction)) {
    return interaction.reply({
      content: "Você não possui permissão para resolver disputas.",
      ephemeral: true
    });
  }

  const code = getCustomIdPart(interaction.customId, 1);
  const winner = getCustomIdPart(interaction.customId, 2);

  if (!["A", "B"].includes(winner)) {
    return interaction.reply({
      content: "Vencedor inválido.",
      ephemeral: true
    });
  }

  const match = getMatchByCode(code);

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (match.status !== "disputed") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      ephemeral: true
    });
  }

  let result;

  try {
    result = db.transaction(() => {
      const applied = applyMatchResult({
        matchId: match.id,
        winnerTeam: winner,
        confirmedBy: interaction.user.id,
        allowedStatus: "disputed"
      });

      recordStaffAction({
        staffId: interaction.user.id,
        actionType: "resolve_match_dispute",
        matchId: match.id,
        reason: "Resultado definido pela Staff",
        details: { winnerTeam: winner }
      });

      return applied;
    })();
  } catch (error) {
    return handleResultError(interaction, error);
  }

  return interaction.update({
    embeds: [
      createFinishedMatchEmbed(match, result, {
        staffResolved: true,
        resolvedBy: interaction.user.id
      })
    ],
    components: []
  });
}

// ==========================================
// STAFF CANCELA PARTIDA
// ==========================================

async function handleStaffCancel(interaction) {
  if (!hasStaffRole(interaction)) {
    return interaction.reply({
      content: "Você não possui permissão para cancelar disputas.",
      ephemeral: true
    });
  }

  const match = getMatchByCode(
    getCustomIdPart(interaction.customId, 1)
  );

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (match.status !== "disputed") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      ephemeral: true
    });
  }

  try {
    db.transaction(() => {
      cancelMatch({
        matchId: match.id,
        cancelledBy: interaction.user.id
      });

      recordStaffAction({
        staffId: interaction.user.id,
        actionType: "cancel_disputed_match",
        matchId: match.id,
        reason: "Partida cancelada pela Staff"
      });
    })();
  } catch (error) {
    return handleResultError(interaction, error);
  }

  return interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Partida ${match.match_code} cancelada`)
        .setDescription(
          "A Staff cancelou a partida após analisar a contestação."
        )
        .addFields(
          { name: "Mapa", value: match.map, inline: true },
          { name: "Pontos", value: "Nenhum ponto aplicado.", inline: true },
          {
            name: "Resolvido por",
            value: `<@${interaction.user.id}>`
          }
        )
        .setTimestamp()
    ],
    components: []
  });
}

// ==========================================
// TRATAMENTO DE ERROS
// ==========================================

async function handleResultError(interaction, error) {
  console.error("Erro ao processar resultado:", error);

  const messages = {
    MATCH_NOT_FOUND: "Essa partida não foi encontrada.",
    RESULT_ALREADY_PROCESSED: "O resultado já foi processado.",
    INVALID_WINNER: "O vencedor informado é inválido.",
    INVALID_MATCH_PLAYERS: "A partida não possui um 5v5 válido.",
    MATCH_WITHOUT_SEASON: "A partida não possui temporada.",
    INVALID_RESULT_STATUS: "Status de resultado inválido."
  };

  const content = messages[error.message] ||
    "Não foi possível processar o resultado da partida.";

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({
      content,
      ephemeral: true
    });
  }

  return interaction.reply({
    content,
    ephemeral: true
  });
}

// ==========================================
// ROTEAMENTO DE RESULTADOS
// ==========================================

async function handleResultInteraction(interaction) {
  const id = interaction.customId;

  if (id.startsWith("result_report:")) {
    return handleResultReport(interaction);
  }

  if (id.startsWith("result_winner:")) {
    return handleWinnerSelection(interaction);
  }

  if (id.startsWith("result_confirm:")) {
    return handleResultConfirmation(interaction);
  }

  if (id.startsWith("result_dispute:")) {
    return handleResultDispute(interaction);
  }

  if (id.startsWith("staff_result:")) {
    return handleStaffResult(interaction);
  }

  if (id.startsWith("staff_cancel:")) {
    return handleStaffCancel(interaction);
  }
}

module.exports = {
  WIN_POINTS,
  LOSS_POINTS,
  getWinPoints,
  getLossPoints,
  handleResultInteraction,
  handleResultReport,
  handleWinnerSelection,
  handleResultConfirmation,
  handleResultDispute,
  handleStaffResult,
  handleStaffCancel,
  applyMatchResult,
  cancelMatch
};
