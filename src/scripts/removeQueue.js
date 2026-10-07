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

/*
 * Verifica se o usuário
 * possui o cargo da Staff.
 */
function isStaff(interaction) {
  if (
    !interaction.member
  ) {
    return false;
  }

  if (
    interaction.member.roles &&
    interaction.member.roles.cache
  ) {
    return interaction.member.roles.cache.has(
      config.discord.staffRoleId
    );
  }

  if (
    Array.isArray(
      interaction.member.roles
    )
  ) {
    return interaction.member.roles.includes(
      config.discord.staffRoleId
    );
  }

  return false;
}

/*
 * /remover-fila
 */
async function handleRemoveQueueCommand(
  interaction
) {
  await interaction.deferReply({
    ephemeral: true
  });

  if (!isStaff(interaction)) {
    return interaction.editReply({
      content:
        "Apenas membros da Staff podem remover jogadores da fila."
    });
  }

  const target =
    interaction.options.getUser(
      "jogador",
      true
    );

  if (
    !queueState.hasPlayer(
      target.id
    )
  ) {
    return interaction.editReply({
      content:
        `<@${target.id}> não está na fila.`
    });
  }

  /*
   * Não remover individualmente
   * durante formação da partida.
   */
  if (
    queueState.isQueueLocked()
  ) {
    return interaction.editReply({
      content:
        "A fila está bloqueada porque uma partida está sendo formada. Use `/limpar-fila` caso queira cancelar toda a formação."
    });
  }

  const removed =
    queueState.removePlayer(
      target.id
    );

  queueState.clearCooldown(
    target.id
  );

  if (!removed) {
    return interaction.editReply({
      content:
        "Não foi possível remover esse jogador da fila."
    });
  }

  await updateQueuePanel();

  return interaction.editReply({
    content:
      `✅ <@${target.id}> foi removido da fila.\n\n` +
      `Jogadores na fila: **${queueState.getSize()}/${config.matchmaking.requiredPlayers}**`
  });
}

module.exports = {
  handleRemoveQueueCommand
};
