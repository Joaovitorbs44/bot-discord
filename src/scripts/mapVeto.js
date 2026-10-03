const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const config = require(
  "../config/config"
);

const {
  startSideChoice
} = require(
  "./side"
);

/*
 * Map pool do lobby.
 *
 * Podemos alterar os mapas
 * futuramente sem modificar
 * a lógica do veto.
 */
const MAP_POOL = [
  "Bank",
  "Border",
  "Chalet",
  "Clubhouse",
  "Consulate",
  "Kafe Dostoyevsky",
  "Lair",
  "Nighthaven Labs",
  "Skyscraper"
];

/*
 * Estado do veto.
 */
let vetoActive =
  false;

let captainA =
  null;

let captainB =
  null;

let teamA =
  [];

let teamB =
  [];

let availableMaps =
  [];

let bannedMaps =
  [];

let currentCaptain =
  "A";

let selectedMap =
  null;

/*
 * Inicia o veto de mapas.
 */
async function startMapVeto(
  interaction,
  teams,
  firstCaptain,
  secondCaptain
) {
  /*
   * Não permite dois vetos
   * simultâneos.
   */
  if (vetoActive) {
    throw new Error(
      "MAP_VETO_ALREADY_ACTIVE"
    );
  }

  /*
   * Validação dos times.
   */
  if (
    !teams ||
    !Array.isArray(
      teams.teamA
    ) ||
    !Array.isArray(
      teams.teamB
    )
  ) {
    throw new Error(
      "INVALID_MAP_VETO_TEAMS"
    );
  }

  /*
   * Cada time precisa ter
   * exatamente 5 jogadores.
   */
  if (
    teams.teamA.length !==
      config.matchmaking.teamSize ||
    teams.teamB.length !==
      config.matchmaking.teamSize
  ) {
    throw new Error(
      "INVALID_MAP_VETO_TEAM_SIZE"
    );
  }

  /*
   * Validação dos capitães.
   */
  if (
    !firstCaptain ||
    !secondCaptain ||
    !firstCaptain.discordId ||
    !secondCaptain.discordId
  ) {
    throw new Error(
      "INVALID_MAP_VETO_CAPTAINS"
    );
  }

  /*
   * Os capitães precisam
   * ser diferentes.
   */
  if (
    firstCaptain.discordId ===
    secondCaptain.discordId
  ) {
    throw new Error(
      "MAP_VETO_CAPTAINS_MUST_BE_DIFFERENT"
    );
  }

  /*
   * Capitão A precisa fazer
   * parte do Time A.
   */
  const captainAInTeam =
    teams.teamA.some(
      (player) =>
        player.discordId ===
        firstCaptain.discordId
    );

  /*
   * Capitão B precisa fazer
   * parte do Time B.
   */
  const captainBInTeam =
    teams.teamB.some(
      (player) =>
        player.discordId ===
        secondCaptain.discordId
    );

  if (
    !captainAInTeam ||
    !captainBInTeam
  ) {
    throw new Error(
      "MAP_VETO_CAPTAIN_NOT_IN_TEAM"
    );
  }

  /*
   * Confere se temos exatamente
   * os 10 jogadores esperados.
   */
  const allPlayers = [
    ...teams.teamA,
    ...teams.teamB
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
      "INVALID_MAP_VETO_PLAYERS"
    );
  }

  /*
   * Inicializa o estado.
   */
  captainA =
    firstCaptain;

  captainB =
    secondCaptain;

  teamA = [
    ...teams.teamA
  ];

  teamB = [
    ...teams.teamB
  ];

  availableMaps = [
    ...MAP_POOL
  ];

  bannedMaps =
    [];

  selectedMap =
    null;

  /*
   * Capitão A começa
   * o primeiro ban.
   */
  currentCaptain =
    "A";

  vetoActive =
    true;

  try {
    await interaction.followUp(
      createMapVetoPanel()
    );
  } catch (error) {
    resetMapVeto();

    throw error;
  }
}

/*
 * Cria o painel atual
 * do veto.
 */
function createMapVetoPanel() {
  if (!vetoActive) {
    throw new Error(
      "MAP_VETO_NOT_ACTIVE"
    );
  }

  const captain =
    currentCaptain === "A"
      ? captainA
      : captainB;

  if (!captain) {
    throw new Error(
      "INVALID_CURRENT_MAP_VETO_CAPTAIN"
    );
  }

  const bannedList =
    bannedMaps.length > 0
      ? bannedMaps
          .map(
            (
              ban,
              index
            ) =>
              `**${index + 1}.** ❌ ${ban.map} — ${ban.captain.nickname}`
          )
          .join("\n")
      : "Nenhum mapa banido.";

  const availableList =
    availableMaps.length > 0
      ? availableMaps
          .map(
            (map) =>
              `• ${map}`
          )
          .join("\n")
      : "Nenhum mapa disponível.";

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Veto de mapas"
      )
      .setDescription(
        `É a vez de <@${captain.discordId}> banir um mapa.`
      )
      .addFields(
        {
          name:
            "Mapas disponíveis",

          value:
            availableList,

          inline: false
        },

        {
          name:
            "Banimentos",

          value:
            bannedList,

          inline: false
        }
      )
      .setFooter({
        text:
          `${availableMaps.length} mapas restantes • Capitão ${currentCaptain}`
      });

  /*
   * O painel só deve existir
   * enquanto houver pelo menos
   * dois mapas.
   *
   * Quando sobrar apenas um,
   * o veto é encerrado.
   */
  if (
    availableMaps.length <= 1
  ) {
    return {
      embeds: [
        embed
      ],

      components: []
    };
  }

  const select =
    new StringSelectMenuBuilder()
      .setCustomId(
        "map_veto"
      )
      .setPlaceholder(
        "Escolha um mapa para banir"
      )
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        availableMaps.map(
          (map) => ({
            label:
              map,

            value:
              map
          })
        )
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        select
      );

  return {
    embeds: [
      embed
    ],

    components: [
      row
    ]
  };
}

/*
 * Processa um ban.
 */
async function handleMapVeto(
  interaction
) {
  if (!vetoActive) {
    return interaction.reply({
      content:
        "Não existe um veto de mapas ativo.",

      ephemeral: true
    });
  }

  const captain =
    currentCaptain === "A"
      ? captainA
      : captainB;

  if (!captain) {
    return interaction.reply({
      content:
        "Não foi possível identificar o capitão da rodada.",

      ephemeral: true
    });
  }

  /*
   * Somente o capitão da vez
   * pode realizar o ban.
   */
  if (
    interaction.user.id !==
    captain.discordId
  ) {
    return interaction.reply({
      content:
        `Agora é a vez de **${captain.nickname}** banir um mapa.`,

      ephemeral: true
    });
  }

  const selected =
    interaction.values[0];

  /*
   * Valida o mapa recebido.
   */
  if (
    !selected ||
    !availableMaps.includes(
      selected
    )
  ) {
    return interaction.reply({
      content:
        "Esse mapa não está mais disponível.",

      ephemeral: true
    });
  }

  /*
   * Registra o ban.
   */
  bannedMaps.push({
    map:
      selected,

    captain:
      captain,

    captainTeam:
      currentCaptain
  });

  /*
   * Remove o mapa.
   */
  availableMaps =
    availableMaps.filter(
      (map) =>
        map !== selected
    );

  /*
   * Quando restar somente
   * um mapa, ele será
   * automaticamente escolhido.
   */
  if (
    availableMaps.length === 1
  ) {
    selectedMap =
      availableMaps[0];

    return finishMapVeto(
      interaction
    );
  }

  /*
   * Segurança contra um estado
   * impossível.
   */
  if (
    availableMaps.length === 0
  ) {
    throw new Error(
      "MAP_VETO_WITHOUT_SELECTED_MAP"
    );
  }

  /*
   * Alterna o capitão.
   */
  currentCaptain =
    currentCaptain === "A"
      ? "B"
      : "A";

  /*
   * Atualiza a mesma mensagem.
   */
  await interaction.update(
    createMapVetoPanel()
  );
}

/*
 * Finaliza o veto.
 */
async function finishMapVeto(
  interaction
) {
  if (!vetoActive) {
    return;
  }

  /*
   * Precisa existir exatamente
   * um mapa restante.
   */
  if (
    availableMaps.length !== 1
  ) {
    throw new Error(
      "INVALID_MAP_VETO_RESULT"
    );
  }

  selectedMap =
    availableMaps[0];

  /*
   * Copiamos os dados antes
   * de seguir para a próxima etapa.
   */
  const vetoResult = {
    map:
      selectedMap,

    bannedMaps:
      bannedMaps.map(
        (ban) => ({
          ...ban
        })
      ),

    captainA,
    captainB,

    teamA: [
      ...teamA
    ],

    teamB: [
      ...teamB
    ]
  };

  vetoActive =
    false;

  const bannedList =
    bannedMaps.length > 0
      ? bannedMaps
          .map(
            (
              ban,
              index
            ) =>
              `**${index + 1}.** ❌ ${ban.map} — ${ban.captain.nickname}`
          )
          .join("\n")
      : "Nenhum mapa banido.";

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Mapa definido"
      )
      .setDescription(
        `A partida será disputada em **${selectedMap}**.`
      )
      .addFields(
        {
          name:
            "Mapa escolhido",

          value:
            `🗺️ **${selectedMap}**`,

          inline: false
        },

        {
          name:
            "Vetos",

          value:
            bannedList,

          inline: false
        }
      )
      .setFooter({
        text:
          "Escolha de lado iniciada"
      });

  /*
   * Fecha o select do veto.
   */
  await interaction.update({
    embeds: [
      embed
    ],

    components: []
  });

  /*
   * Inicia a escolha de lado.
   *
   * A fila continua bloqueada.
   */
  await startSideChoice(
    interaction,
    {
      map:
        vetoResult.map,

      captainA:
        vetoResult.captainA,

      captainB:
        vetoResult.captainB,

      teamA: [
        ...vetoResult.teamA
      ],

      teamB: [
        ...vetoResult.teamB
      ]
    }
  );
}

/*
 * Limpa o estado do veto.
 */
function resetMapVeto() {
  vetoActive =
    false;

  captainA =
    null;

  captainB =
    null;

  teamA =
    [];

  teamB =
    [];

  availableMaps =
    [];

  bannedMaps =
    [];

  currentCaptain =
    "A";

  selectedMap =
    null;
}

/*
 * Retorna se existe
 * um veto ativo.
 */
function isMapVetoActive() {
  return vetoActive;
}

/*
 * Retorna o mapa final.
 */
function getSelectedMap() {
  return selectedMap;
}

/*
 * Retorna os dados atuais
 * do veto.
 */
function getVetoData() {
  return {
    map:
      selectedMap,

    bannedMaps:
      bannedMaps.map(
        (ban) => ({
          ...ban
        })
      ),

    captainA,
    captainB,

    teamA: [
      ...teamA
    ],

    teamB: [
      ...teamB
    ]
  };
}

module.exports = {
  MAP_POOL,

  startMapVeto,
  handleMapVeto,

  isMapVetoActive,
  getSelectedMap,
  getVetoData
};
