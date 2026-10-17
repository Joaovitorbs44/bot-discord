
const {
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");

const {
  getActiveSeason,
  ensurePlayerInSeason,
  refreshSeason
} = require("../services/seasonService");

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const ACTIONS = [
  "adicionar",
  "remover",
  "definir",
  "consultar",
  "historico"
];

const STAFF_ACTIONS = [
  "adicionar",
  "remover",
  "definir",
  "historico"
];

// ==========================================
// PERMISSÕES DA STAFF
// ==========================================

function hasStaffPermission(interaction) {
  if (!interaction.inGuild()) {
    return false;
  }

  const staffRoleId =
    config.discord.staffRoleId;

  const roles =
    interaction.member?.roles;

  const hasStaffRole = Boolean(
    staffRoleId &&
    (
      roles?.cache?.has?.(staffRoleId) ||
      (
        Array.isArray(roles) &&
        roles.includes(staffRoleId)
      )
    )
  );

  const isAdministrator = Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );

  return hasStaffRole || isAdministrator;
}

// ==========================================
// RESPOSTA PRIVADA
// ==========================================

function replyPrivate(interaction, content) {
  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: {
      parse: []
    }
  });
}

// ==========================================
// CONSULTAR JOGADOR
// ==========================================

function getPlayer(discordId) {
  return db.prepare(`
    SELECT
      id,
      discord_id,
      discord_username,
      r6_nickname,
      points,
      wins,
      losses,
      matches_played
    FROM players
    WHERE discord_id = ?
  `).get(discordId) || null;
}

// ==========================================
// HISTÓRICO DE PONTUAÇÃO
// ==========================================

function getPointsHistory(discordId, limit = 10) {
  return db.prepare(`
    SELECT
      id,
      player_discord_id,
      staff_discord_id,
      action,
      amount,
      previous_points,
      new_points,
      reason,
      season_id,
      created_at
    FROM points_history
    WHERE player_discord_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(discordId, limit);
}

// ==========================================
// NOMES DAS AÇÕES
// ==========================================

function getActionLabel(action) {
  const labels = {
    add: "Adição",
    remove: "Remoção",
    set: "Definição"
  };

  return labels[action] || action;
}

// ==========================================
// FORMATAR HISTÓRICO
// ==========================================

function formatHistory(rows) {
  if (!rows.length) {
    return "Nenhuma alteração manual registrada.";
  }

  return rows.map(row => {
    const change =
      row.new_points - row.previous_points;

    const changeText =
      `${change >= 0 ? "+" : ""}${change}`;

    const reason = String(
      row.reason || "Não informado"
    )
      .replace(/@/g, "@\u200b")
      .slice(0, 100);

    return (
      `**#${row.id} — ${getActionLabel(row.action)}**\n` +
      `Alteração: **${changeText} pontos**\n` +
      `Pontuação: **${row.previous_points} → ${row.new_points}**\n` +
      `Staff: <@${row.staff_discord_id}>\n` +
      `Motivo: ${reason}\n` +
      `Data: ${row.created_at}`
    );
  }).join("\n\n").slice(0, 1900);
}

// ==========================================
// CONSULTAR PONTOS
// ==========================================

async function handleConsult(interaction, user, player) {
  const seasonResult = refreshSeason();

  const season =
    seasonResult?.season ||
    getActiveSeason();

  const seasonStats = season
    ? db.prepare(`
        SELECT
          points,
          wins,
          losses,
          matches_played
        FROM season_players
        WHERE season_id = ?
          AND player_id = ?
      `).get(season.id, player.id)
    : null;

  const embed = new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("PONTUAÇÃO DO JOGADOR")
    .setDescription(
      `<@${user.id}> · **${player.r6_nickname}**`
    )
    .addFields(
      {
        name: "Pontuação geral",
        value: `${player.points} pontos`,
        inline: true
      },
      {
        name: "Temporada atual",
        value: `${seasonStats?.points ?? 0} pontos`,
        inline: true
      },
      {
        name: "Vitórias",
        value: String(player.wins),
        inline: true
      },
      {
        name: "Derrotas",
        value: String(player.losses),
        inline: true
      },
      {
        name: "Partidas",
        value: String(player.matches_played),
        inline: true
      },
      {
        name: "Temporada",
        value: season?.name || "Nenhuma temporada ativa",
        inline: false
      }
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: {
      parse: []
    }
  });
}

// ==========================================
// CONSULTAR HISTÓRICO
// ==========================================

async function handleHistory(interaction, user, player) {
  const rows = getPointsHistory(user.id, 10);

  const embed = new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("HISTÓRICO DE PONTUAÇÃO")
    .setDescription(
      `**${player.r6_nickname}**\n\n` +
      formatHistory(rows)
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: {
      parse: []
    }
  });
}

// ==========================================
// VALIDAR AJUSTE
// ==========================================

function calculateNewPoints(
  action,
  currentPoints,
  quantity
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 0
  ) {
    throw new Error("INVALID_POINTS_AMOUNT");
  }

  if (
    action !== "definir" &&
    quantity === 0
  ) {
    throw new Error("INVALID_POINTS_AMOUNT");
  }

  let newPoints;

  switch (action) {
    case "adicionar":
      newPoints = currentPoints + quantity;
      break;

    case "remover":
      newPoints = currentPoints - quantity;
      break;

    case "definir":
      newPoints = quantity;
      break;

    default:
      throw new Error("INVALID_POINTS_ACTION");
  }

  if (!Number.isSafeInteger(newPoints)) {
    throw new Error("POINTS_OVERFLOW");
  }

  return newPoints;
}

// ==========================================
// APLICAR AJUSTE DE PONTOS
// ==========================================

function applyPointsAdjustment({
  playerId,
  playerDiscordId,
  staffDiscordId,
  action,
  quantity,
  reason
}) {
  // Verifica a temporada antes da transação
  // de alteração de pontuação.
  const seasonResult = refreshSeason();

  const season =
    seasonResult?.season ||
    getActiveSeason();

  return db.transaction(() => {
    const player = db.prepare(`
      SELECT
        id,
        discord_id,
        r6_nickname,
        points
      FROM players
      WHERE id = ?
        AND discord_id = ?
    `).get(
      playerId,
      playerDiscordId
    );

    if (!player) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    const previousPoints = player.points;

    const newPoints = calculateNewPoints(
      action,
      previousPoints,
      quantity
    );

    const delta =
      newPoints - previousPoints;

    // ======================================
    // PONTUAÇÃO GERAL
    // ======================================

    const updated = db.prepare(`
      UPDATE players
      SET
        points = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      newPoints,
      player.id
    );

    if (updated.changes !== 1) {
      throw new Error("POINTS_UPDATE_FAILED");
    }

    // ======================================
    // PONTUAÇÃO DA TEMPORADA
    // ======================================

    let seasonPoints = null;

    if (season) {
      ensurePlayerInSeason(
        player.id,
        season.id
      );

      const seasonUpdate = db.prepare(`
        UPDATE season_players
        SET
          points = points + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE season_id = ?
          AND player_id = ?
      `).run(
        delta,
        season.id,
        player.id
      );

      if (seasonUpdate.changes !== 1) {
        throw new Error("SEASON_POINTS_UPDATE_FAILED");
      }

      const seasonPlayer = db.prepare(`
        SELECT points
        FROM season_players
        WHERE season_id = ?
          AND player_id = ?
      `).get(
        season.id,
        player.id
      );

      seasonPoints =
        seasonPlayer?.points ?? null;
    }

    // ======================================
    // REGISTRAR HISTÓRICO
    // ======================================

    db.prepare(`
      INSERT INTO points_history (
        player_discord_id,
        staff_discord_id,
        action,
        amount,
        previous_points,
        new_points,
        reason,
        season_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      playerDiscordId,
      staffDiscordId,
      action === "adicionar"
        ? "add"
        : action === "remover"
          ? "remove"
          : "set",
      quantity,
      previousPoints,
      newPoints,
      reason,
      season?.id ?? null
    );

    return {
      player,
      previousPoints,
      newPoints,
      delta,
      season,
      seasonPoints
    };
  })();
}

// ==========================================
// MENSAGENS DE ERRO
// ==========================================

function getErrorMessage(error) {
  const messages = {
    PLAYER_NOT_FOUND:
      "O jogador não foi encontrado no banco de dados.",

    INVALID_POINTS_AMOUNT:
      "Informe uma quantidade válida de pontos.",

    INVALID_POINTS_ACTION:
      "A ação de pontuação é inválida.",

    POINTS_OVERFLOW:
      "A pontuação ultrapassou o limite permitido.",

    POINTS_UPDATE_FAILED:
      "Não foi possível atualizar a pontuação geral.",

    SEASON_POINTS_UPDATE_FAILED:
      "Não foi possível atualizar a pontuação da temporada."
  };

  return (
    messages[error.message] ||
    "Não foi possível processar essa operação."
  );
}

// ==========================================
// COMANDO PRINCIPAL
// ==========================================

async function handlePoints(interaction) {
  try {
    const action =
      interaction.options.getSubcommand();

    // ======================================
    // VALIDAR AÇÃO
    // ======================================

    if (!ACTIONS.includes(action)) {
      return replyPrivate(
        interaction,
        "Subcomando de pontuação inválido."
      );
    }

    // ======================================
    // VALIDAR PERMISSÕES
    // ======================================

    if (
      STAFF_ACTIONS.includes(action) &&
      !hasStaffPermission(interaction)
    ) {
      return replyPrivate(
        interaction,
        "Somente a Staff pode executar essa ação."
      );
    }

    // ======================================
    // IDENTIFICAR JOGADOR
    // ======================================

    const user =
      interaction.options.getUser("jogador") ||
      interaction.user;

    const player = getPlayer(user.id);

    if (!player) {
      return replyPrivate(
        interaction,
        "Esse jogador não está cadastrado no matchmaking."
      );
    }

    // ======================================
    // CONSULTAR PONTUAÇÃO
    // ======================================

    if (action === "consultar") {
      return handleConsult(
        interaction,
        user,
        player
      );
    }

    // ======================================
    // CONSULTAR HISTÓRICO
    // ======================================

    if (action === "historico") {
      return handleHistory(
        interaction,
        user,
        player
      );
    }

    // ======================================
    // VALIDAR QUANTIDADE
    // ======================================

    const quantity =
      interaction.options.getInteger(
        "quantidade",
        true
      );

    const reason =
      (
        interaction.options.getString("motivo") ||
        "Ajuste manual realizado pela Staff."
      ).trim().slice(0, 500);

    // ======================================
    // EXECUTAR ALTERAÇÃO
    // ======================================

    const result = applyPointsAdjustment({
      playerId: player.id,
      playerDiscordId: user.id,
      staffDiscordId: interaction.user.id,
      action,
      quantity,
      reason: reason ||
        "Ajuste manual realizado pela Staff."
    });

    // ======================================
    // MONTAR RESPOSTA
    // ======================================

    const changeText =
      `${result.delta >= 0 ? "+" : ""}${result.delta}`;

    const embed = new EmbedBuilder()
      .setColor(0x278451)
      .setTitle("PONTUAÇÃO ATUALIZADA")
      .setDescription(
        `<@${user.id}> · **${player.r6_nickname}**`
      )
      .addFields(
        {
          name: "Pontuação anterior",
          value: String(result.previousPoints),
          inline: true
        },
        {
          name: "Alteração",
          value: changeText,
          inline: true
        },
        {
          name: "Pontuação atual",
          value: String(result.newPoints),
          inline: true
        },
        {
          name: "Temporada atual",
          value: result.season
            ? `${result.seasonPoints} pontos`
            : "Nenhuma",
          inline: true
        },
        {
          name: "Responsável",
          value: `<@${interaction.user.id}>`,
          inline: true
        },
        {
          name: "Motivo",
          value: reason || "Não informado",
          inline: false
        }
      )
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      allowedMentions: {
        parse: []
      }
    });
  } catch (error) {
    console.error(
      "[Pontos] Erro ao executar comando:",
      error
    );

    const content =
      getErrorMessage(error);

    if (
      interaction.replied ||
      interaction.deferred
    ) {
      return interaction.followUp({
        content,
        flags: MessageFlags.Ephemeral
      });
    }

    return replyPrivate(
      interaction,
      content
    );
  }
}

module.exports = handlePoints;
