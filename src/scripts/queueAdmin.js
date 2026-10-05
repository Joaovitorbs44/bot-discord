const config = require(
  "../config/config"
);

const queueState = require(
  "./queueState"
);

const {
  updateQueuePanel
} = require(
  "./queue"
);

const {
  logQueueRemoval
} = require(
  "./logs"
);

/*
 * Verifica se o usuário
 * pertence à Staff.
 */
function isStaff(
  interaction
) {
  if (
    !interaction.inGuild()
  ) {
    return false;
  }

  if (
    !interaction.member ||
    !interaction.member.roles
  ) {
    return false;
  }

  if (
    interaction.member.roles.cache
  ) {
    return interaction.member.roles
      .cache.has(
        config.discord.staffRoleId
      );
  }

  if (
    Array.isArray(
      interaction.member.roles
    )
  ) {
    return interaction.member.roles
      .includes(
        config.discord.staffRoleId
      );
  }

  return false;
}

/*
 * /remover-fila
 */
async function handleRemoveFromQueue(
  interaction
) {
  if (
    !isStaff(
      interaction
    )
  ) {
    return interaction.reply({
      content:
        "Você não possui permissão para remover jogadores da fila.",
      ephemeral: true
    });
  }

  /*
   * Não permitimos alterar a fila
   * enquanto uma partida já está
   * sendo formada.
   */
  if (
    queueState.isQueueLocked()
  ) {
    return interaction.reply({
      content:
        "A fila está bloqueada porque uma partida está sendo formada.",
      ephemeral: true
    });
  }

  const targetUser =
    interaction.options.getUser(
      "jogador",
      true
    );

  if (
    !queueState.hasPlayer(
      targetUser.id
    )
  ) {
    return interaction.reply({
      content:
        `${targetUser} não está na fila.`,
      ephemeral: true
    });
  }

  const removed =
    queueState.removePlayer(
      targetUser.id
    );

  if (!removed) {
    return interaction.reply({
      content:
        "Não foi possível remover esse jogador da fila.",
      ephemeral: true
    });
  }

  /*
   * Remove também qualquer
   * cooldown antigo.
   */
  queueState.clearCooldown(
    targetUser.id
  );

  await updateQueuePanel();

  await logQueueRemoval(
    interaction,
    targetUser
  );

  return interaction.reply({
    content:
      `✅ ${targetUser} foi removido da fila.`,
    ephemeral: true
  });
}

module.exports = {
  handleRemoveFromQueue
};
