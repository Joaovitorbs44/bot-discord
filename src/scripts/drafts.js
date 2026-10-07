const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const config = require(
  "../config/config"
);

const {
  startMapVeto
} = require(
  "./mapVeto"
);

let draftActive = false;

let captainA = null;
let captainB = null;

let teamA = [];
let teamB = [];

let availablePlayers = [];

let currentRound = 0;

let draftMessage = null;

/*
 * Ordem 1-2-2-2-1.
 */
const draftRounds = [
  {
    captain: "A",
    picks: 1
  },
  {
    captain: "B",
    picks: 2
  },
  {
    captain: "A",
    picks: 2
  },
  {
    captain: "B",
    picks: 2
  },
  {
    captain: "A",
    picks: 1
  }
];

/*
 * Inicia o draft.
 */
async function startDraft(
  interaction,
  players,
  firstCaptain,
  secondCaptain
) {
  if (draftActive) {
    throw new Error(
      "DRAFT_ALREADY_ACTIVE"
    );
  }

  if (
    !Array.isArray(players) ||
    players.length !==
      config.matchmaking.requiredPlayers
  ) {
    throw new Error(
      "INVALID_DRAFT_PLAYERS"
    );
  }

  if (
    !firstCaptain ||
    !secondCaptain ||
    !firstCaptain.discordId ||
    !secondCaptain.discordId
  ) {
    throw new Error(
      "INVALID_DRAFT_CAPTAINS"
    );
  }

  if (
    firstCaptain.discordId ===
    secondCaptain.discordId
  ) {
    throw new Error(
      "DRAFT_CAPTAINS_MUST_BE_DIFFERENT"
    );
  }

  const captainAExists =
    players.some(
      (player) =>
        player.discordId ===
        firstCaptain.discordId
    );

  const captainBExists =
    players.some(
      (player) =>
        player.discordId ===
        secondCaptain.discordId
    );

  if (
    !captainAExists ||
    !captainBExists
  ) {
    throw new Error(
      "DRAFT_CAPTAIN_NOT_IN_PLAYERS"
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
    players.length
  ) {
    throw new Error(
      "DUPLICATED_DRAFT_PLAYERS"
    );
  }

  captainA =
    firstCaptain;

  captainB =
    secondCaptain;

  teamA = [
    captainA
  ];

  teamB = [
    captainB
  ];

  availablePlayers =
    players.filter(
      (player) =>
        player.discordId !==
          captainA.discordId &&
        player.discordId !==
          captainB.discordId
    );

  const expected =
    config.matchmaking
      .requiredPlayers - 2;

  if (
    availablePlayers.length !==
    expected
  ) {
    resetDraft();

    throw new Error(
      "INVALID_AVAILABLE_DRAFT_PLAYERS"
    );
  }

  currentRound = 0;
  draftActive = true;

  try {
    /*
     * Busca automaticamente o canal
     * configurado para o pick de jogadores.
     */
    const channel =
      await interaction.client.channels.fetch(
        config.discord.pickPlayersChannelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      throw new Error(
        "INVALID_PICK_PLAYERS_CHANNEL"
      );
    }

    /*
     * Envia o draft no canal correto.
     */
    draftMessage =
      await channel.send(
        createDraftPanel()
      );

    /*
     * Avisa no canal anterior que
     * o draft foi movido.
     */
    await interaction.followUp({
      content:
        `🎯 O draft de jogadores foi iniciado em <#${channel.id}>.`
    });
  } catch (error) {
    resetDraft();

    throw error;
  }
}

/*
 * Cria o painel.
 */
function createDraftPanel() {
  const round =
    draftRounds[
      currentRound
    ];

  if (!round) {
    return createFinishedDraftPanel();
  }

  const currentCaptain =
    round.captain === "A"
      ? captainA
      : captainB;

  const teamAList =
    createPlayerList(
      teamA,
      captainA
    );

  const teamBList =
    createPlayerList(
      teamB,
      captainB
    );

  const availableList =
    availablePlayers.length > 0
      ? availablePlayers
          .map(
            (player) =>
              `• ${player.nickname} — ${player.rank}`
          )
          .join("\n")
      : "Nenhum jogador disponível.";

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Draft 5v5"
      )
      .setDescription(
        `É a vez de <@${currentCaptain.discordId}> escolher.\n\n` +
        `Escolha **${round.picks} jogador${
          round.picks > 1
            ? "es"
            : ""
        }**.`
      )
      .addFields(
        {
          name:
            `Time A — ${captainA.nickname}`,

          value:
            teamAList,

          inline: true
        },

        {
          name:
            `Time B — ${captainB.nickname}`,

          value:
            teamBList,

          inline: true
        },

        {
          name:
            "Jogadores disponíveis",

          value:
            availableList,

          inline: false
        }
      )
      .setFooter({
        text:
          `Rodada ${currentRound + 1}/${draftRounds.length}`
      });

  if (
    availablePlayers.length <
    round.picks
  ) {
    throw new Error(
      "NOT_ENOUGH_PLAYERS_FOR_DRAFT_ROUND"
    );
  }

  const select =
    new StringSelectMenuBuilder()
      .setCustomId(
        "draft_pick"
      )
      .setPlaceholder(
        round.picks === 1
          ? "Escolha 1 jogador"
          : `Escolha ${round.picks} jogadores`
      )
      .setMinValues(
        round.picks
      )
      .setMaxValues(
        round.picks
      )
      .addOptions(
        availablePlayers.map(
          (player) => ({
            label:
              limitText(
                player.nickname,
                100
              ),

            description:
              limitText(
                `Rank: ${player.rank}`,
                100
              ),

            value:
              player.discordId
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
 * Processa uma escolha.
 */
async function handleDraftPick(
  interaction
) {
  if (!draftActive) {
    return interaction.reply({
      content:
        "Não existe um draft ativo.",

      ephemeral: true
    });
  }

  const round =
    draftRounds[
      currentRound
    ];

  if (!round) {
    return interaction.reply({
      content:
        "O draft já terminou.",

      ephemeral: true
    });
  }

  const currentCaptain =
    round.captain === "A"
      ? captainA
      : captainB;

  if (
    interaction.user.id !==
    currentCaptain.discordId
  ) {
    return interaction.reply({
      content:
        `Agora é a vez de **${currentCaptain.nickname}** escolher.`,

      ephemeral: true
    });
  }

  if (
    interaction.values.length !==
    round.picks
  ) {
    return interaction.reply({
      content:
        `Você precisa escolher exatamente ${round.picks} jogador${
          round.picks > 1
            ? "es"
            : ""
        }.`,

      ephemeral: true
    });
  }

  const uniqueSelectedIds =
    new Set(
      interaction.values
    );

  if (
    uniqueSelectedIds.size !==
    interaction.values.length
  ) {
    return interaction.reply({
      content:
        "Existem jogadores duplicados na seleção.",

      ephemeral: true
    });
  }

  const selectedPlayers = [];

  for (
    const discordId
    of interaction.values
  ) {
    const player =
      availablePlayers.find(
        (availablePlayer) =>
          availablePlayer.discordId ===
          discordId
      );

    if (!player) {
      return interaction.reply({
        content:
          "Um dos jogadores selecionados não está mais disponível.",

        ephemeral: true
      });
    }

    selectedPlayers.push(
      player
    );
  }

  if (
    round.captain === "A"
  ) {
    teamA.push(
      ...selectedPlayers
    );
  } else {
    teamB.push(
      ...selectedPlayers
    );
  }

  const selectedIds =
    new Set(
      selectedPlayers.map(
        (player) =>
          player.discordId
      )
    );

  availablePlayers =
    availablePlayers.filter(
      (player) =>
        !selectedIds.has(
          player.discordId
        )
    );

  currentRound++;

  if (
    currentRound >=
    draftRounds.length
  ) {
    return finishDraft(
      interaction
    );
  }

  await interaction.update(
    createDraftPanel()
  );
}

/*
 * Finaliza o draft.
 */
async function finishDraft(
  interaction
) {
  if (
    teamA.length !==
      config.matchmaking.teamSize ||
    teamB.length !==
      config.matchmaking.teamSize ||
    availablePlayers.length !== 0
  ) {
    throw new Error(
      "INVALID_FINAL_DRAFT_TEAMS"
    );
  }

  const allPlayers = [
    ...teamA,
    ...teamB
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
      "INVALID_FINAL_DRAFT_PLAYERS"
    );
  }

  draftActive = false;

  await interaction.update(
    createFinishedDraftPanel()
  );

  const draftResult = {
    teamA: [
      ...teamA
    ],

    teamB: [
      ...teamB
    ]
  };

  await startMapVeto(
    interaction,
    draftResult,
    captainA,
    captainB
  );
}

/*
 * Painel final.
 */
function createFinishedDraftPanel() {
  const teamAList =
    createPlayerList(
      teamA,
      captainA
    );

  const teamBList =
    createPlayerList(
      teamB,
      captainB
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Times definidos"
      )
      .setDescription(
        "O draft foi concluído. Os dois times estão definidos."
      )
      .addFields(
        {
          name:
            `Time A — ${captainA.nickname}`,

          value:
            teamAList,

          inline: true
        },

        {
          name:
            `Time B — ${captainB.nickname}`,

          value:
            teamBList,

          inline: true
        }
      )
      .setFooter({
        text:
          "Veto de mapas iniciado"
      });

  return {
    embeds: [
      embed
    ],

    components: []
  };
}

function createPlayerList(
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
          captain &&
          player.discordId ===
            captain.discordId;

        return (
          `${isCaptain ? "👑" : "•"} ` +
          `${player.nickname} — ${player.rank}`
        );
      }
    )
    .join("\n");
}

function limitText(
  value,
  maxLength
) {
  const text =
    String(
      value || "—"
    );

  if (
    text.length <=
    maxLength
  ) {
    return text;
  }

  return (
    text.slice(
      0,
      maxLength - 3
    ) +
    "..."
  );
}

/*
 * Reset completo do draft.
 */
function resetDraft() {
  draftActive = false;

  captainA = null;
  captainB = null;

  teamA = [];
  teamB = [];

  availablePlayers = [];

  currentRound = 0;

  draftMessage = null;
}

function isDraftActive() {
  return draftActive;
}

function getTeams() {
  return {
    teamA: [
      ...teamA
    ],

    teamB: [
      ...teamB
    ]
  };
}

module.exports = {
  startDraft,
  handleDraftPick,

  resetDraft,
  isDraftActive,
  getTeams
};
