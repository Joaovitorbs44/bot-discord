const db = require(
  "../database/database"
);

const config = require(
  "../config/config"
);

async function handleRemoveAccess(
  interaction
) {
  const isStaff =
    interaction.member.roles.cache.has(
      config.discord.staffRoleId
    );

  if (!isStaff) {
    return interaction.reply({
      content:
        "Você não possui permissão para remover acessos.",
      ephemeral: true
    });
  }

  const selectedUser =
    interaction.options.getUser(
      "jogador"
    );

  if (!selectedUser) {
    return interaction.reply({
      content:
        "Selecione um jogador.",
      ephemeral: true
    });
  }

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
        "Esse usuário não possui um perfil no matchmaking.",
      ephemeral: true
    });
  }

  if (!player.access_active) {
    return interaction.reply({
      content:
        "O acesso desse jogador já está desativado.",
      ephemeral: true
    });
  }

  /*
   * Não permitimos remover acesso
   * durante uma partida ativa.
   */
  const activeMatch =
    db.prepare(`
      SELECT
        matches.match_code

      FROM match_players

      INNER JOIN matches
        ON matches.id =
          match_players.match_id

      WHERE
        match_players.discord_id = ?

        AND matches.status IN (
          'playing',
          'pending_confirmation',
          'disputed'
        )

      LIMIT 1
    `).get(
      selectedUser.id
    );

  if (activeMatch) {
    return interaction.reply({
      content:
        `Esse jogador participa da partida **${activeMatch.match_code}**. ` +
        "Finalize ou cancele a partida antes de remover o acesso.",
      ephemeral: true
    });
  }

  await interaction.deferReply({
    ephemeral: true
  });

  /*
   * Desativa o acesso sem apagar
   * perfil, estatísticas ou histórico.
   */
  db.prepare(`
    UPDATE players

    SET
      access_active = 0,
      updated_at = CURRENT_TIMESTAMP

    WHERE discord_id = ?
  `).run(
    selectedUser.id
  );

  /*
   * Remove a solicitação atual.
   *
   * Isso permite que o jogador
   * envie uma nova solicitação
   * futuramente.
   */
  db.prepare(`
    DELETE FROM access_requests
    WHERE discord_id = ?
  `).run(
    selectedUser.id
  );

  let roleRemoved = false;
  let roleWarning = null;

  try {
    const member =
      await interaction.guild.members.fetch(
        selectedUser.id
      );

    if (
      member.roles.cache.has(
        config.discord.playerRoleId
      )
    ) {
      await member.roles.remove(
        config.discord.playerRoleId
      );
    }

    roleRemoved = true;
  } catch (error) {
    roleWarning =
      "Não foi possível remover o cargo Lobby automaticamente.";
  }

  let message =
    `✅ Acesso de <@${selectedUser.id}> removido.\n\n` +
    `**Perfil:** preservado\n` +
    `**Histórico:** preservado\n` +
    `**Estatísticas:** preservadas\n` +
    `**Matchmaking:** bloqueado\n` +
    `**Nova solicitação:** permitida`;

  if (roleRemoved) {
    message +=
      "\n**Cargo Lobby:** removido";
  }

  if (roleWarning) {
    message +=
      `\n\n⚠️ ${roleWarning}`;
  }

  await interaction.editReply({
    content: message
  });
}

module.exports =
  handleRemoveAccess;