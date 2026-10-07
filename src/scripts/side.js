const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const config = require(
  "../config/config"
);

const {
  createMatch
} = require(
  "./match"
);

const queueState = require(
  "./queueState"
);

let sideChoiceActive = false;

let captainA = null;
let captainB = null;

let teamA = [];
let teamB = [];

let selectedMap = null;

let sideA = null;
let sideB = null;

/*
 * Inicia a escolha de lado.
 */
async function startSideChoice(
  interaction,
  matchData
) {
  if (sideChoiceActive) {
    throw new Error(
      "SIDE_CHOICE_ALREADY_ACTIVE"
    );
  }

  if (
    !matchData ||
    !matchData.map ||
    !matchData.captainA ||
    !matchData.captainB ||
    !Array.isArray(
      matchData.teamA
    ) ||
    !Array.isArray(
      matchData.teamB
    )
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_DATA"
    );
  }

  if (
    !matchData.captainA.discordId ||
    !matchData.captainB.discordId
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_CAPTAINS"
    );
  }

  if (
    matchData.captainA.discordId ===
    matchData.captainB.discordId
  ) {
    throw new Error(
      "SIDE_CHOICE_CAPTAINS_MUST_BE_DIFFERENT"
    );
  }

  if (
    matchData.teamA.length !==
      config.matchmaking.teamSize ||
    matchData.teamB.length !==
      config.matchmaking.teamSize
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_TEAM_SIZE"
    );
  }

  const allPlayers = [
    ...matchData.teamA,
    ...matchData.teamB
  ];

  const uniquePlayers =
    new Set(
      allPlayers.map(
        (player) =>
          player.discordId
      )
    );

  if (
    uniquePlayers.size !==
    config.matchmaking.requiredPlayers
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_PLAYERS"
    );
  }

  const captainAInTeam =
    matchData.teamA.some(
      (player) =>
        player.discordId ===
        matchData.captainA.discordId
    );

  const captainBInTeam =
    matchData.teamB.some(
      (player) =>
        player.discordId ===
        matchData.captainB.discordId
    );

  if (
    !captainAInTeam ||
    !captainBInTeam
  ) {
    throw new Error(
      "SIDE_CHOICE_CAPTAIN_NOT_IN_TEAM"
    );
  }

  captainA =
    matchData.captainA;

  captainB =
    matchData.captainB;

  teamA = [
    ...matchData.teamA
  ];

  teamB = [
    ...matchData.teamB
  ];

  selectedMap =
    matchData.map;

  sideA = null;
  sideB = null;

  sideChoiceActive = true;

  queueState.lockQueue();

  try {
    await interaction.followUp(
      createSideChoicePanel()
    );
  } catch (error) {
    resetSideChoice();

    throw error;
  }
}

/*
 * Painel de escolha.
 */
function createSideChoicePanel() {
  if (
    !captainA ||
    !captainB ||
    !selectedMap
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_STATE"
    );
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Escolha de lado"
      )
      .setDescription(
        `O mapa da partida será **${selectedMap}**.\n\n` +
        `<@${captainA.discordId}>, escolha o lado inicial do **Time A**.`
      )
      .addFields(
        {
          name:
            "Time A",

          value:
            `👑 ${captainA.nickname}`,

          inline: true
        },

        {
          name:
            "Time B",

          value:
            `👑 ${captainB.nickname}`,

          inline: true
        }
      )
      .setFooter({
        text:
          "O Time B receberá automaticamente o lado oposto."
      });

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "side_attack"
          )
          .setLabel(
            "Ataque"
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "side_defense"
          )
          .setLabel(
            "Defesa"
          )
          .setStyle(
            ButtonStyle.Primary
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
 * Processa escolha.
 */
async function handleSideChoice(
  interaction
) {
  if (!sideChoiceActive) {
    return interaction.reply({
      content:
        "Não existe uma escolha de lado ativa.",

      ephemeral: true
    });
  }

  if (
    interaction.user.id !==
    captainA.discordId
  ) {
    return interaction.reply({
      content:
        `Somente **${captainA.nickname}** pode escolher o lado inicial.`,

      ephemeral: true
    });
  }

  if (
    interaction.customId ===
    "side_attack"
  ) {
    sideA = "Ataque";
    sideB = "Defesa";
  } else if (
    interaction.customId ===
    "side_defense"
  ) {
    sideA = "Defesa";
    sideB = "Ataque";
  } else {
    return interaction.reply({
      content:
        "Escolha de lado inválida.",

      ephemeral: true
    });
  }

  return finishSideChoice(
    interaction
  );
}

/*
 * Finaliza e cria partida.
 */
async function finishSideChoice(
  interaction
) {
  if (!sideChoiceActive) {
    return;
  }

  if (
    !sideA ||
    !sideB
  ) {
    throw new Error(
      "SIDE_NOT_SELECTED"
    );
  }

  sideChoiceActive = false;

  const matchData = {
    map:
      selectedMap,

    captainA,
    captainB,

    sideA,
    sideB,

    teamA: [
      ...teamA
    ],

    teamB: [
      ...teamB
    ]
  };

  const teamAList =
    createTeamList(
      teamA,
      captainA
    );

  const teamBList =
    createTeamList(
      teamB,
      captainB
    );

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          "Configuração concluída"
        )
        .setDescription(
          `**Mapa:** ${selectedMap}`
        )
        .addFields(
          {
            name:
              `Time A — ${sideA}`,

            value:
              teamAList,

            inline: true
          },

          {
            name:
              `Time B — ${sideB}`,

            value:
              teamBList,

            inline: true
          }
        )
        .setFooter({
          text:
            "Criando partida..."
        })
    ],

    components: []
  });

  try {
    await createMatch(
      interaction,
      matchData
    );

    resetSideChoice();
  } catch (error) {
    /*
     * Conserva os dados da
     * formação para permitir
     * que /limpar-fila consiga
     * recuperar e resetar tudo.
     */
    sideChoiceActive = false;

    throw error;
  }
}

function createTeamList(
  players,
  captain
) {
  if (
    !players ||
    players.length === 0
  ) {
    return "—";
  }

  return players
    .map(
      (player) => {
        const isCaptain =
          player.discordId ===
          captain.discordId;

        return (
          `${isCaptain ? "👑" : "•"} ` +
          `<@${player.discordId}> — ` +
          `${player.nickname}`
        );
      }
    )
    .join("\n");
}

/*
 * Reset completo.
 */
function resetSideChoice() {
  sideChoiceActive = false;

  captainA = null;
  captainB = null;

  teamA = [];
  teamB = [];

  selectedMap = null;

  sideA = null;
  sideB = null;
}

function isSideChoiceActive() {
  return sideChoiceActive;
}

function getMatchSetup() {
  return {
    map:
      selectedMap,

    captainA,
    captainB,

    sideA,
    sideB,

    teamA: [
      ...teamA
    ],

    teamB: [
      ...teamB
    ]
  };
}

module.exports = {
  startSideChoice,
  handleSideChoice,

  resetSideChoice,
  isSideChoiceActive,
  getMatchSetup
};
