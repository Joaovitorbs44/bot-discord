const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

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
  cancelReadyCheck
} = require(
  "./ready"
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
 * /limpar-fila
 */
async function handleClearQueueCommand(
  interaction
) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "Apenas membros da Staff podem limpar a fila.",
      ephemeral: true
    });
  }

  const players =
    queueState.getSize();

  const locked =
    queueState.isQueueLocked();

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Limpar fila"
      )
      .setDescription(
        "Tem certeza que deseja limpar completamente a fila do matchmaking?"
      )
      .addFields(
        {
          name:
            "Jogadores na fila",

          value:
            String(players),

          inline: true
        },

        {
          name:
            "Estado",

          value:
            locked
              ? "Bloqueada"
              : "Aberta",

          inline: true
        }
      )
      .setFooter({
        text:
          "Esta ação removerá todos os jogadores da fila."
      });

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "clear_queue_confirm"
          )
          .setLabel(
            "Limpar fila"
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "clear_queue_cancel"
          )
          .setLabel(
            "Cancelar"
          )
          .setStyle(
            ButtonStyle.Secondary
          )
      );

  return interaction.reply({
    embeds: [
      embed
    ],

    components: [
      buttons
    ],

    ephemeral: true
  });
}

/*
 * Confirma a limpeza.
 */
async function handleClearQueueConfirm(
  interaction
) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "Apenas membros da Staff podem limpar a fila.",
      ephemeral: true
    });
  }

  /*
   * Confirma imediatamente
   * a interação do botão.
   */
  await interaction.deferUpdate();

  /*
   * Cancela qualquer Ready Check
   * antes de alterar a fila.
   */
  const readyCheckCancelled =
    await cancelReadyCheck();

  /*
   * Remove todos os jogadores
   * e limpa os cooldowns.
   */
  const removedPlayers =
    queueState.clearQueue();

  /*
   * Garante que a fila
   * volte a ficar aberta.
   */
  queueState.unlockQueue();

  /*
   * Atualiza o painel principal.
   */
  await updateQueuePanel();

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Fila limpa"
      )
      .setDescription(
        `A fila foi limpa por <@${interaction.user.id}>.`
      )
      .addFields(
        {
          name:
            "Jogadores removidos",

          value:
            String(
              removedPlayers
            ),

          inline: true
        },

        {
          name:
            "Ready Check",

          value:
            readyCheckCancelled
              ? "Cancelado"
              : "Não estava ativo",

          inline: true
        }
      )
      .setFooter({
        text:
          "A fila está aberta novamente."
      });

  return interaction.editReply({
    embeds: [
      embed
    ],

    components: []
  });
}

/*
 * Cancela a operação.
 */
async function handleClearQueueCancel(
  interaction
) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "Apenas membros da Staff podem executar esta ação.",
      ephemeral: true
    });
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Limpeza cancelada"
      )
      .setDescription(
        "Nenhum jogador foi removido da fila."
      );

  return interaction.update({
    embeds: [
      embed
    ],

    components: []
  });
}

module.exports = {
  handleClearQueueCommand,
  handleClearQueueConfirm,
  handleClearQueueCancel
};
