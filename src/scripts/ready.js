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

const {
  logReadyCheckStarted,
  logReadyCheckTimeout
} = require(
  "./logs"
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

let readyCheckClient =
  null;

const READY_CHECK_TIME =
  config.matchmaking
    .readyCheckSeconds *
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
      config.matchmaking
        .requiredPlayers
  ) {
    throw new Error(
      "INVALID_READY_CHECK_PLAYERS"
    );
  }

  const uniquePlayers =
    new Set(
      players.map(
        (player) =>
          player.discordId
      )
    );

  if (
    uniquePlayers.size !==
    config.matchmaking
      .requiredPlayers
  ) {
    throw new Error(
      "INVALID_READY_CHECK_PLAYERS"
    );
  }

  readyCheckPlayers = [
    ...players
  ];

  readyPlayers.clear();

  readyCheckClient =
    interaction.client;

  readyCheckActive =
    true;

  queueState.lockQueue();

  try {
    readyCheckMessage =
      await interaction.followUp({
        ...createReadyCheckPanel(),
        fetchReply: true
      });

    await logReadyCheckStarted(
      interaction.client,
      readyCheckPlayers
    );
  } catch (error) {
    readyCheckActive =
      false;

    readyCheckPlayers =
      [];

    readyPlayers.clear();

    readyCheckMessage =
      null;

    readyCheckClient =
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
 * Monta painel.
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
        "A partida foi encontrada.\n\n" +
        "Confirme sua presença para continuar.\n\n" +
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

  readyCheckActive =
    false;

  if (readyCheckMessage) {
    const embed =
      new EmbedBuilder()
        .setTitle(
          "Ready Check concluído"
        )
        .setDescription(
          `✅ Todos os **${playersForMatch.length} jogadores** confirmaram presença.`
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

  readyPlayers.clear();

  readyCheckPlayers =
    [];

  readyCheckMessage =
    null;

  readyCheckClient =
    null;

  try {
    await startCaptainVote(
      interaction,
      playersForMatch
    );
  } catch (error) {
    queueState.unlockQueue();

    await updateQueueMessage();

    throw error;
  }
}

/*
 * Timeout.
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

    queueState.clearCooldown(
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
        `O tempo de **${config.matchmaking.readyCheckSeconds} segundos** terminou.`
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

  if (readyCheckClient) {
    await logReadyCheckTimeout(
      readyCheckClient,
      missingPlayers
    );
  }

  /*
   * Libera novamente
   * a fila.
   */
  queueState.unlockQueue();

  resetReadyCheck();

  await updateQueueMessage();
}

/*
 * Atualiza painel principal.
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
 * Reseta estado interno
 * do Ready Check.
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

  readyCheckClient =
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

  isReadyCheckActive,

  getReadyCheckPlayers,
  getReadyPlayers
};
