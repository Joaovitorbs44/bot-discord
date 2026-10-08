
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const queueState = require("./queueState");

const {
  startDraft
} = require("./drafts");

// ==========================================
// ESTADO
// ==========================================

let captainVoteActive = false;
let captainVoteFinishing = false;
let captainPlayers = [];

const votes = new Map();

let captainA = null;
let captainB = null;
let captainVoteMessage = null;
let captainVoteSessionId = null;

// ==========================================
// PERSISTÊNCIA
// ==========================================

function getSession() {
  return queueState.getActiveSession();
}

function saveCaptainVoteState() {
  const session = getSession();

  if (!session || session.stage !== "captain_vote") {
    return;
  }

  const state = {
    captainVote: {
      votes: Object.fromEntries(votes),
      messageId: captainVoteMessage?.id || null,
      channelId:
        captainVoteMessage?.channelId ||
        config.discord.queueChannelId
    }
  };

  db.prepare(`
    UPDATE matchmaking_sessions
    SET
      state_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(state),
    Date.now(),
    session.id
  );
}

// ==========================================
// INICIAR VOTAÇÃO
// ==========================================

async function startCaptainVote(interaction, players) {
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

  const uniquePlayers = new Set(
    players.map((player) => player?.discordId)
  );

  if (
    uniquePlayers.size !== players.length ||
    uniquePlayers.has(undefined)
  ) {
    throw new Error(
      "DUPLICATED_CAPTAIN_VOTE_PLAYERS"
    );
  }

  const invalidPlayer = players.some(
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

  const session = getSession();

  if (!session) {
    throw new Error(
      "CAPTAIN_VOTE_SESSION_NOT_FOUND"
    );
  }

  captainPlayers = [...players];
  votes.clear();

  captainA = null;
  captainB = null;
  captainVoteMessage = null;
  captainVoteSessionId = session.id;

  captainVoteActive = true;
  captainVoteFinishing = false;

  try {
    db.prepare(`
      UPDATE matchmaking_sessions
      SET
        stage = 'captain_vote',
        deadline_at = NULL,
        state_json = '{}',
        updated_at = ?
      WHERE id = ?
    `).run(
      Date.now(),
      session.id
    );

    captainVoteMessage = await interaction.followUp({
      ...createCaptainVotePanel(),
      fetchReply: true
    });

    saveCaptainVoteState();
  } catch (error) {
    resetCaptainVote();
    throw error;
  }
}

// ==========================================
// PAINEL DE VOTAÇÃO
// ==========================================

function createCaptainVotePanel() {
  const embed = new EmbedBuilder()
    .setTitle("Escolha dos capitães")
    .setDescription(
      "Os 10 jogadores devem votar em quem desejam como capitão.\n\n" +
      "Cada jogador possui **1 voto**.\n" +
      "Os **2 jogadores mais votados** serão os capitães."
    )
    .addFields({
      name: "Votos registrados",
      value: `${votes.size}/${captainPlayers.length}`,
      inline: true
    })
    .setFooter({
      text: "Rainbow Six Siege • Escolha dos capitães"
    });

  const select = new StringSelectMenuBuilder()
    .setCustomId("captain_vote")
    .setPlaceholder("Escolha seu capitão")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      captainPlayers.map((player) => ({
        label: limitText(player.nickname, 100),
        description: limitText(
          `Rank: ${player.rank}`,
          100
        ),
        value: player.discordId
      }))
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select)
    ]
  };
}

// ==========================================
// REGISTRAR VOTO
// ==========================================

async function handleCaptainVote(interaction) {
  if (!captainVoteActive || captainVoteFinishing) {
    return interaction.reply({
      content:
        "Não existe uma votação de capitães ativa.",
      ephemeral: true
    });
  }

  const playerIsInMatch = captainPlayers.some(
    (player) =>
      player.discordId === interaction.user.id
  );

  if (!playerIsInMatch) {
    return interaction.reply({
      content:
        "Você não participa desta partida.",
      ephemeral: true
    });
  }

  if (votes.has(interaction.user.id)) {
    return interaction.reply({
      content:
        "Você já votou para capitão.",
      ephemeral: true
    });
  }

  const selectedPlayerId = interaction.values[0];

  if (selectedPlayerId === interaction.user.id) {
    return interaction.reply({
      content:
        "Você não pode votar em si mesmo para capitão.",
      ephemeral: true
    });
  }

  const selectedPlayer = captainPlayers.find(
    (player) =>
      player.discordId === selectedPlayerId
  );

  if (!selectedPlayer) {
    return interaction.reply({
      content:
        "O jogador selecionado não participa desta partida.",
      ephemeral: true
    });
  }

  const session = getSession();

  if (
    !session ||
    session.id !== captainVoteSessionId ||
    session.stage !== "captain_vote"
  ) {
    return interaction.reply({
      content:
        "Esta votação não está mais ativa.",
      ephemeral: true
    });
  }

  votes.set(
    interaction.user.id,
    selectedPlayerId
  );

  saveCaptainVoteState();

  await interaction.update(
    createCaptainVotePanel()
  );

  await interaction.followUp({
    content:
      `Seu voto em **${selectedPlayer.nickname}** foi registrado.`,
    ephemeral: true
  });

  if (votes.size === captainPlayers.length) {
    await finishCaptainVote(interaction);
  }
}

// ==========================================
// CONTAGEM DE VOTOS
// ==========================================

function countVotes() {
  const result = new Map();

  for (const player of captainPlayers) {
    result.set(player.discordId, 0);
  }

  for (const selectedPlayerId of votes.values()) {
    result.set(
      selectedPlayerId,
      (result.get(selectedPlayerId) || 0) + 1
    );
  }

  return result;
}

// ==========================================
// FINALIZAR VOTAÇÃO
// ==========================================

async function finishCaptainVote(interaction) {
  if (
    !captainVoteActive ||
    captainVoteFinishing ||
    votes.size !== captainPlayers.length
  ) {
    return;
  }

  captainVoteFinishing = true;

  const voteCount = countVotes();

  const ranking = captainPlayers.map(
    (player) => ({
      ...player,
      votes: voteCount.get(player.discordId) || 0
    })
  );

  shuffleArray(ranking);

  ranking.sort(
    (a, b) => b.votes - a.votes
  );

  captainA = ranking[0];
  captainB = ranking[1];

  if (
    !captainA ||
    !captainB ||
    captainA.discordId === captainB.discordId
  ) {
    captainVoteFinishing = false;
    throw new Error("INVALID_CAPTAIN_VOTE_RESULT");
  }

  const session = getSession();

  if (!session || session.id !== captainVoteSessionId) {
    captainVoteFinishing = false;
    throw new Error("CAPTAIN_VOTE_SESSION_LOST");
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE matchmaking_session_players
      SET is_captain = CASE
        WHEN discord_id IN (?, ?) THEN 1
        ELSE 0
      END
      WHERE session_id = ?
    `).run(
      captainA.discordId,
      captainB.discordId,
      session.id
    );

    db.prepare(`
      UPDATE matchmaking_sessions
      SET
        stage = 'draft',
        captain_a_discord_id = ?,
        captain_b_discord_id = ?,
        deadline_at = NULL,
        state_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      captainA.discordId,
      captainB.discordId,
      JSON.stringify({
        captainVoteCompleted: true,
        votes: Object.fromEntries(votes)
      }),
      Date.now(),
      session.id
    );
  })();

  captainVoteActive = false;

  const resultList = ranking.map(
    (player) =>
      `${
        player.discordId === captainA.discordId ||
        player.discordId === captainB.discordId
          ? "👑"
          : "•"
      } ${player.nickname} — ${player.votes} voto${
        player.votes === 1 ? "" : "s"
      }`
  ).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Capitães definidos")
    .setDescription(
      `**Capitão A**\n` +
      `👑 <@${captainA.discordId}> — ${captainA.nickname}\n\n` +
      `**Capitão B**\n` +
      `👑 <@${captainB.discordId}> — ${captainB.nickname}`
    )
    .addFields({
      name: "Resultado da votação",
      value: resultList
    })
    .setFooter({
      text: "Rainbow Six Siege • Draft iniciado"
    });

  if (captainVoteMessage) {
    try {
      await captainVoteMessage.edit({
        embeds: [embed],
        components: []
      });
    } catch (error) {
      console.error(
        "Erro ao atualizar resultado da votação:",
        error
      );
    }
  }

  const playersForDraft = [...captainPlayers];
  const selectedCaptainA = captainA;
  const selectedCaptainB = captainB;

  try {
    await startDraft(
      interaction,
      playersForDraft,
      selectedCaptainA,
      selectedCaptainB
    );

    resetCaptainVote();
  } catch (error) {
    console.error(
      "Erro ao iniciar draft:",
      error
    );

    // Mantém a sessão bloqueada para recuperação.
    throw error;
  }
}

// ==========================================
// RECUPERAÇÃO
// ==========================================

async function restoreCaptainVote(client) {
  const session = getSession();

  if (!session || session.stage !== "captain_vote") {
    return false;
  }

  if (captainVoteActive) {
    return true;
  }

  const rows = db.prepare(`
    SELECT
      sp.discord_id,
      p.r6_nickname,
      p.r6_rank
    FROM matchmaking_session_players sp
    LEFT JOIN players p
      ON p.discord_id = sp.discord_id
    WHERE sp.session_id = ?
    ORDER BY sp.joined_at, sp.id
  `).all(session.id);

  captainPlayers = rows.map((row) => ({
    discordId: row.discord_id,
    nickname: row.r6_nickname || row.discord_id,
    rank: row.r6_rank || "Não informado"
  }));

  let savedState = {};

  try {
    savedState = JSON.parse(
      session.state_json || "{}"
    );
  } catch {
    savedState = {};
  }

  const savedVote = savedState.captainVote || {};

  votes.clear();

  for (
    const [voterId, selectedId]
    of Object.entries(savedVote.votes || {})
  ) {
    if (
      captainPlayers.some(
        (player) => player.discordId === voterId
      ) &&
      captainPlayers.some(
        (player) => player.discordId === selectedId
      )
    ) {
      votes.set(voterId, selectedId);
    }
  }

  captainVoteSessionId = session.id;
  captainVoteActive = true;
  captainVoteFinishing = false;

  const channelId =
    savedVote.channelId ||
    config.discord.queueChannelId;

  if (savedVote.messageId) {
    try {
      const channel = await client.channels.fetch(
        channelId
      );

      if (channel?.messages) {
        captainVoteMessage =
          await channel.messages.fetch(
            savedVote.messageId
          );
      }
    } catch (error) {
      console.error(
        "Não foi possível recuperar painel de capitães:",
        error
      );
    }
  }

  if (!captainVoteMessage) {
    try {
      const channel = await client.channels.fetch(
        config.discord.queueChannelId
      );

      captainVoteMessage = await channel.send(
        createCaptainVotePanel()
      );

      saveCaptainVoteState();
    } catch (error) {
      console.error(
        "Não foi possível recriar votação:",
        error
      );
    }
  } else {
    await captainVoteMessage.edit(
      createCaptainVotePanel()
    );
  }

  console.log(
    `Votação de capitães recuperada: ${votes.size}/${captainPlayers.length} votos.`
  );

  return true;
}

// ==========================================
// UTILITÁRIOS
// ==========================================

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [array[i], array[j]] = [
      array[j], array[i]
    ];
  }

  return array;
}

function limitText(value, maxLength) {
  const text = String(value || "—");

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength - 3) + "...";
}

function resetCaptainVote() {
  captainVoteActive = false;
  captainVoteFinishing = false;

  captainPlayers = [];
  votes.clear();

  captainA = null;
  captainB = null;

  captainVoteMessage = null;
  captainVoteSessionId = null;
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

function getCaptainPlayers() {
  return [...captainPlayers];
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  startCaptainVote,
  handleCaptainVote,
  restoreCaptainVote,

  resetCaptainVote,
  isCaptainVoteActive,

  getCaptainA,
  getCaptainB,
  getCaptains,
  getCaptainPlayers
};
