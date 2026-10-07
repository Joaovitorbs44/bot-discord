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
 * Map Pool competitivo R6
 */
const MAP_POOL = [
  "Bank",
  "Border",
  "Chalet",
  "Clubhouse",
  "Villa",
  "Kafe Dostoyevsky",
  "Lair",
  "Nighthaven Labs",
  "Fortress"
];

let vetoActive = false;

let captainA = null;
let captainB = null;

let teamA = [];
let teamB = [];

let availableMaps = [];
let bannedMaps = [];

let currentCaptain = "A";

let selectedMap = null;

/*
 * Inicia o veto.
 */
async function startMapVeto(
  interaction,
  teams,
  firstCaptain,
  secondCaptain
) {
  if (vetoActive) {
    throw new Error(
      "MAP_VETO_ALREADY_ACTIVE"
    );
  }

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

  if (
    firstCaptain.discordId ===
    secondCaptain.discordId
  ) {
    throw new Error(
      "MAP_VETO_CAPTAINS_MUST_BE_DIFFERENT"
    );
  }

  const captainAInTeam =
    teams.teamA.some(
      (player) =>
        player.discordId ===
        firstCaptain.discordId
    );

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

  bannedMaps = [];

  selectedMap = null;

  currentCaptain = "A";

  vetoActive = true;

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
 * Painel atual.
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

  bannedMaps.push({
    map:
      selected,

    captain,

    captainTeam:
      currentCaptain
  });

  availableMaps =
    availableMaps.filter(
      (map) =>
        map !== selected
    );

  if (
    availableMaps.length === 1
  ) {
    selectedMap =
      availableMaps[0];

    return finishMapVeto(
      interaction
    );
  }

  if (
    availableMaps.length === 0
  ) {
    throw new Error(
      "MAP_VETO_WITHOUT_SELECTED_MAP"
    );
  }

  currentCaptain =
    currentCaptain === "A"
      ? "B"
      : "A";

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

  if (
    availableMaps.length !== 1
  ) {
    throw new Error(
      "INVALID_MAP_VETO_RESULT"
    );
  }

  selectedMap =
    availableMaps[0];

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

  vetoActive = false;

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

  await interaction.update({
    embeds: [
      embed
    ],

    components: []
  });

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
 * Reset completo do veto.
 */
function resetMapVeto() {
  vetoActive = false;

  captainA = null;
  captainB = null;

  teamA = [];
  teamB = [];

  availableMaps = [];
  bannedMaps = [];

  currentCaptain = "A";

  selectedMap = null;
}

function isMapVetoActive() {
  return vetoActive;
}

function getSelectedMap() {
  return selectedMap;
}

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

  resetMapVeto,
  isMapVetoActive,

  getSelectedMap,
  getVetoData
};
