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

let sideChoiceActive =
  false;

let captainA =
  null;

let captainB =
  null;

let teamA =
  [];

let teamB =
  [];

let selectedMap =
  null;

let sideA =
  null;

let sideB =
  null;

/*
 * Inicia a escolha de lado.
 */
async function startSideChoice(
  interaction,
  matchData
) {
  /*
   * Não permite duas escolhas
   * simultâneas.
   */
  if (sideChoiceActive) {
    throw new Error(
      "SIDE_CHOICE_ALREADY_ACTIVE"
    );
  }

  /*
   * Valida os dados recebidos
   * do veto de mapas.
   */
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

  /*
   * Valida os capitães.
   */
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

  /*
   * Precisamos ter exatamente
   * 5 jogadores em cada time.
   */
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

  /*
   * Verifica se não existe
   * jogador duplicado.
   */
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

  /*
   * Capitão A precisa estar
   * no Time A.
   */
  const captainAInTeam =
    matchData.teamA.some(
      (player) =>
        player.discordId ===
        matchData.captainA.discordId
    );

  /*
   * Capitão B precisa estar
   * no Time B.
   */
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

  sideA =
    null;

  sideB =
    null;

  sideChoiceActive =
    true;

  /*
   * A fila deve continuar
   * bloqueada até a partida
   * ser criada.
   */
  queueState.lockQueue();

  try {
    await interaction.followUp(
      createSideChoicePanel()
    );
  } catch (error) {
    sideChoiceActive =
      false;

    throw error;
  }
}

/*
 * Cria o painel de
 * escolha de lado.
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
 * Processa a escolha.
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

  /*
   * Somente o Capitão A
   * pode escolher.
   */
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

  /*
   * Ataque.
   */
  if (
    interaction.customId ===
    "side_attack"
  ) {
    sideA =
      "Ataque";

    sideB =
      "Defesa";
  }

  /*
   * Defesa.
   */
  else if (
    interaction.customId ===
    "side_defense"
  ) {
    sideA =
      "Defesa";

    sideB =
      "Ataque";
  }

  /*
   * Custom ID desconhecido.
   */
  else {
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
 * Finaliza a configuração
 * e cria a partida.
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

  /*
   * Bloqueia imediatamente
   * novos cliques.
   */
  sideChoiceActive =
    false;

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

  /*
   * Fecha o painel.
   */
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

  /*
   * Cria a partida no banco.
   *
   * match.js será responsável por:
   *
   * - salvar a partida;
   * - salvar os 10 jogadores;
   * - remover os jogadores da fila;
   * - liberar a fila;
   * - atualizar o painel.
   */
  try {
    await createMatch(
      interaction,
      matchData
    );

    /*
     * Só limpamos o estado
     * depois que a partida
     * realmente foi criada.
     */
    resetSideChoice();
  } catch (error) {
    /*
     * Se a criação falhar,
     * mantemos a fila bloqueada.
     *
     * Isso evita que os mesmos
     * 10 jogadores entrem em
     * outra partida enquanto
     * existe um erro.
     */
    sideChoiceActive =
      false;

    throw error;
  }
}

/*
 * Cria a lista de um time.
 */
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
 * Limpa o estado.
 */
function resetSideChoice() {
  sideChoiceActive =
    false;

  captainA =
    null;

  captainB =
    null;

  teamA =
    [];

  teamB =
    [];

  selectedMap =
    null;

  sideA =
    null;

  sideB =
    null;
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

  isSideChoiceActive,
  getMatchSetup
};