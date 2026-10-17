
const { EmbedBuilder, MessageFlags } = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");

const {
  getActiveSeason,
  ensurePlayerInSeason
} = require("./season");

async function handlePoints(interaction) {
  const action = interaction.options.getSubcommand();
  const member = interaction.member;
  const roles = member?.roles;

  const isStaff = Boolean(
    roles?.cache?.has?.(config.discord.staffRoleId) ||
    (Array.isArray(roles) &&
      roles.includes(config.discord.staffRoleId))
  );

  if (action !== "consultar" && !isStaff) {
    return interaction.reply({
      content: "Somente a Staff pode executar essa ação.",
      flags: MessageFlags.Ephemeral
    });
  }

  const user =
    interaction.options.getUser(
      "jogador",
      action !== "consultar"
    ) || interaction.user;

  const player = db.prepare(`
    SELECT *
    FROM players
    WHERE discord_id = ?
  `).get(user.id);

  if (!player) {
    return interaction.reply({
      content: "Jogador não cadastrado.",
      flags: MessageFlags.Ephemeral
    });
  }

  // ==========================================
  // CONSULTAR PONTUAÇÃO
  // ==========================================

  if (action === "consultar") {
    const season = getActiveSeason();

    const seasonStats = season
      ? db.prepare(`
          SELECT points
          FROM season_players
          WHERE season_id = ?
            AND player_id = ?
        `).get(season.id, player.id)
      : null;

    return interaction.reply({
      content:
        `**${player.r6_nickname}** — ` +
        `Geral: **${player.points} pts**` +
        (
          season
            ? ` • Temporada: **${seasonStats?.points ?? 0} pts**`
            : ""
        )
    });
  }

  // ==========================================
  // HISTÓRICO DE PONTOS
  // ==========================================

  if (action === "historico") {
    const rows = db.prepare(`
      SELECT *
      FROM points_history
      WHERE player_discord_id = ?
      ORDER BY id DESC
      LIMIT 10
    `).all(user.id);

    const content = rows.length
      ? rows.map(row => (
          `#${row.id} • ${row.action} ${row.amount} • ` +
          `${row.previous_points} → ${row.new_points} • ` +
          `<@${row.staff_discord_id}> • ${row.reason}`
        )).join("\n").slice(0, 1900)
      : "Nenhuma alteração manual registrada.";

    return interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
      allowedMentions: {
        parse: []
      }
    });
  }

  // ==========================================
  // VALIDAR QUANTIDADE
  // ==========================================

  const quantity = interaction.options.getInteger(
    "quantidade",
    true
  );

  const reason =
    interaction.options.getString("motivo")?.trim() ||
    "Ajuste manual da Staff";

  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 0 ||
    (action !== "definir" && quantity === 0)
  ) {
    return interaction.reply({
      content: "Quantidade inválida.",
      flags: MessageFlags.Ephemeral
    });
  }

  // ==========================================
  // TRANSAÇÃO SQLITE
  // ==========================================

  const result = db.transaction(() => {
    const current = db.prepare(`
      SELECT *
      FROM players
      WHERE id = ?
    `).get(player.id);

    const before = current.points;

    const after =
      action === "adicionar"
        ? before + quantity
        : action === "remover"
          ? before - quantity
          : quantity;

    if (!Number.isSafeInteger(after)) {
      throw new Error(
        "Pontuação fora do limite seguro."
      );
    }

    const delta = after - before;

    db.prepare(`
      UPDATE players
      SET
        points = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(after, current.id);

    const season = getActiveSeason();

    if (season) {
      ensurePlayerInSeason(current.id, season.id);

      db.prepare(`
        UPDATE season_players
        SET
          points = points + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE season_id = ?
          AND player_id = ?
      `).run(
        delta,
        season.id,
        current.id
      );
    }

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
      user.id,
      interaction.user.id,
      action === "adicionar"
        ? "add"
        : action === "remover"
          ? "remove"
          : "set",
      quantity,
      before,
      after,
      reason,
      season?.id ?? null
    );

    return {
      before,
      after,
      delta
    };
  })();

  // ==========================================
  // RESPOSTA
  // ==========================================

  const embed = new EmbedBuilder()
    .setTitle("Pontuação atualizada")
    .setDescription(
      `<@${user.id}> • **${player.r6_nickname}**`
    )
    .addFields(
      {
        name: "Anterior",
        value: String(result.before),
        inline: true
      },
      {
        name: "Alteração",
        value:
          `${result.delta >= 0 ? "+" : ""}${result.delta}`,
        inline: true
      },
      {
        name: "Atual",
        value: String(result.after),
        inline: true
      },
      {
        name: "Motivo",
        value: reason
      }
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    allowedMentions: {
      parse: []
    }
  });
}

module.exports = handlePoints;
