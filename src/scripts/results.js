const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");

const {
  ensurePlayerInSeason
} = require("../services/seasonService");

const WIN_POINTS =
  config.matchmaking.winPoints;

const LOSS_POINTS =
  config.matchmaking.lossPoints;

// ==========================================
// INTERAÇÕES DE RESULTADO
// ==========================================

async function handleResultInteraction(interaction) {
  const customId = interaction.customId;

  if (
    customId.startsWith("result_report:")
  ) {
    return handleResultReport(interaction);
  }

  if (
    customId.startsWith("result_winner:")
  ) {
    return handleWinnerSelection(interaction);
  }

  if (
    customId.startsWith("result_confirm:")
  ) {
    return handleResultConfirmation(
      interaction
    );
  }

  if (
    customId.startsWith("result_dispute:")
  ) {
    return handleResultDispute(
      interaction
    );
  }

  if (
    customId.startsWith("staff_result:")
  ) {
    return handleStaffResult(
      interaction
    );
  }

  if (
    customId.startsWith("staff_cancel:")
  ) {
    return handleStaffCancel(
      interaction
    );
  }
}

// ==========================================
// INFORMAR RESULTADO
// ==========================================

async function handleResultReport(
  interaction
) {
  const matchCode =
    getCustomIdPart(
      interaction.customId,
      1
    );

  const match =
    getMatchByCode(matchCode);

  if (!match) {
    return interaction.reply({
      content:
        "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (
    match.status !== "playing"
  ) {
    return interaction.reply({
      content:
        getStatusMessage(
          match.status
        ),
      ephemeral: true
    });
  }

  if (
    interaction.user.id !==
      match.captain_a_discord_id &&
    interaction.user.id !==
      match.captain_b_discord_id
  ) {
    return interaction.reply({
      content:
        "Somente os capitães podem informar o resultado da partida.",
      ephemeral: true
    });
  }

  const captainTeam =
    interaction.user.id ===
      match.captain_a_discord_id
      ? "A"
      : "B";

  const embed =
    new EmbedBuilder()
      .setTitle(
        `Resultado ${match.match_code}`
      )
      .setDescription(
        "Informe qual time venceu a partida."
      )
      .addFields(
        {
          name: "Mapa",
          value:
            match.map || "—",
          inline: true
        },
        {
          name: "Você é",
          value:
            `Capitão do Time ${captainTeam}`,
          inline: true
        }
      )
      .setFooter({
        text:
          "O outro capitão deverá confirmar o resultado."
      });

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `result_winner:${match.match_code}:A`
          )
          .setLabel(
            "Time A venceu"
          )
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `result_winner:${match.match_code}:B`
          )
          .setLabel(
            "Time B venceu"
          )
          .setStyle(
            ButtonStyle.Primary
          )
      );

  return interaction.reply({
    embeds: [embed],
    components: [buttons],
    ephemeral: true
  });
}

// ==========================================
// SELECIONAR VENCEDOR
// ==========================================

async function handleWinnerSelection(
  interaction
) {
  const matchCode =
    getCustomIdPart(
      interaction.customId,
      1
    );

  const winnerTeam =
    getCustomIdPart(
      interaction.customId,
      2
    );

  if (
    winnerTeam !== "A" &&
    winnerTeam !== "B"
  ) {
    return interaction.reply({
      content:
        "O resultado informado é inválido.",
      ephemeral: true
    });
  }

  const match =
    getMatchByCode(matchCode);

  if (!match) {
    return interaction.reply({
      content:
        "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (
    match.status !== "playing"
  ) {
    return interaction.reply({
      content:
        getStatusMessage(
          match.status
        ),
      ephemeral: true
    });
  }

  if (
    interaction.user.id !==
      match.captain_a_discord_id &&
    interaction.user.id !==
      match.captain_b_discord_id
  ) {
    return interaction.reply({
      content:
        "Somente os capitães podem informar o resultado.",
      ephemeral: true
    });
  }

  const reportingCaptainId =
    interaction.user.id;

  const confirmingCaptainId =
    reportingCaptainId ===
      match.captain_a_discord_id
      ? match.captain_b_discord_id
      : match.captain_a_discord_id;

  const update =
    db.prepare(`
      UPDATE matches

      SET
        winner_team = ?,
        status = 'pending_confirmation',
        result_submitted_by = ?,
        result_submitted_at =
          CURRENT_TIMESTAMP

      WHERE
        id = ?
        AND status = 'playing'
    `).run(
      winnerTeam,
      reportingCaptainId,
      match.id
    );

  if (
    update.changes !== 1
  ) {
    return interaction.update({
      content:
        "O resultado dessa partida já foi informado.",
      embeds: [],
      components: []
    });
  }

  await interaction.update({
    content:
      `Você informou que o **Time ${winnerTeam}** venceu.`,
    embeds: [],
    components: []
  });

  const embed =
    new EmbedBuilder()
      .setTitle(
        `Confirmação de resultado ${match.match_code}`
      )
      .setDescription(
        `<@${reportingCaptainId}> informou que o **Time ${winnerTeam}** venceu.\n\n` +
        `<@${confirmingCaptainId}>, confirme ou conteste o resultado.`
      )
      .addFields(
        {
          name: "Mapa",
          value:
            match.map || "—",
          inline: true
        },
        {
          name:
            "Resultado informado",
          value:
            `Time ${winnerTeam}`,
          inline: true
        }
      )
      .setFooter({
        text:
          "A pontuação só será aplicada após a confirmação."
      });

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `result_confirm:${match.match_code}`
          )
          .setLabel("Confirmar")
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `result_dispute:${match.match_code}`
          )
          .setLabel("Contestar")
          .setStyle(
            ButtonStyle.Danger
          )
      );

  return interaction.followUp({
    embeds: [embed],
    components: [buttons]
  });
}

// ==========================================
// CONFIRMAR RESULTADO
// ==========================================

async function handleResultConfirmation(
  interaction
) {
  const matchCode =
    getCustomIdPart(
      interaction.customId,
      1
    );

  const match =
    getMatchByCode(matchCode);

  if (!match) {
    return interaction.reply({
      content:
        "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (
    match.status !==
    "pending_confirmation"
  ) {
    return interaction.reply({
      content:
        getStatusMessage(
          match.status
        ),
      ephemeral: true
    });
  }

  if (
    !match.result_submitted_by
  ) {
    return interaction.reply({
      content:
        "Não existe um resultado aguardando confirmação.",
      ephemeral: true
    });
  }

  const confirmingCaptainId =
    match.result_submitted_by ===
      match.captain_a_discord_id
      ? match.captain_b_discord_id
      : match.captain_a_discord_id;

  if (
    interaction.user.id !==
    confirmingCaptainId
  ) {
    return interaction.reply({
      content:
        "Somente o outro capitão pode confirmar esse resultado.",
      ephemeral: true
    });
  }

  if (
    interaction.user.id ===
    match.result_submitted_by
  ) {
    return interaction.reply({
      content:
        "Você não pode confirmar o resultado que informou.",
      ephemeral: true
    });
  }

  if (
    match.winner_team !== "A" &&
    match.winner_team !== "B"
  ) {
    return interaction.reply({
      content:
        "O vencedor armazenado para essa partida é inválido.",
      ephemeral: true
    });
  }

  let result;

  try {
    result =
      applyMatchResult({
        matchId:
          match.id,
        winnerTeam:
          match.winner_team,
        confirmedBy:
          interaction.user.id,
        allowedStatus:
          "pending_confirmation"
      });
  } catch (error) {
    return handleResultError(
      interaction,
      error
    );
  }

  const embed =
    createFinishedMatchEmbed(
      match,
      result
    );

  return interaction.update({
    embeds: [embed],
    components: []
  });
}

// ==========================================
// CONTESTAR RESULTADO
// ==========================================

async function handleResultDispute(
  interaction
) {
  const matchCode =
    getCustomIdPart(
      interaction.customId,
      1
    );

  const match =
    getMatchByCode(matchCode);

  if (!match) {
    return interaction.reply({
      content:
        "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (
    match.status !==
    "pending_confirmation"
  ) {
    return interaction.reply({
      content:
        getStatusMessage(
          match.status
        ),
      ephemeral: true
    });
  }

  if (
    !match.result_submitted_by
  ) {
    return interaction.reply({
      content:
        "Não existe um resultado aguardando confirmação.",
      ephemeral: true
    });
  }

  const disputingCaptainId =
    match.result_submitted_by ===
      match.captain_a_discord_id
      ? match.captain_b_discord_id
      : match.captain_a_discord_id;

  if (
    interaction.user.id !==
    disputingCaptainId
  ) {
    return interaction.reply({
      content:
        "Somente o outro capitão pode contestar esse resultado.",
      ephemeral: true
    });
  }

  const update =
    db.prepare(`
      UPDATE matches

      SET
        status = 'disputed',
        result_confirmed_by = NULL,
        result_confirmed_at = NULL

      WHERE
        id = ?
        AND status =
          'pending_confirmation'
    `).run(
      match.id
    );

  if (
    update.changes !== 1
  ) {
    return interaction.reply({
      content:
        "Não foi possível contestar essa partida.",
      ephemeral: true
    });
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        `Partida ${match.match_code} contestada`
      )
      .setDescription(
        `O resultado foi contestado por <@${interaction.user.id}>.\n\n` +
        "**Nenhum ponto foi aplicado.** A Staff deverá analisar a partida."
      )
      .addFields(
        {
          name:
            "Resultado informado",
          value:
            match.winner_team
              ? `Time ${match.winner_team}`
              : "—",
          inline: true
        },
        {
          name: "Status",
          value:
            "Aguardando Staff",
          inline: true
        }
      )
      .setTimestamp();

  await interaction.update({
    embeds: [embed],
    components: []
  });

  return sendDisputeToStaff(
    interaction,
    match
  );
}

// ==========================================
// ENVIAR DISPUTA PARA STAFF
// ==========================================

async function sendDisputeToStaff(
  interaction,
  match
) {
  const staffChannelId =
    config.discord.staffChannelId;

  if (!staffChannelId) {
    return;
  }

  try {
    const staffChannel =
      await interaction.client
        .channels.fetch(
          staffChannelId
        );

    if (
      !staffChannel ||
      !staffChannel.isTextBased()
    ) {
      return;
    }

    const embed =
      new EmbedBuilder()
        .setTitle(
          `Resultado contestado • ${match.match_code}`
        )
        .setDescription(
          "Uma partida precisa de análise da Staff."
        )
        .addFields(
          {
            name:
              "Resultado informado",
            value:
              match.winner_team
                ? `Time ${match.winner_team}`
                : "—",
            inline: true
          },
          {
            name:
              "Enviado por",
            value:
              match.result_submitted_by
                ? `<@${match.result_submitted_by}>`
                : "—",
            inline: true
          },
          {
            name:
              "Contestado por",
            value:
              `<@${interaction.user.id}>`,
            inline: true
          },
          {
            name: "Mapa",
            value:
              match.map || "—",
            inline: true
          }
        )
        .setFooter({
          text:
            "A Staff deve definir o resultado oficial ou cancelar a partida."
        })
        .setTimestamp();

    const buttons =
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `staff_result:${match.match_code}:A`
            )
            .setLabel(
              "Time A venceu"
            )
            .setStyle(
              ButtonStyle.Primary
            ),

          new ButtonBuilder()
            .setCustomId(
              `staff_result:${match.match_code}:B`
            )
            .setLabel(
              "Time B venceu"
            )
            .setStyle(
              ButtonStyle.Primary
            ),

          new ButtonBuilder()
            .setCustomId(
              `staff_cancel:${match.match_code}`
            )
            .setLabel(
              "Cancelar partida"
            )
            .setStyle(
              ButtonStyle.Danger
            )
        );

    await staffChannel.send({
      embeds: [embed],
      components: [buttons]
    });
  } catch (error) {
    console.error(
      "Erro ao enviar disputa para a Staff:",
      error
    );
  }
}

// ==========================================
// STAFF DEFINE VENCEDOR
// ==========================================

async function handleStaffResult(
  interaction
) {
  if (
    !hasStaffRole(interaction)
  ) {
    return interaction.reply({
      content:
        "Você não possui permissão para resolver resultados contestados.",
      ephemeral: true
    });
  }

  const matchCode =
    getCustomIdPart(
      interaction.customId,
      1
    );

  const winnerTeam =
    getCustomIdPart(
      interaction.customId,
      2
    );

  if (
    winnerTeam !== "A" &&
    winnerTeam !== "B"
  ) {
    return interaction.reply({
      content:
        "O vencedor selecionado é inválido.",
      ephemeral: true
    });
  }

  const match =
    getMatchByCode(
      matchCode
    );

  if (!match) {
    return interaction.reply({
      content:
        "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (
    match.status !== "disputed"
  ) {
    return interaction.reply({
      content:
        getStatusMessage(
          match.status
        ),
      ephemeral: true
    });
  }

  let result;

  try {
    result =
      applyMatchResult({
        matchId:
          match.id,
        winnerTeam,
        confirmedBy:
          interaction.user.id,
        allowedStatus:
          "disputed"
      });
  } catch (error) {
    return handleResultError(
      interaction,
      error
    );
  }

  const embed =
    createFinishedMatchEmbed(
      match,
      result,
      {
        staffResolved: true,
        resolvedBy:
          interaction.user.id
      }
    );

  return interaction.update({
    embeds: [embed],
    components: []
  });
}

// ==========================================
// STAFF CANCELA PARTIDA
// ==========================================

async function handleStaffCancel(
  interaction
) {
  if (
    !hasStaffRole(interaction)
  ) {
    return interaction.reply({
      content:
        "Você não possui permissão para cancelar resultados contestados.",
      ephemeral: true
    });
  }

  const matchCode =
    getCustomIdPart(
      interaction.customId,
      1
    );

  const match =
    getMatchByCode(
      matchCode
    );

  if (!match) {
    return interaction.reply({
      content:
        "Essa partida não foi encontrada.",
      ephemeral: true
    });
  }

  if (
    match.status !== "disputed"
  ) {
    return interaction.reply({
      content:
        getStatusMessage(
          match.status
        ),
      ephemeral: true
    });
  }

  try {
    cancelMatch({
      matchId:
        match.id,
      cancelledBy:
        interaction.user.id
    });
  } catch (error) {
    return handleResultError(
      interaction,
      error
    );
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        `Partida ${match.match_code} cancelada`
      )
      .setDescription(
        "A Staff analisou a contestação e cancelou a partida."
      )
      .addFields(
        {
          name: "Mapa",
          value:
            match.map || "—",
          inline: true
        },
        {
          name: "Pontos",
          value:
            "Nenhum ponto foi aplicado.",
          inline: true
        },
        {
          name:
            "Resolvido por",
          value:
            `<@${interaction.user.id}>`,
          inline: false
        }
      )
      .setTimestamp();

  return interaction.update({
    embeds: [embed],
    components: []
  });
}

// ==========================================
// APLICAR RESULTADO
// ==========================================

function applyMatchResult({
  matchId,
  winnerTeam,
  confirmedBy = null,
  allowedStatus =
    "pending_confirmation"
}) {
  if (
    winnerTeam !== "A" &&
    winnerTeam !== "B"
  ) {
    throw new Error(
      "INVALID_WINNER"
    );
  }

  if (
    allowedStatus !==
      "pending_confirmation" &&
    allowedStatus !==
      "disputed"
  ) {
    throw new Error(
      "INVALID_RESULT_STATUS"
    );
  }

  const transaction =
    db.transaction(() => {
      const match =
        db.prepare(`
          SELECT *
          FROM matches
          WHERE id = ?
          LIMIT 1
        `).get(
          matchId
        );

      if (!match) {
        throw new Error(
          "MATCH_NOT_FOUND"
        );
      }

      if (
        match.status !==
        allowedStatus
      ) {
        throw new Error(
          "RESULT_ALREADY_PROCESSED"
        );
      }

      if (
        !match.season_id
      ) {
        throw new Error(
          "MATCH_WITHOUT_SEASON"
        );
      }

      const matchPlayers =
        db.prepare(`
          SELECT
            match_players.*,
            players.id AS player_id,
            players.discord_id,
            players.r6_nickname,
            players.r6_rank

          FROM match_players

          INNER JOIN players
            ON players.discord_id =
              match_players.discord_id

          WHERE
            match_players.match_id = ?
        `).all(
          matchId
        );

      if (
        matchPlayers.length !==
        config.matchmaking.requiredPlayers
      ) {
        throw new Error(
          "INVALID_MATCH_PLAYERS"
        );
      }

      const uniquePlayers =
        new Set(
          matchPlayers.map(
            (player) =>
              player.discord_id
          )
        );

      if (
        uniquePlayers.size !==
        config.matchmaking.requiredPlayers
      ) {
        throw new Error(
          "INVALID_MATCH_PLAYERS"
        );
      }

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

      if (
        teamA.length !==
          config.matchmaking.teamSize ||
        teamB.length !==
          config.matchmaking.teamSize
      ) {
        throw new Error(
          "INVALID_MATCH_PLAYERS"
        );
      }

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

          WHERE id = ?
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

          WHERE id = ?
        `);

      const updateSeasonWinner =
        db.prepare(`
          UPDATE season_players

          SET
            points = points + ?,
            wins = wins + 1,
            matches_played =
              matches_played + 1,
            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            season_id = ?
            AND player_id = ?
        `);

      const updateSeasonLoser =
        db.prepare(`
          UPDATE season_players

          SET
            points = points + ?,
            losses = losses + 1,
            matches_played =
              matches_played + 1,
            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            season_id = ?
            AND player_id = ?
        `);

      for (
        const player
        of matchPlayers
      ) {
        ensurePlayerInSeason(
          player.player_id,
          match.season_id
        );

        const won =
          player.team ===
          winnerTeam;

        if (won) {
          updateWinner.run(
            WIN_POINTS,
            player.player_id
          );

          updateSeasonWinner.run(
            WIN_POINTS,
            match.season_id,
            player.player_id
          );
        } else {
          updateLoser.run(
            LOSS_POINTS,
            player.player_id
          );

          updateSeasonLoser.run(
            LOSS_POINTS,
            match.season_id,
            player.player_id
          );
        }
      }

      const finished =
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

          WHERE
            id = ?
            AND status = ?
        `).run(
          winnerTeam,
          confirmedBy,
          matchId,
          allowedStatus
        );

      if (
        finished.changes !== 1
      ) {
        throw new Error(
          "RESULT_ALREADY_PROCESSED"
        );
      }

      return {
        match,
        players:
          matchPlayers,
        winnerTeam
      };
    });

  return transaction();
}

// ==========================================
// CANCELAR PARTIDA
// ==========================================

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
          LIMIT 1
        `).get(
          matchId
        );

      if (!match) {
        throw new Error(
          "MATCH_NOT_FOUND"
        );
      }

      if (
        match.status ===
          "finished" ||
        match.status ===
          "cancelled"
      ) {
        throw new Error(
          "RESULT_ALREADY_PROCESSED"
        );
      }

      const result =
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

          WHERE
            id = ?
            AND status = 'disputed'
        `).run(
          cancelledBy,
          matchId
        );

      if (
        result.changes !== 1
      ) {
        throw new Error(
          "RESULT_ALREADY_PROCESSED"
        );
      }

      return match;
    });

  return transaction();
}

// ==========================================
// EMBED DE PARTIDA FINALIZADA
// ==========================================

function createFinishedMatchEmbed(
  match,
  result,
  options = {}
) {
  const winnerPlayers =
    result.players.filter(
      (player) =>
        player.team ===
        result.winnerTeam
    );

  const loserPlayers =
    result.players.filter(
      (player) =>
        player.team !==
        result.winnerTeam
    );

  const winnerList =
    winnerPlayers
      .map(
        (player) =>
          `• <@${player.discord_id}> — ${player.r6_nickname}`
      )
      .join("\n");

  const loserList =
    loserPlayers
      .map(
        (player) =>
          `• <@${player.discord_id}> — ${player.r6_nickname}`
      )
      .join("\n");

  const embed =
    new EmbedBuilder()
      .setTitle(
        `Partida ${match.match_code} finalizada`
      )
      .setDescription(
        `O **Time ${result.winnerTeam}** venceu a partida.`
      )
      .addFields(
        {
          name:
            `Vencedores • +${WIN_POINTS}`,
          value:
            winnerList || "—",
          inline: false
        },
        {
          name:
            `Derrotados • ${LOSS_POINTS}`,
          value:
            loserList || "—",
          inline: false
        }
      );

  if (
    options.staffResolved
  ) {
    embed.addFields({
      name:
        "Decisão da Staff",
      value:
        options.resolvedBy
          ? `Resultado definido por <@${options.resolvedBy}>.`
          : "Resultado definido pela Staff.",
      inline: false
    });

    embed.setFooter({
      text:
        "Resultado definido após contestação."
    });
  } else {
    embed.setFooter({
      text:
        "Resultado confirmado pelos dois capitães."
    });
  }

  embed.setTimestamp();

  return embed;
}

// ==========================================
// VERIFICAR STAFF
// ==========================================

function hasStaffRole(
  interaction
) {
  if (
    !interaction.inGuild()
  ) {
    return false;
  }

  const staffRoleId =
    config.discord.staffRoleId;

  if (!staffRoleId) {
    return false;
  }

  return interaction.member.roles
    .cache.has(
      staffRoleId
    );
}

// ==========================================
// BUSCAR PARTIDA
// ==========================================

function getMatchByCode(
  matchCode
) {
  if (!matchCode) {
    return null;
  }

  return db.prepare(`
    SELECT *
    FROM matches
    WHERE match_code = ?
    LIMIT 1
  `).get(
    matchCode
  );
}

// ==========================================
// CUSTOM ID
// ==========================================

function getCustomIdPart(
  customId,
  index
) {
  if (!customId) {
    return null;
  }

  const parts =
    customId.split(":");

  return (
    parts[index] ||
    null
  );
}

// ==========================================
// STATUS
// ==========================================

function getStatusMessage(
  status
) {
  if (
    status ===
    "playing"
  ) {
    return (
      "Essa partida ainda está em andamento."
    );
  }

  if (
    status ===
    "pending_confirmation"
  ) {
    return (
      "Já existe um resultado aguardando confirmação."
    );
  }

  if (
    status ===
    "finished"
  ) {
    return (
      "Essa partida já foi finalizada."
    );
  }

  if (
    status ===
    "disputed"
  ) {
    return (
      "Essa partida está sendo analisada pela Staff."
    );
  }

  if (
    status ===
    "cancelled"
  ) {
    return (
      "Essa partida foi cancelada."
    );
  }

  return (
    "Essa partida não aceita essa ação no momento."
  );
}

// ==========================================
// TRATAMENTO DE ERROS
// ==========================================

async function handleResultError(
  interaction,
  error
) {
  let message =
    "Não foi possível processar o resultado da partida.";

  if (
    error.message ===
    "MATCH_NOT_FOUND"
  ) {
    message =
      "Essa partida não foi encontrada.";
  }

  if (
    error.message ===
    "RESULT_ALREADY_PROCESSED"
  ) {
    message =
      "O resultado dessa partida já foi processado.";
  }

  if (
    error.message ===
    "INVALID_WINNER"
  ) {
    message =
      "O vencedor informado é inválido.";
  }

  if (
    error.message ===
    "INVALID_MATCH_PLAYERS"
  ) {
    message =
      "A partida não possui uma configuração 5v5 válida.";
  }

  if (
    error.message ===
    "MATCH_WITHOUT_SEASON"
  ) {
    message =
      "A partida não está vinculada a uma temporada.";
  }

  if (
    error.message ===
    "INVALID_RESULT_STATUS"
  ) {
    message =
      "O status usado para processar o resultado é inválido.";
  }

  try {
    if (
      interaction.deferred ||
      interaction.replied
    ) {
      return interaction.followUp({
        content:
          message,
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
        message,
      ephemeral: true
    });
  } catch {
    return null;
  }
}

// ==========================================
// PONTUAÇÃO
// ==========================================

function getWinPoints() {
  return WIN_POINTS;
}

function getLossPoints() {
  return LOSS_POINTS;
}

// ==========================================
// EXPORTS
// ==========================================

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