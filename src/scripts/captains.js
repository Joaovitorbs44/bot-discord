
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const db = require("../database/database");
const queueState = require("./queueState");
const { startDraft } = require("./drafts");

let voteActive = false;
let voteFinishing = false;

let captainA = null;
let captainB = null;

let captainPlayers = [];
let votes = new Map();

let voteMessage = null;
let voteClient = null;
let voteSessionId = null;

function getSession() {
  return queueState.getActiveSession();
}

function resetCaptainVote() {
  voteActive = false;
  voteFinishing = false;

  captainA = null;
  captainB = null;

  captainPlayers = [];
  votes = new Map();

  voteMessage = null;
  voteClient = null;
  voteSessionId = null;
}

function isCaptainVoteActive() {
  return voteActive;
}

function getCaptainA() {
  return captainA;
}

function getCaptainB() {
  return captainB;
}

function getCaptains() {
  return { captainA, captainB };
}

function getCaptainPlayers() {
  return [...captainPlayers];
}

function createVotePanel(finished = false) {
  const playerList = captainPlayers.map((player, index) =>
    `**${index + 1}.** ${player.nickname} — ${player.rank}`
  ).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Votação de capitães")
    .setDescription(
      finished
        ? `Votação encerrada!\n\n` +
          `👑 **Time A:** <@${captainA.discordId}>\n` +
          `👑 **Time B:** <@${captainB.discordId}>`
        : "Cada jogador deve votar em um participante para capitão."
    )
    .addFields(
      {
        name: "Jogadores",
        value: playerList || "Nenhum.",
        inline: false
      },
      {
        name: "Votos registrados",
        value: `${votes.size}/${captainPlayers.length}`,
        inline: true
      }
    )
    .setFooter({
      text: finished
        ? "Draft de jogadores iniciado"
        : "Rainbow Six Siege • Matchmaking"
    });

  if (finished) {
    return {
      embeds: [embed],
      components: []
    };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("captain_vote")
    .setPlaceholder("Vote em um capitão")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      captainPlayers.map(player => ({
        label: String(player.nickname).slice(0, 100),
        description:
          `Rank: ${player.rank}`.slice(0, 100),
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

function saveVoteState() {
  const session = getSession();

  if (
    !session ||
    session.id !== voteSessionId ||
    session.stage !== "captain_vote"
  ) {
    return;
  }

  db.prepare(`
    UPDATE matchmaking_sessions
    SET state_json = ?,
        updated_at = ?
    WHERE id = ? AND stage = 'captain_vote'
  `).run(
    JSON.stringify({
      captainVote: {
        votes: Object.fromEntries(votes),
        messageId: voteMessage?.id || null,
        channelId: voteMessage?.channelId || null
      }
    }),
    Date.now(),
    voteSessionId
  );
}

async function startCaptainVote(interaction, players) {
  if (voteActive) {
    throw new Error("CAPTAIN_VOTE_ALREADY_ACTIVE");
  }

  if (
    !Array.isArray(players) ||
    players.length !== 10 ||
    new Set(players.map(p => p.discordId)).size !== 10
  ) {
    throw new Error("INVALID_CAPTAIN_VOTE_PLAYERS");
  }

  const session = getSession();

  if (!session) {
    throw new Error("CAPTAIN_VOTE_SESSION_NOT_FOUND");
  }

  captainPlayers = [...players];
  votes = new Map();

  voteSessionId = session.id;
  voteClient = interaction.client;

  captainA = null;
  captainB = null;

  voteActive = true;
  voteFinishing = false;

  db.prepare(`
    UPDATE matchmaking_sessions
    SET stage = 'captain_vote',
        deadline_at = NULL,
        state_json = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify({
      captainVote: {
        votes: {},
        messageId: null,
        channelId: null
      }
    }),
    Date.now(),
    voteSessionId
  );

  try {
    voteMessage = await interaction.followUp({
      ...createVotePanel(),
      fetchReply: true
    });

    saveVoteState();
  } catch (error) {
    resetCaptainVote();
    throw error;
  }
}

async function handleCaptainVote(interaction) {
  const session = getSession();

  if (
    !voteActive ||
    voteFinishing ||
    !session ||
    session.id !== voteSessionId ||
    session.stage !== "captain_vote"
  ) {
    return interaction.reply({
      content: "Não existe uma votação de capitães ativa.",
      ephemeral: true
    });
  }

  const voterId = interaction.user.id;
  const selectedId = interaction.values[0];

  if (!captainPlayers.some(p => p.discordId === voterId)) {
    return interaction.reply({
      content: "Você não participa desta votação.",
      ephemeral: true
    });
  }

  if (votes.has(voterId)) {
    return interaction.reply({
      content: "Você já registrou seu voto.",
      ephemeral: true
    });
  }

  if (!captainPlayers.some(p => p.discordId === selectedId)) {
    return interaction.reply({
      content: "Jogador selecionado inválido.",
      ephemeral: true
    });
  }

  votes.set(voterId, selectedId);
  saveVoteState();

  await interaction.deferUpdate();

  if (votes.size === captainPlayers.length) {
    await finishCaptainVote(interaction);
  } else if (voteMessage) {
    await voteMessage.edit(createVotePanel());
  }
}

function selectCaptains() {
  const counts = new Map(
    captainPlayers.map(player => [player.discordId, 0])
  );

  for (const selectedId of votes.values()) {
    counts.set(selectedId, (counts.get(selectedId) || 0) + 1);
  }

  const ranked = [...captainPlayers];

  // Em caso de empate, embaralha antes de ordenar.
  for (let i = ranked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ranked[i], ranked[j]] = [ranked[j], ranked[i]];
  }

  ranked.sort(
    (a, b) =>
      counts.get(b.discordId) - counts.get(a.discordId)
  );

  return [ranked[0], ranked[1]];
}

async function finishCaptainVote(interaction = null) {
  if (!voteActive || voteFinishing) return;

  if (votes.size !== captainPlayers.length) return;

  voteFinishing = true;

  const session = getSession();

  if (!session || session.id !== voteSessionId) {
    voteFinishing = false;
    throw new Error("CAPTAIN_VOTE_SESSION_LOST");
  }

  [captainA, captainB] = selectCaptains();

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
      voteSessionId
    );

    db.prepare(`
      UPDATE matchmaking_sessions
      SET stage = 'draft',
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
      voteSessionId
    );
  })();

  if (voteMessage) {
    try {
      await voteMessage.edit(createVotePanel(true));
    } catch (error) {
      console.error("Erro ao encerrar painel de votação:", error);
    }
  }

  const context = interaction || {
    client: voteClient,
    followUp: async (payload) => {
      if (!voteMessage?.channel) {
        throw new Error("CAPTAIN_VOTE_CHANNEL_UNAVAILABLE");
      }
      return voteMessage.channel.send(payload);
    }
  };

  try {
    await startDraft(
      context,
      [...captainPlayers],
      captainA,
      captainB
    );

    resetCaptainVote();
  } catch (error) {
    console.error("Erro ao iniciar draft:", error);
    throw error;
  }
}

async function restoreCaptainVote(client) {
  const session = getSession();

  if (!session || session.stage !== "captain_vote") {
    return false;
  }

  if (voteActive) return true;

  const rows = db.prepare(`
    SELECT sp.discord_id, p.r6_nickname, p.r6_rank
    FROM matchmaking_session_players sp
    LEFT JOIN players p
      ON p.discord_id = sp.discord_id
    WHERE sp.session_id = ?
    ORDER BY sp.joined_at, sp.id
  `).all(session.id);

  if (rows.length !== 10) {
    console.error(
      `Votação não recuperada: ${rows.length} jogadores encontrados.`
    );
    return false;
  }

  captainPlayers = rows.map(row => ({
    discordId: row.discord_id,
    nickname: row.r6_nickname || row.discord_id,
    rank: row.r6_rank || "Não informado"
  }));

  let state = {};

  try {
    state = JSON.parse(
      session.state_json || "{}"
    ).captainVote || {};
  } catch {
    state = {};
  }

  const validIds = new Set(
    captainPlayers.map(p => p.discordId)
  );

  votes = new Map(
    Object.entries(state.votes || {}).filter(
      ([voter, selected]) =>
        validIds.has(voter) && validIds.has(selected)
    )
  );

  voteSessionId = session.id;
  voteClient = client;
  voteActive = true;
  voteFinishing = false;

  const channel = await client.channels.fetch(
    state.channelId || session.channel_id
  );

  if (!channel?.send) {
    resetCaptainVote();
    throw new Error("CAPTAIN_VOTE_CHANNEL_NOT_FOUND");
  }

  if (state.messageId && channel.messages) {
    try {
      voteMessage = await channel.messages.fetch(
        state.messageId
      );
    } catch {
      voteMessage = null;
    }
  }

  if (!voteMessage) {
    voteMessage = await channel.send(createVotePanel());
    saveVoteState();
  } else {
    await voteMessage.edit(createVotePanel());
  }

  if (votes.size === captainPlayers.length) {
    await finishCaptainVote();
  }

  console.log(
    `Votação recuperada: ${votes.size}/${captainPlayers.length} votos.`
  );

  return true;
}

module.exports = {
  startCaptainVote,
  handleCaptainVote,
  finishCaptainVote,
  restoreCaptainVote,
  resetCaptainVote,
  isCaptainVoteActive,
  getCaptainA,
  getCaptainB,
  getCaptains,
  getCaptainPlayers
};
