const config = require(
  "../config/config"
);

const db = require(
  "../database/database"
);

async function handleApprove(
  interaction
) {
  const isStaff =
    interaction.member.roles.cache.has(
      config.discord.staffRoleId
    );

  if (!isStaff) {
    return interaction.reply({
      content:
        "Você não possui permissão para aprovar solicitações.",
      ephemeral: true
    });
  }

  const requestId =
    interaction.customId.split(":")[1];

  const request =
    db.prepare(`
      SELECT *
      FROM access_requests
      WHERE id = ?
    `).get(
      requestId
    );

  if (!request) {
    return interaction.reply({
      content:
        "Essa solicitação não existe.",
      ephemeral: true
    });
  }

  if (
    request.status !==
    "pending"
  ) {
    return interaction.reply({
      content:
        "Essa solicitação já foi analisada.",
      ephemeral: true
    });
  }

  const existingPlayer =
    db.prepare(`
      SELECT *
      FROM players
      WHERE discord_id = ?
    `).get(
      request.discord_id
    );

  const transaction =
    db.transaction(() => {
      if (existingPlayer) {
        /*
         * Reativa o perfil antigo,
         * preservando histórico e
         * estatísticas.
         */
        db.prepare(`
          UPDATE players

          SET
            discord_username = ?,
            name = ?,
            twitch_nickname = ?,
            r6_nickname = ?,
            r6_rank = ?,
            access_active = 1,
            updated_at =
              CURRENT_TIMESTAMP

          WHERE discord_id = ?
        `).run(
          request.discord_username,
          request.name,
          request.twitch_nickname,
          request.r6_nickname,
          request.r6_rank,
          request.discord_id
        );
      } else {
        db.prepare(`
          INSERT INTO players (
            discord_id,
            discord_username,
            name,
            twitch_nickname,
            r6_nickname,
            r6_rank,
            access_active
          )

          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            1
          )
        `).run(
          request.discord_id,
          request.discord_username,
          request.name,
          request.twitch_nickname,
          request.r6_nickname,
          request.r6_rank
        );
      }

      db.prepare(`
        UPDATE access_requests

        SET
          status = 'approved',
          reviewed_by = ?,
          reviewed_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
      `).run(
        interaction.user.id,
        requestId
      );
    });

  transaction();

  try {
    const member =
      await interaction.guild.members.fetch(
        request.discord_id
      );

    await member.roles.add(
      config.discord.playerRoleId
    );

    await interaction.update({
      content:
        `✅ Solicitação de <@${request.discord_id}> aprovada por ${interaction.user}.\n` +
        "O cargo **Lobby** foi adicionado automaticamente.",
      embeds: [],
      components: []
    });
  } catch (error) {
    await interaction.update({
      content:
        `⚠️ A solicitação de <@${request.discord_id}> foi aprovada e o perfil foi criado/reativado, ` +
        "mas não foi possível adicionar o cargo Lobby automaticamente. " +
        "Verifique as permissões e a hierarquia de cargos do bot.",
      embeds: [],
      components: []
    });
  }
}

module.exports =
  handleApprove;