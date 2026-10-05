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
  startCaptainVote
} = require(
  "./captains"
);

const readyPlayers =
  new Set();

let readyCheckActive =
  false;

let readyCheckPlayers =
  [];

let readyCheckMessage =
  null;

let readyCheckTimeout =
  null;

const READY_CHECK_TIME =
  config.matchmaking.readyCheckSeconds *
  1000;

/*
 * Inicia o Ready Check.
 */
async function startReadyCheck(
  interaction,
  players
) {
  if (readyCheckActive) {
    return;
  }

  if (
    !Array.isArray(players) ||
    players.length !==
      config.matchmaking.requiredPlayers
  ) {
    throw new Error(
      "INVALID_READY_CHECK_PLAYERS"
    );
  }

  readyCheckPlayers = [
    ...players
  ];

  readyPlayers.clear();

  /*
   * Marcamos como ativo antes
   * de gerar o painel para que
   * o botão seja criado habilitado.
   */
  readyCheckActive =
    true;

  queueState.lockQueue();

  try {
    readyCheckMessage =
      await interaction.followUp({
        ...createReadyCheckPanel(),
        fetchReply: true
      });
  } catch (error) {
    readyCheckActive =
      false;

    readyCheckPlayers =
      [];

    readyPlayers.clear();

    readyCheckMessage =
      null;

    queueState.unlockQueue();

    throw error;
  }

  readyCheckTimeout =
    setTimeout(
      () => {
        handleReadyCheckTimeout()
          .catch(
            (error) => {
              console.error(
                "Erro no timeout do Ready Check:",
                error
              );
            }
          );
      },
      READY_CHECK_TIME
    );
}

/*
 * Processa confirmação.
 */
async function handleReadyCheck(
  interaction
) {
  if (!readyCheckActive) {
    return interaction.reply({
      content:
        "Não existe um Ready Check ativo.",
      ephemeral: true
    });
  }

  const playerIsInReadyCheck =
    readyCheckPlayers.some(
      (player) =>
        player.discordId ===
        interaction.user.id
    );

  if (!playerIsInReadyCheck) {
    return interaction.reply({
      content:
        "Você não participa deste Ready Check.",
      ephemeral: true
    });
  }

  if (
    readyPlayers.has(
      interaction.user.id
    )
  ) {
    return interaction.reply({
      content:
        "Você já confirmou que está pronto.",
      ephemeral: true
    });
  }

  readyPlayers.add(
    interaction.user.id
  );

  await interaction.update(
    createReadyCheckPanel()
  );

  /*
   * Todos confirmaram.
   */
  if (
    readyPlayers.size ===
    readyCheckPlayers.length
  ) {
    await finishReadyCheck(
      interaction
    );
  }
}

/*
 * Monta painel do Ready Check.
 */
function createReadyCheckPanel() {
  const confirmed =
    readyCheckPlayers.filter(
      (player) =>
        readyPlayers.has(
          player.discordId
        )
    );

  const waiting =
    readyCheckPlayers.filter(
      (player) =>
        !readyPlayers.has(
          player.discordId
        )
    );

  const confirmedList =
    confirmed.length > 0
      ? confirmed
          .map(
            (player) =>
              `✅ ${player.nickname}`
          )
          .join("\n")
      : "Nenhum jogador confirmou.";

  const waitingList =
    waiting.length > 0
      ? waiting
          .map(
            (player) =>
              `⏳ ${player.nickname}`
          )
          .join("\n")
      : "Todos confirmaram.";

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Ready Check"
      )
      .setDescription(
        "Confirme sua presença para iniciar a partida.\n\n" +
        `Você possui **${config.matchmaking.readyCheckSeconds} segundos** para confirmar.`
      )
      .addFields(
        {
          name:
            "Confirmados",

          value:
            `${readyPlayers.size}/${readyCheckPlayers.length}`,

          inline: true
        },

        {
          name:
            "Prontos",

          value:
            confirmedList,

          inline: false
        },

        {
          name:
            "Aguardando",

          value:
            waitingList,

          inline: false
        }
      )
      .setFooter({
        text:
          "Rainbow Six Siege • Ready Check"
      });

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "ready_confirm"
          )
          .setLabel(
            "Estou pronto"
          )
          .setStyle(
            ButtonStyle.Success
          )
          .setDisabled(
            !readyCheckActive ||
            readyPlayers.size ===
              readyCheckPlayers.length
          )
      );

  return {
    embeds: [
      embed
    ],

    components: [
      buttons
    ]
  };
}

/*
 * Todos confirmaram.
 */
async function finishReadyCheck(
  interaction
) {
  if (!readyCheckActive) {
    return;
  }

  if (readyCheckTimeout) {
    clearTimeout(
      readyCheckTimeout
    );

    readyCheckTimeout =
      null;
  }

  const playersForMatch = [
    ...readyCheckPlayers
  ];

  /*
   * O Ready Check terminou,
   * mas a fila continua bloqueada.
   */
  readyCheckActive =
    false;

  if (readyCheckMessage) {
    const embed =
      new EmbedBuilder()
        .setTitle(
          "Ready Check concluído"
        )
        .setDescription(
          `Todos os ${playersForMatch.length} jogadores confirmaram presença.`
        )
        .setFooter({
          text:
            "Escolha dos capitães iniciada"
        });

    await readyCheckMessage.edit({
      embeds: [
        embed
      ],

      components: []
    });
  }

  /*
   * Limpa somente os dados
   * específicos do Ready Check.
   */
  readyPlayers.clear();

  readyCheckPlayers =
    [];

  readyCheckMessage =
    null;

  try {
    await startCaptainVote(
      interaction,
      playersForMatch
    );
  } catch (error) {
    /*
     * Se a etapa seguinte falhar,
     * libera a fila para evitar
     * travamento permanente.
     */
    queueState.unlockQueue();

    await updateQueueMessage();

    throw error;
  }
}

/*
 * Tempo do Ready Check acabou.
 */
async function handleReadyCheckTimeout() {
  if (!readyCheckActive) {
    return;
  }

  readyCheckActive =
    false;

  const missingPlayers =
    readyCheckPlayers.filter(
      (player) =>
        !readyPlayers.has(
          player.discordId
        )
    );

  /*
   * Remove somente quem
   * não confirmou.
   */
  for (
    const player
    of missingPlayers
  ) {
    queueState.removePlayer(
      player.discordId
    );
  }

  const missingList =
    missingPlayers.length > 0
      ? missingPlayers
          .map(
            (player) =>
              `❌ ${player.nickname}`
          )
          .join("\n")
      : "Nenhum.";

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Ready Check encerrado"
      )
      .setDescription(
        `O tempo de ${config.matchmaking.readyCheckSeconds} segundos terminou.`
      )
      .addFields({
        name:
          "Removidos da fila",

        value:
          missingList
      })
      .setFooter({
        text:
          "Os jogadores que confirmaram continuam na fila."
      });

  if (readyCheckMessage) {
    try {
      await readyCheckMessage.edit({
        embeds: [
          embed
        ],

        components: []
      });
    } catch (error) {
      console.error(
        "Erro ao encerrar painel do Ready Check:",
        error
      );
    }
  }

  /*
   * Ready Check falhou:
   * libera novamente a fila.
   */
  queueState.unlockQueue();

  resetReadyCheck();

  await updateQueueMessage();
}

/*
 * Cancela administrativamente
 * um Ready Check ativo.
 *
 * Usado pelo comando /limpar-fila.
 */
async function cancelReadyCheck() {
  const wasActive =
    readyCheckActive;

  if (readyCheckTimeout) {
    clearTimeout(
      readyCheckTimeout
    );

    readyCheckTimeout =
      null;
  }

  if (
    readyCheckMessage &&
    wasActive
  ) {
    try {
      const embed =
        new EmbedBuilder()
          .setTitle(
            "Ready Check cancelado"
          )
          .setDescription(
            "O Ready Check foi cancelado pela Staff."
          )
          .setFooter({
            text:
              "A fila foi limpa."
          });

      await readyCheckMessage.edit({
        embeds: [
          embed
        ],

        components: []
      });
    } catch (error) {
      console.error(
        "Erro ao atualizar Ready Check cancelado:",
        error
      );
    }
  }

  resetReadyCheck();

  return wasActive;
}

/*
 * Atualiza painel principal
 * sem dependência circular no
 * carregamento dos módulos.
 */
async function updateQueueMessage() {
  const queueMessage =
    queueState.getQueueMessage();

  if (!queueMessage) {
    return;
  }

  try {
    const {
      createQueuePanel
    } = require(
      "./queue"
    );

    await queueMessage.edit(
      createQueuePanel()
    );
  } catch (error) {
    console.error(
      "Erro ao atualizar fila após Ready Check:",
      error
    );
  }
}

/*
 * Limpa estado do Ready Check.
 */
function resetReadyCheck() {
  if (readyCheckTimeout) {
    clearTimeout(
      readyCheckTimeout
    );

    readyCheckTimeout =
      null;
  }

  readyCheckActive =
    false;

  readyCheckPlayers =
    [];

  readyPlayers.clear();

  readyCheckMessage =
    null;
}

function isReadyCheckActive() {
  return readyCheckActive;
}

function getReadyCheckPlayers() {
  return [
    ...readyCheckPlayers
  ];
}

function getReadyPlayers() {
  return [
    ...readyPlayers
  ];
}

module.exports = {
  startReadyCheck,
  handleReadyCheck,
  cancelReadyCheck,

  isReadyCheckActive,

  getReadyCheckPlayers,
  getReadyPlayers
};
