const { badge, playerBadge } = require("../services/rankBadges");
const { matchTeam } = require("../services/teamLabels");

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const {
  ensurePlayerInSeason
} = require("../services/seasonService");

const WIN_POINTS = config.matchmaking.winPoints;
const LOSS_POINTS = config.matchmaking.lossPoints;

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451,
  warning: 0xD99B32,
  neutral: 0x454650
};

// ==========================================
// UTILITÁRIOS
// ==========================================

function getWinPoints() {
  return WIN_POINTS;
}

function getLossPoints() {
  return LOSS_POINTS;
}

function safeText(value, max = 100) {
  return String(value ?? "—")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, max);
}

function getMatchByCode(code) {
  if (!code) return null;

  return db.prepare(`
    SELECT * FROM matches
    WHERE match_code = ?
  `).get(code) || null;
}

function getCustomIdPart(id, index) {
  return id?.split(":")[index] || null;
}

function getStatusMessage(status) {
  const messages = {
    playing: "Essa partida ainda está em andamento.",
    pending_confirmation:
      "Já existe um resultado aguardando confirmação.",
    finished: "Essa partida já foi finalizada.",
    disputed:
      "Essa partida está sendo analisada pela Staff.",
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
      (Array.isArray(roles) &&
        roles.includes(staffRoleId))
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

// ==========================================
// COMPONENTS V2
// ==========================================

function createPanel({
  code,
  title,
  description,
  sections = [],
  footer = "",
  color = COLORS.primary,
  buttons = [],
  ephemeral = false
}) {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVI SIX PRO\n" +
        `### ${safeText(title, 150)}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Partida:** ${safeText(code)}\n\n` +
        description
      )
    );

  for (const section of sections) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${section.title}**\n${section.value}`
      )
    );
  }

  if (footer) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${footer}`
      )
    );
  }

  return {
    components: [
      container,
      ...buttons
    ],
    flags:
      MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: {
      parse: []
    }
  };
}

function createButtons(definitions) {
  return [
    new ActionRowBuilder().addComponents(
      definitions.map(item =>
        new ButtonBuilder()
          .setCustomId(item.id)
          .setLabel(item.label)
          .setStyle(item.style)
          .setEmoji(item.emoji)
      )
    )
  ];
}

function createFinishedMatchPanel(
  match,
  result,
  options = {}
) {
  const winners = result.players.filter(
    player => player.team === result.winnerTeam
  );

  const losers = result.players.filter(
    player => player.team !== result.winnerTeam
  );

  const playerList = players =>
    players.map(player =>
      `• ${badge(player.r6_rank) || playerBadge(player.discord_id)}<@${player.discord_id}> · ` +
      safeText(player.r6_nickname)
    ).join("\n") || "Nenhum jogador.";

  const sections = [
    {
      title: `🏆 VENCEDORES · +${WIN_POINTS} PONTOS`,
      value: playerList(winners)
    },
    {
      title: `DERROTADOS · ${LOSS_POINTS} PONTOS`,
      value: playerList(losers)
    }
  ];

  if (options.staffResolved) {
    sections.push({
      title: "DECISÃO DA STAFF",
      value:
        `Resultado definido por <@${options.resolvedBy}>.`
    });
  }

  return createPanel({
    code: match.match_code,
    title: "PARTIDA FINALIZADA",
    description:
      `🏆 **${matchTeam(db,match,result.winnerTeam)} venceu!**\n` +
      `**Mapa:** ${safeText(match.map)}\n` +
      "**Status:** Finalizada",
    sections,
    color: COLORS.success,
    footer: options.staffResolved
      ? "Resultado definido após contestação."
      : "Resultado confirmado pelos capitães."
  });
}

// ==========================================
// AUDITORIA STAFF
// ==========================================

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

  if (
    !["pending_confirmation", "disputed"]
      .includes(allowedStatus)
  ) {
    throw new Error("INVALID_RESULT_STATUS");
  }

  return db.transaction(() => {
    const match = db.prepare(`
      SELECT * FROM matches
      WHERE id = ?
    `).get(matchId);

    if (!match) {
      throw new Error("MATCH_NOT_FOUND");
    }

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
      INNER JOIN players p
        ON p.discord_id = mp.discord_id
      WHERE mp.match_id = ?
    `).all(matchId);

    const uniqueIds = new Set(
      players.map(player => player.discord_id)
    );

    if (
      players.length !==
        config.matchmaking.requiredPlayers ||
      uniqueIds.size !==
        config.matchmaking.requiredPlayers ||
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
      WHERE season_id = ?
        AND player_id = ?
    `);

    const seasonLoserUpdate = db.prepare(`
      UPDATE season_players
      SET points = points + ?,
          losses = losses + 1,
          matches_played = matches_played + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE season_id = ?
        AND player_id = ?
    `);

    for (const player of players) {
      ensurePlayerInSeason(
        player.player_id,
        match.season_id
      );

      if (player.team === winnerTeam) {
        winnerUpdate.run(
          WIN_POINTS,
          player.player_id
        );

        seasonWinnerUpdate.run(
          WIN_POINTS,
          match.season_id,
          player.player_id
        );
      } else {
        loserUpdate.run(
          LOSS_POINTS,
          player.player_id
        );

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
      WHERE id = ?
        AND status = ?
    `).run(
      winnerTeam,
      confirmedBy,
      matchId,
      allowedStatus
    );

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

function cancelMatch({
  matchId,
  cancelledBy = null
}) {
  return db.transaction(() => {
    const match = db.prepare(`
      SELECT * FROM matches
      WHERE id = ?
    `).get(matchId);

    if (!match) {
      throw new Error("MATCH_NOT_FOUND");
    }

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
      WHERE id = ?
        AND status = 'disputed'
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
      flags: MessageFlags.Ephemeral
    });
  }

  if (match.status !== "playing") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      flags: MessageFlags.Ephemeral
    });
  }

  const otherCaptain = getOtherCaptain(
    match,
    interaction.user.id
  );

  if (!otherCaptain) {
    return interaction.reply({
      content:
        "Somente os capitães podem informar o resultado.",
      flags: MessageFlags.Ephemeral
    });
  }

  const buttons = createButtons([
    {
      id: `result_winner:${match.match_code}:A`,
      label: `${matchTeam(db,match,"A",true)} venceu`,
      emoji: "🏆",
      style: ButtonStyle.Primary
    },
    {
      id: `result_winner:${match.match_code}:B`,
      label: `${matchTeam(db,match,"B",true)} venceu`,
      emoji: "🏆",
      style: ButtonStyle.Secondary
    }
  ]);

  return interaction.reply(
    createPanel({
      code: match.match_code,
      title: "INFORMAR RESULTADO",
      description:
        "Selecione o time vencedor da partida.\n\n" +
        `**Mapa:** ${safeText(match.map)}\n` +
        `**Seu time:** ${
          interaction.user.id ===
          match.captain_a_discord_id
            ? "A"
            : "B"
        }`,
      footer:
        "O outro capitão deverá confirmar o resultado.",
      buttons,
      ephemeral: true
    })
  );
}

// ==========================================
// SELECIONAR VENCEDOR
// ==========================================

async function handleWinnerSelection(interaction) {
  const code = getCustomIdPart(
    interaction.customId, 1
  );

  const winner = getCustomIdPart(
    interaction.customId, 2
  );

  if (!["A", "B"].includes(winner)) {
    return interaction.reply({
      content: "O vencedor informado é inválido.",
      flags: MessageFlags.Ephemeral
    });
  }

  const match = getMatchByCode(code);

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (match.status !== "playing") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      flags: MessageFlags.Ephemeral
    });
  }

  const otherCaptain = getOtherCaptain(
    match,
    interaction.user.id
  );

  if (!otherCaptain) {
    return interaction.reply({
      content:
        "Somente os capitães podem informar o resultado.",
      flags: MessageFlags.Ephemeral
    });
  }

  const updated = db.prepare(`
    UPDATE matches
    SET winner_team = ?,
        status = 'pending_confirmation',
        result_submitted_by = ?,
        result_submitted_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'playing'
  `).run(
    winner,
    interaction.user.id,
    match.id
  );

  if (updated.changes !== 1) {
    return interaction.update(
      createPanel({
        code,
        title: "RESULTADO JÁ INFORMADO",
        description:
          "Já existe um resultado registrado.",
        color: COLORS.neutral,
        ephemeral: true
      })
    );
  }

  await interaction.update(
    createPanel({
      code,
      title: "RESULTADO ENVIADO",
      description:
        `Você informou que o **${matchTeam(db,match,winner)}** venceu.\n\n` +
        "Aguardando confirmação do outro capitão.",
      color: COLORS.success,
      ephemeral: true
    })
  );

  const buttons = createButtons([
    {
      id: `result_confirm:${code}`,
      label: "Confirmar",
      emoji: "✅",
      style: ButtonStyle.Success
    },
    {
      id: `result_dispute:${code}`,
      label: "Contestar",
      emoji: "⚠️",
      style: ButtonStyle.Danger
    }
  ]);

  // A mensagem pública precisa ser enviada ao canal.
  // Uma resposta a uma interação efêmera permanece efêmera.
  const channel = interaction.channel;

  if (!channel?.send) {
    throw new Error(
      "RESULT_CONFIRMATION_CHANNEL_UNAVAILABLE"
    );
  }

  return channel.send(
    createPanel({
      code,
      title: "CONFIRMAÇÃO DE RESULTADO",
      description:
        `<@${interaction.user.id}> informou que o ` +
        `**${matchTeam(db,match,winner)}** venceu.\n\n` +
        `<@${otherCaptain}>, confirme ou conteste.`,
      sections: [
        {
          title: "MAPA",
          value: safeText(match.map)
        },
        {
          title: "RESULTADO INFORMADO",
          value: `${matchTeam(db,match,winner)}`
        }
      ],
      footer:
        "Os pontos serão aplicados somente após a confirmação.",
      color: COLORS.warning,
      buttons
    })
  );
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
      flags: MessageFlags.Ephemeral
    });
  }

  if (match.status !== "pending_confirmation") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      flags: MessageFlags.Ephemeral
    });
  }

  const otherCaptain = getOtherCaptain(
    match,
    match.result_submitted_by
  );

  if (
    !otherCaptain ||
    interaction.user.id !== otherCaptain
  ) {
    return interaction.reply({
      content:
        "Somente o outro capitão pode confirmar.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (!["A", "B"].includes(match.winner_team)) {
    return interaction.reply({
      content: "O vencedor armazenado é inválido.",
      flags: MessageFlags.Ephemeral
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

  return interaction.update(
    createFinishedMatchPanel(match, result)
  );
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
      flags: MessageFlags.Ephemeral
    });
  }

  if (match.status !== "pending_confirmation") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      flags: MessageFlags.Ephemeral
    });
  }

  const otherCaptain = getOtherCaptain(
    match,
    match.result_submitted_by
  );

  if (
    !otherCaptain ||
    interaction.user.id !== otherCaptain
  ) {
    return interaction.reply({
      content:
        "Somente o outro capitão pode contestar.",
      flags: MessageFlags.Ephemeral
    });
  }

  const updated = db.prepare(`
    UPDATE matches
    SET status = 'disputed',
        result_confirmed_by = NULL,
        result_confirmed_at = NULL
    WHERE id = ?
      AND status = 'pending_confirmation'
  `).run(match.id);

  if (updated.changes !== 1) {
    return interaction.reply({
      content:
        "Não foi possível contestar essa partida.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.update(
    createPanel({
      code: match.match_code,
      title: "RESULTADO CONTESTADO",
      description:
        `Contestação registrada por ` +
        `<@${interaction.user.id}>.\n\n` +
        "**Nenhum ponto foi aplicado.**\n" +
        "A Staff deverá analisar a partida.",
      color: COLORS.warning,
      footer: "Aguardando decisão administrativa."
    })
  );

  return sendDisputeToStaff(
    interaction,
    match
  );
}

// ==========================================
// ENVIAR DISPUTA À STAFF
// ==========================================

async function sendDisputeToStaff(interaction, match) {
  try {
    const channel =
      await interaction.client.channels.fetch(
        config.discord.staffChannelId
      );

    if (!channel?.isTextBased() || !channel.send) {
      return;
    }

    const buttons = createButtons([
      {
        id: `staff_result:${match.match_code}:A`,
        label: `${matchTeam(db,match,"A",true)} venceu`,
        emoji: "🏆",
        style: ButtonStyle.Primary
      },
      {
        id: `staff_result:${match.match_code}:B`,
        label: `${matchTeam(db,match,"B",true)} venceu`,
        emoji: "🏆",
        style: ButtonStyle.Secondary
      },
      {
        id: `staff_cancel:${match.match_code}`,
        label: "Cancelar partida",
        emoji: "❌",
        style: ButtonStyle.Danger
      }
    ]);

    await channel.send(
      createPanel({
        code: match.match_code,
        title: "DISPUTA · ANÁLISE STAFF",
        description:
          "Uma partida precisa de análise administrativa.",
        sections: [
          {
            title: "RESULTADO INFORMADO",
            value: `${matchTeam(db,match,match.winner_team)}`
          },
          {
            title: "INFORMADO POR",
            value: `<@${match.result_submitted_by}>`
          },
          {
            title: "CONTESTADO POR",
            value: `<@${interaction.user.id}>`
          },
          {
            title: "MAPA",
            value: safeText(match.map)
          }
        ],
        footer:
          "A decisão será registrada no histórico da Staff.",
        color: COLORS.warning,
        buttons
      })
    );
  } catch (error) {
    console.error(
      "Erro ao enviar disputa para Staff:",
      error
    );
  }
}

// ==========================================
// STAFF DEFINE VENCEDOR
// ==========================================

async function handleStaffResult(interaction) {
  if (!hasStaffRole(interaction)) {
    return interaction.reply({
      content:
        "Você não possui permissão para resolver disputas.",
      flags: MessageFlags.Ephemeral
    });
  }

  const code = getCustomIdPart(
    interaction.customId, 1
  );

  const winner = getCustomIdPart(
    interaction.customId, 2
  );

  if (!["A", "B"].includes(winner)) {
    return interaction.reply({
      content: "Vencedor inválido.",
      flags: MessageFlags.Ephemeral
    });
  }

  const match = getMatchByCode(code);

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (match.status !== "disputed") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      flags: MessageFlags.Ephemeral
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
        details: {
          winnerTeam: winner
        }
      });

      return applied;
    })();
  } catch (error) {
    return handleResultError(interaction, error);
  }

  return interaction.update(
    createFinishedMatchPanel(
      match,
      result,
      {
        staffResolved: true,
        resolvedBy: interaction.user.id
      }
    )
  );
}

// ==========================================
// STAFF CANCELA PARTIDA
// ==========================================

async function handleStaffCancel(interaction) {
  if (!hasStaffRole(interaction)) {
    return interaction.reply({
      content:
        "Você não possui permissão para cancelar disputas.",
      flags: MessageFlags.Ephemeral
    });
  }

  const match = getMatchByCode(
    getCustomIdPart(interaction.customId, 1)
  );

  if (!match) {
    return interaction.reply({
      content: "Essa partida não foi encontrada.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (match.status !== "disputed") {
    return interaction.reply({
      content: getStatusMessage(match.status),
      flags: MessageFlags.Ephemeral
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

  return interaction.update(
    createPanel({
      code: match.match_code,
      title: "PARTIDA CANCELADA",
      description:
        "A Staff cancelou a partida após analisar a contestação.",
      sections: [
        {
          title: "MAPA",
          value: safeText(match.map)
        },
        {
          title: "PONTUAÇÃO",
          value: "Nenhum ponto aplicado."
        },
        {
          title: "RESOLVIDO POR",
          value: `<@${interaction.user.id}>`
        }
      ],
      color: COLORS.neutral,
      footer: "Decisão registrada no histórico da Staff."
    })
  );
}

// ==========================================
// TRATAMENTO DE ERROS
// ==========================================

async function handleResultError(interaction, error) {
  console.error(
    "Erro ao processar resultado:",
    error
  );

  const messages = {
    MATCH_NOT_FOUND:
      "Essa partida não foi encontrada.",
    RESULT_ALREADY_PROCESSED:
      "O resultado já foi processado.",
    INVALID_WINNER:
      "O vencedor informado é inválido.",
    INVALID_MATCH_PLAYERS:
      "A partida não possui um 5v5 válido.",
    MATCH_WITHOUT_SEASON:
      "A partida não possui temporada.",
    INVALID_RESULT_STATUS:
      "Status de resultado inválido."
  };

  const content =
    messages[error.message] ||
    "Não foi possível processar o resultado da partida.";

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({
      content,
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral
  });
}

// ==========================================
// ROTEAMENTO
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

// ==========================================
// EXPORTAÇÕES
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

