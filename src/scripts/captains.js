const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const config = require(
  "../config/config"
);

const {
  startDraft
} = require(
  "./drafts"
);

let captainVoteActive = false;
let captainPlayers = [];

const votes = new Map();

let captainA = null;
let captainB = null;
let captainVoteMessage = null;

/*
 * Inicia a votação
 * para definir os capitães.
 */
async function startCaptainVote(
  interaction,
  players
) {
  if (captainVoteActive) {
    throw new Error(
      "CAPTAIN_VOTE_ALREADY_ACTIVE"
    );
  }

  if (
    !Array.isArray(players) ||
    players.length !==
      config.matchmaking.requiredPlayers
  ) {
    throw new Error(
      "INVALID_CAPTAIN_VOTE_PLAYERS"
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
      "DUPLICATED_CAPTAIN_VOTE_PLAYERS"
    );
  }

  const invalidPlayer =
    players.some(
      (player) =>
        !player ||
        !player.discordId ||
        !player.nickname ||
        !player.rank
    );

  if (invalidPlayer) {
    throw new Error(
      "INVALID_CAPTAIN_VOTE_PLAYER_DATA"
    );
  }

  captainPlayers = [
    ...players
  ];

  votes.clear();

  captainA = null;
  captainB = null;
  captainVoteMessage = null;

  captainVoteActive = true;

  try {
    captainVoteMessage =
      await interaction.followUp({
        ...createCaptainVotePanel(),
        fetchReply: true
      });
  } catch (error) {
    resetCaptainVote();

    throw error;
  }
}

/*
 * Cria o painel da votação.
 */
function createCaptainVotePanel() {
  const embed =
    new EmbedBuilder()
      .setTitle(
        "Escolha dos capitães"
      )
      .setDescription(
        "Os 10 jogadores devem votar em quem desejam como capitão.\n\n" +
        "Cada jogador possui **1 voto**.\n" +
        "Os **2 jogadores mais votados** serão os capitães."
      )
      .addFields({
        name:
          "Votos registrados",

        value:
          `${votes.size}/${captainPlayers.length}`,

        inline: true
      })
      .setFooter({
        text:
          "Rainbow Six Siege • Escolha dos capitães"
      });

  const select =
    new StringSelectMenuBuilder()
      .setCustomId(
        "captain_vote"
      )
      .setPlaceholder(
        "Escolha seu capitão"
      )
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        captainPlayers.map(
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
 * Recebe um voto.
 */
async function handleCaptainVote(
  interaction
) {
  if (!captainVoteActive) {
    return interaction.reply({
      content:
        "Não existe uma votação de capitães ativa.",

      ephemeral: true
    });
  }

  const playerIsInMatch =
    captainPlayers.some(
      (player) =>
        player.discordId ===
        interaction.user.id
    );

  if (!playerIsInMatch) {
    return interaction.reply({
      content:
        "Você não participa desta partida.",

      ephemeral: true
    });
  }

  if (
    votes.has(
      interaction.user.id
    )
  ) {
    return interaction.reply({
      content:
        "Você já votou para capitão.",

      ephemeral: true
    });
  }

  const selectedPlayerId =
    interaction.values[0];

  if (
    selectedPlayerId ===
    interaction.user.id
  ) {
    return interaction.reply({
      content:
        "Você não pode votar em si mesmo para capitão.",

      ephemeral: true
    });
  }

  const selectedPlayer =
    captainPlayers.find(
      (player) =>
        player.discordId ===
        selectedPlayerId
    );

  if (!selectedPlayer) {
    return interaction.reply({
      content:
        "O jogador selecionado não participa desta partida.",

      ephemeral: true
    });
  }

  votes.set(
    interaction.user.id,
    selectedPlayerId
  );

  await interaction.update(
    createCaptainVotePanel()
  );

  await interaction.followUp({
    content:
      `Seu voto em **${selectedPlayer.nickname}** foi registrado.`,

    ephemeral: true
  });

  if (
    votes.size ===
    captainPlayers.length
  ) {
    await finishCaptainVote(
      interaction
    );
  }
}

/*
 * Conta os votos.
 */
function countVotes() {
  const result =
    new Map();

  for (
    const player
    of captainPlayers
  ) {
    result.set(
      player.discordId,
      0
    );
  }

  for (
    const selectedPlayerId
    of votes.values()
  ) {
    const currentVotes =
      result.get(
        selectedPlayerId
      ) || 0;

    result.set(
      selectedPlayerId,
      currentVotes + 1
    );
  }

  return result;
}

/*
 * Finaliza a votação.
 */
async function finishCaptainVote(
  interaction
) {
  if (!captainVoteActive) {
    return;
  }

  if (
    votes.size !==
    captainPlayers.length
  ) {
    return;
  }

  const voteCount =
    countVotes();

  const ranking =
    captainPlayers.map(
      (player) => ({
        ...player,

        votes:
          voteCount.get(
            player.discordId
          ) || 0
      })
    );

  shuffleArray(
    ranking
  );

  ranking.sort(
    (a, b) =>
      b.votes - a.votes
  );

  captainA =
    ranking[0];

  captainB =
    ranking[1];

  if (
    !captainA ||
    !captainB ||
    captainA.discordId ===
      captainB.discordId
  ) {
    resetCaptainVote();

    throw new Error(
      "INVALID_CAPTAIN_VOTE_RESULT"
    );
  }

  captainVoteActive = false;

  const resultList =
    ranking
      .map(
        (player) =>
          `${
            player.discordId ===
              captainA.discordId ||
            player.discordId ===
              captainB.discordId
              ? "👑"
              : "•"
          } ` +
          `${player.nickname} — ` +
          `${player.votes} voto${
            player.votes === 1
              ? ""
              : "s"
          }`
      )
      .join("\n");

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Capitães definidos"
      )
      .setDescription(
        `**Capitão A**\n` +
        `👑 <@${captainA.discordId}> — ${captainA.nickname}\n\n` +

        `**Capitão B**\n` +
        `👑 <@${captainB.discordId}> — ${captainB.nickname}`
      )
      .addFields({
        name:
          "Resultado da votação",

        value:
          resultList
      })
      .setFooter({
        text:
          "Rainbow Six Siege • Draft iniciado"
      });

  if (captainVoteMessage) {
    try {
      await captainVoteMessage.edit({
        embeds: [
          embed
        ],

        components: []
      });
    } catch {
      // Continua mesmo se
      // a mensagem foi apagada.
    }
  }

  const playersForDraft = [
    ...captainPlayers
  ];

  await startDraft(
    interaction,
    playersForDraft,
    captainA,
    captainB
  );
}

/*
 * Embaralha array.
 */
function shuffleArray(
  array
) {
  for (
    let i =
      array.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );

    [
      array[i],
      array[j]
    ] = [
      array[j],
      array[i]
    ];
  }

  return array;
}

/*
 * Limita texto.
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
 * Limpa completamente
 * o estado da votação.
 */
function resetCaptainVote() {
  captainVoteActive = false;

  captainPlayers = [];

  votes.clear();

  captainA = null;
  captainB = null;

  captainVoteMessage = null;
}

function isCaptainVoteActive() {
  return captainVoteActive;
}

function getCaptainA() {
  return captainA;
}

function getCaptainB() {
  return captainB;
}

function getCaptains() {
  return {
    captainA,
    captainB
  };
}

/*
 * Permite que o reset global
 * descubra quem participava
 * da formação.
 */
function getCaptainPlayers() {
  return [
    ...captainPlayers
  ];
}

module.exports = {
  startCaptainVote,
  handleCaptainVote,

  resetCaptainVote,
  isCaptainVoteActive,

  getCaptainA,
  getCaptainB,
  getCaptains,
  getCaptainPlayers
};
