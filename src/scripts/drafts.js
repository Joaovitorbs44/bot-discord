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

/*
 * Ordem do draft.
 *
 * Capitães já fazem parte
 * dos seus respectivos times.
 *
 * Restam 8 jogadores:
 *
 * A escolhe 1
 * B escolhe 2
 * A escolhe 2
 * B escolhe 2
 * A escolhe 1
 *
 * Resultado:
 * Time A = 5
 * Time B = 5
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
  /*
   * Não permite iniciar outro
   * draft enquanto existe um ativo.
   */
  if (draftActive) {
    throw new Error(
      "DRAFT_ALREADY_ACTIVE"
    );
  }

  /*
   * O sistema atual foi criado
   * especificamente para 5v5.
   */
  if (
    !Array.isArray(players) ||
    players.length !==
      config.matchmaking.requiredPlayers
  ) {
    throw new Error(
      "INVALID_DRAFT_PLAYERS"
    );
  }

  /*
   * Valida os capitães.
   */
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

  /*
   * Um jogador não pode ser
   * os dois capitães.
   */
  if (
    firstCaptain.discordId ===
    secondCaptain.discordId
  ) {
    throw new Error(
      "DRAFT_CAPTAINS_MUST_BE_DIFFERENT"
    );
  }

  /*
   * Confirma que os dois capitães
   * realmente fazem parte dos
   * jogadores selecionados.
   */
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

  /*
   * Garante que não existam
   * jogadores duplicados.
   */
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

  /*
   * Remove os dois capitães
   * da lista disponível.
   */
  availablePlayers =
    players.filter(
      (player) =>
        player.discordId !==
          captainA.discordId &&
        player.discordId !==
          captainB.discordId
    );

  /*
   * Em um 5v5 devem restar
   * exatamente 8 jogadores.
   */
  const expectedAvailablePlayers =
    config.matchmaking.requiredPlayers -
    2;

  if (
    availablePlayers.length !==
    expectedAvailablePlayers
  ) {
    resetDraft();

    throw new Error(
      "INVALID_AVAILABLE_DRAFT_PLAYERS"
    );
  }

  currentRound = 0;

  draftActive = true;

  try {
    await interaction.followUp(
      createDraftPanel()
    );
  } catch (error) {
    resetDraft();

    throw error;
  }
}

/*
 * Cria o painel da rodada atual.
 */
function createDraftPanel() {
  const round =
    draftRounds[
      currentRound
    ];

  /*
   * Se todas as rodadas acabaram,
   * mostra o resultado.
   */
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
        `Escolha **${round.picks} jogador${round.picks > 1 ? "es" : ""}**.`
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

  /*
   * Segurança contra estado
   * inconsistente.
   */
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

  /*
   * Somente o capitão da rodada
   * pode escolher.
   */
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

  /*
   * O número de escolhas precisa
   * ser exatamente o da rodada.
   */
  if (
    interaction.values.length !==
    round.picks
  ) {
    return interaction.reply({
      content:
        `Você precisa escolher exatamente ${round.picks} jogador${round.picks > 1 ? "es" : ""}.`,
      ephemeral: true
    });
  }

  /*
   * Segurança contra IDs
   * duplicados na interação.
   */
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

  const selectedPlayers =
    [];

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

  /*
   * Adiciona os jogadores ao
   * time do capitão da rodada.
   */
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

  /*
   * Remove os escolhidos da
   * lista disponível.
   */
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

  /*
   * Última rodada concluída.
   */
  if (
    currentRound >=
    draftRounds.length
  ) {
    return finishDraft(
      interaction
    );
  }

  /*
   * Atualiza a mesma mensagem
   * para a próxima rodada.
   */
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
  /*
   * Antes de avançar, verificamos
   * se realmente temos 5x5.
   */
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

  /*
   * Confere novamente se nenhum
   * jogador apareceu nos dois times.
   */
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

  draftActive =
    false;

  /*
   * Primeiro atualizamos a mensagem
   * do draft.
   */
  await interaction.update(
    createFinishedDraftPanel()
  );

  /*
   * Fazemos uma cópia antes de
   * iniciar a próxima etapa.
   */
  const draftResult = {
    teamA: [
      ...teamA
    ],

    teamB: [
      ...teamB
    ]
  };

  /*
   * Inicia o veto de mapas.
   *
   * A fila continua bloqueada.
   */
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

/*
 * Cria lista de jogadores.
 */
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

/*
 * Limita texto para os limites
 * dos componentes do Discord.
 */
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
 * Limpa o estado do draft.
 */
function resetDraft() {
  draftActive =
    false;

  captainA =
    null;

  captainB =
    null;

  teamA =
    [];

  teamB =
    [];

  availablePlayers =
    [];

  currentRound =
    0;
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

  isDraftActive,
  getTeams
};