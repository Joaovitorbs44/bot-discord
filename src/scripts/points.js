
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

const EPHEMERAL = MessageFlags.Ephemeral;

function isStaff(interaction) {
  if (!interaction.inGuild()) return false;

  const isAdmin = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  const roleId = config.discord.staffRoleId;
  const roles = interaction.member?.roles;

  const hasRole = Boolean(
    roleId &&
    (
      roles?.cache?.has?.(roleId) ||
      (Array.isArray(roles) && roles.includes(roleId))
    )
  );

  return Boolean(isAdmin || hasRole);
}

function getTargetUser(interaction) {
  return (
    interaction.options.getUser("usuario") ||
    interaction.options.getUser("jogador") ||
    interaction.user
  );
}

function getPlayer(discordId) {
  return db.prepare(`
    SELECT *
    FROM players
    WHERE discord_id = ?
  `).get(discordId) || null;
}

function getSeason() {
  const result = refreshSeason();

  return result?.season || getActiveSeason();
}

function getSeasonPoints(playerId, seasonId) {
  if (!seasonId) return 0;

  const stats = db.prepare(`
    SELECT points
    FROM season_players
    WHERE player_id = ?
      AND season_id = ?
  `).get(playerId, seasonId);

  return Number(stats?.points || 0);
}

function replyError(interaction, content) {
  const payload = {
    content,
    flags: EPHEMERAL
  };

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function adjustPoints({
  playerId,
  playerDiscordId,
  staffDiscordId,
  action,
  quantity,
  reason
}) {
  const season = getSeason();

  return db.transaction(() => {
    const player = db.prepare(`
      SELECT id, points, r6_nickname
      FROM players
      WHERE id = ?
        AND discord_id = ?
    `).get(playerId, playerDiscordId);

    if (!player) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    const previousPoints = Number(player.points);

    let newPoints;

    if (action === "adicionar") {
      newPoints = previousPoints + quantity;
    } else if (action === "remover") {
      newPoints = previousPoints - quantity;
    } else if (action === "definir") {
      newPoints = quantity;
    } else {
      throw new Error("INVALID_ACTION");
    }

    if (!Number.isSafeInteger(newPoints)) {
      throw new Error("INVALID_RESULT");
    }

    const difference = newPoints - previousPoints;

    const updated = db.prepare(`
      UPDATE players
      SET points = ?
      WHERE id = ?
    `).run(newPoints, playerId);

    if (updated.changes !== 1) {
      throw new Error("PLAYER_UPDATE_FAILED");
    }

    let seasonPoints = null;

    if (season) {
      ensurePlayerInSeason(playerId, season.id);

      const seasonUpdated = db.prepare(`
        UPDATE season_players
        SET points = points + ?
        WHERE player_id = ?
          AND season_id = ?
      `).run(
        difference,
        playerId,
        season.id
      );

      if (seasonUpdated.changes !== 1) {
        throw new Error("SEASON_UPDATE_FAILED");
      }

      seasonPoints = getSeasonPoints(
        playerId,
        season.id
      );
    }

    const historyAction = {
      adicionar: "add",
      remover: "remove",
      definir: "set"
    }[action];

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
      historyAction,
      quantity,
      previousPoints,
      newPoints,
      reason,
      season?.id ?? null
    );

    return {
      previousPoints,
      newPoints,
      difference,
      seasonPoints,
      season
    };
  })();
}

async function handleConsult(interaction, user, player) {
  const season = getSeason();

  const embed = new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("PONTUAÇÃO DO JOGADOR")
    .setDescription(
      `<@${user.id}> · **${player.r6_nickname}**`
    )
    .addFields(
      {
        name: "Pontos gerais",
        value: String(player.points),
        inline: true
      },
      {
        name: "Pontos da temporada",
        value: String(
          getSeasonPoints(player.id, season?.id)
        ),
        inline: true
      },
      {
        name: "Vitórias",
        value: String(player.wins || 0),
        inline: true
      },
      {
        name: "Derrotas",
        value: String(player.losses || 0),
        inline: true
      },
      {
        name: "Partidas",
        value: String(player.matches_played || 0),
        inline: true
      },
      {
        name: "Temporada",
        value: season?.name || "Nenhuma",
        inline: false
      }
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    flags: EPHEMERAL
  });
}

async function handleHistory(interaction, user, player) {
  const rows = db.prepare(`
    SELECT *
    FROM points_history
    WHERE player_discord_id = ?
    ORDER BY id DESC
    LIMIT 10
  `).all(user.id);

  const description = rows.length
    ? rows.map(row => {
        const delta =
          row.new_points - row.previous_points;

        const signed =
          `${delta >= 0 ? "+" : ""}${delta}`;

        const reason = String(
          row.reason || "Não informado"
        ).replace(/@/g, "@\u200b").slice(0, 100);

        return (
          `**#${row.id} — ${row.action}**\n` +
          `Alteração: **${signed}**\n` +
          `Pontos: ${row.previous_points} → ${row.new_points}\n` +
          `Staff: <@${row.staff_discord_id}>\n` +
          `Motivo: ${reason}`
        );
      }).join("\n\n").slice(0, 3900)
    : "Nenhuma alteração manual registrada.";

  const embed = new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("HISTÓRICO DE PONTUAÇÃO")
    .setDescription(
      `Jogador: **${player.r6_nickname}**\n\n` +
      description
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    flags: EPHEMERAL,
    allowedMentions: { parse: [] }
  });
}

async function handlePoints(interaction) {
  try {
    const action = interaction.options.getSubcommand();

    const allowed = [
      "adicionar",
      "remover",
      "definir",
      "consultar",
      "historico"
    ];

    if (!allowed.includes(action)) {
      return replyError(
        interaction,
        "Subcomando inválido."
      );
    }

    if (
      action !== "consultar" &&
      !isStaff(interaction)
    ) {
      return replyError(
        interaction,
        "Somente a Staff pode executar essa ação."
      );
    }

    const user = getTargetUser(interaction);
    const player = getPlayer(user.id);

    if (!player) {
      return replyError(
        interaction,
        "Esse jogador não está cadastrado."
      );
    }

    if (action === "consultar") {
      return handleConsult(
        interaction,
        user,
        player
      );
    }

    if (action === "historico") {
      return handleHistory(
        interaction,
        user,
        player
      );
    }

    const quantity =
      interaction.options.getInteger(
        "quantidade",
        true
      );

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      (action !== "definir" && quantity === 0)
    ) {
      return replyError(
        interaction,
        "Informe uma quantidade válida de pontos."
      );
    }

    const reason = String(
      interaction.options.getString("motivo") ||
      "Ajuste manual da Staff"
    ).trim().slice(0, 500);

    const result = adjustPoints({
      playerId: player.id,
      playerDiscordId: user.id,
      staffDiscordId: interaction.user.id,
      action,
      quantity,
      reason
    });

    const difference =
      `${result.difference >= 0 ? "+" : ""}` +
      result.difference;

    const embed = new EmbedBuilder()
      .setColor(0x278451)
      .setTitle("PONTUAÇÃO ATUALIZADA")
      .setDescription(
        `<@${user.id}> · **${player.r6_nickname}**`
      )
      .addFields(
        {
          name: "Antes",
          value: String(result.previousPoints),
          inline: true
        },
        {
          name: "Alteração",
          value: difference,
          inline: true
        },
        {
          name: "Agora",
          value: String(result.newPoints),
          inline: true
        },
        {
          name: "Temporada",
          value: result.season
            ? `${result.seasonPoints} pontos`
            : "Nenhuma",
          inline: true
        },
        {
          name: "Motivo",
          value: reason || "Ajuste manual",
          inline: false
        }
      )
      .setTimestamp();

    console.log(
      `[PONTOS] ${interaction.user.id} ` +
      `${action} ${quantity} para ${user.id}. ` +
      `${result.previousPoints} -> ${result.newPoints}`
    );

    return interaction.reply({
      embeds: [embed],
      flags: EPHEMERAL,
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    console.error(
      "[PONTOS] Erro:",
      error
    );

    return replyError(
      interaction,
      "Não foi possível atualizar os pontos. " +
      "Verifique os logs do Railway."
    );
  }
}

module.exports = handlePoints;
