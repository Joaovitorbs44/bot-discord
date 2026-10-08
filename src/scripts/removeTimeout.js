
const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");

async function handleRemoveTimeout(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "Este comando só pode ser usado no servidor.",
      flags: MessageFlags.Ephemeral
    });
  }

  const member = await interaction.guild.members.fetch(
    interaction.user.id
  );

  const staffRoleId = config.discord.staffRoleId;

  const isStaff =
    (staffRoleId && member.roles.cache.has(staffRoleId)) ||
    member.permissions.has(
      PermissionFlagsBits.Administrator
    );

  if (!isStaff) {
    return interaction.reply({
      content: "Somente a Staff pode remover timeouts.",
      flags: MessageFlags.Ephemeral
    });
  }

  const player = interaction.options.getUser(
    "jogador",
    true
  );

  const cooldown = db.prepare(`
    SELECT reason, expires_at
    FROM player_cooldowns
    WHERE discord_id = ?
  `).get(player.id);

  if (
    !cooldown ||
    cooldown.reason !== "ready_check_timeout" ||
    Number(cooldown.expires_at) <= Date.now()
  ) {
    return interaction.reply({
      content:
        `${player} não possui um timeout ativo por não confirmar o Ready Check.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const remainingMinutes = Math.ceil(
    (Number(cooldown.expires_at) - Date.now()) / 60000
  );

  const result = db.transaction(() => {
    const removed = db.prepare(`
      DELETE FROM player_cooldowns
      WHERE discord_id = ?
        AND reason = 'ready_check_timeout'
        AND expires_at > ?
    `).run(player.id, Date.now());

    if (!removed.changes) return false;

    db.prepare(`
      INSERT INTO staff_actions (
        staff_discord_id,
        action_type,
        target_discord_id,
        reason,
        details_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      interaction.user.id,
      "remove_ready_check_timeout",
      player.id,
      "Remoção manual de timeout do Ready Check",
      JSON.stringify({
        previousRemainingMinutes: remainingMinutes,
        previousExpiresAt: cooldown.expires_at
      }),
      Date.now()
    );

    return true;
  })();

  if (!result) {
    return interaction.reply({
      content: "O timeout já foi removido ou expirou.",
      flags: MessageFlags.Ephemeral
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("Timeout removido")
    .setDescription(
      `A penalidade de ${player} foi removida com sucesso.`
    )
    .addFields(
      {
        name: "Motivo original",
        value: "Não confirmou o Ready Check"
      },
      {
        name: "Tempo restante removido",
        value: `${remainingMinutes} minuto(s)`,
        inline: true
      },
      {
        name: "Responsável",
        value: `<@${interaction.user.id}>`,
        inline: true
      }
    )
    .setColor(0x57A773)
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

module.exports = {
  handleRemoveTimeout
};
