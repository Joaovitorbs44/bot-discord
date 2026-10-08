
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require("discord.js");

const db = require("../database/database");
const queueState = require("./queueState");
const { startDraft } = require("./drafts");

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451
};

let voteActive = false;
let voteFinishing = false;

let captainA = null;
let captainB = null;

let captainPlayers = [];
let votes = new Map();

let voteMessage = null;
let voteClient = null;
let voteSessionId = null;

// ==========================================
// SESSÃO
// ==========================================

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

// ==========================================
// TEXTO SEGURO
// ==========================================

function safeText(value, fallback = "Não informado") {
  return String(value || fallback)
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, 80);
}

// ==========================================
// PAINEL COMPONENTS V2
// ==========================================

function createVotePanel(finished = false) {
  const count = votes.size;
  const total = captainPlayers.length;
  const remaining = Math.max(0, total - count);

  const playerList = captainPlayers.length
    ? captainPlayers.map((player, index) => {
        return (
          `**${String(index + 1).padStart(2, "0")}.** ` +
          `${safeText(player.nickname)}\n` +
          `-# ${safeText(player.rank)}`
        );
      }).join("\n")
    : "Nenhum jogador disponível.";

  const status = finished
    ? "Votação encerrada"
    : "Votação em andamento";

  const description = finished
    ? (
      `### Capitães eleitos\n` +
      `**Time A:** <@${captainA.discordId}>\n` +
      `**Time B:** <@${captainB.discordId}>\n\n` +
      "-# O draft de jogadores será iniciado."
    )
    : (
      "Cada jogador deve escolher um participante para capitão.\n" +
      "Os dois jogadores mais votados serão selecionados."
    );

  const container = new ContainerBuilder()
    .setAccentColor(
      finished ? COLORS.success : COLORS.primary
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVISIXTATIONAL\n" +
        "### VOTAÇÃO DE CAPITÃES · 5V5"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Status:** ${status}\n` +
        `**Votos registrados:** ${count}/${total}\n` +
        `**Restantes:** ${remaining}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        description
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### Jogadores disponíveis\n${playerList}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        finished
          ? "-# Votação concluída."
          : "-# Cada jogador pode votar apenas uma vez."
      )
    );

  if (finished) {
    return {
      content: null,
      embeds: [],
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] }
    };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("captain_vote")
    .setPlaceholder("Selecione um capitão")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      captainPlayers.map(player => ({
        label: String(player.nickname || "Jogador")
          .slice(0, 100),
        description: `Rank: ${player.rank || "Não informado"}`
          .slice(0, 100),
        value: player.discordId
      }))
    );

  return {
    content: null,
    embeds: [],
    components: [
      container,
      new ActionRowBuilder().addComponents(select)
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

// ==========================================
// PERSISTÊNCIA
// ==========================================

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

// ==========================================
// INICIAR VOTAÇÃO
// ==========================================

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

// ==========================================
// REGISTRAR VOTO
// ==========================================

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
      flags: MessageFlags.Ephemeral
    });
  }

  const voterId = interaction.user.id;
  const selectedId = interaction.values[0];

  if (!captainPlayers.some(p => p.discordId === voterId)) {
    return interaction.reply({
      content: "Você não participa desta votação.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (votes.has(voterId)) {
    return interaction.reply({
      content: "Você já registrou seu voto.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (!captainPlayers.some(p => p.discordId === selectedId)) {
    return interaction.reply({
      content: "Jogador selecionado inválido.",
      flags: MessageFlags.Ephemeral
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

// ==========================================
// SELEÇÃO DOS CAPITÃES
// ==========================================

function selectCaptains() {
  const counts = new Map(
    captainPlayers.map(player => [
      player.discordId, 0
    ])
  );

  for (const selectedId of votes.values()) {
    counts.set(
      selectedId,
      (counts.get(selectedId) || 0) + 1
    );
  }

  const ranked = [...captainPlayers];

  // Em caso de empate, embaralha antes de ordenar.
  for (let i = ranked.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [ranked[i], ranked[j]] = [
      ranked[j],
      ranked[i]
    ];
  }

  ranked.sort(
    (a, b) =>
      counts.get(b.discordId) -
      counts.get(a.discordId)
  );

  return [ranked[0], ranked[1]];
}

// ==========================================
// FINALIZAR VOTAÇÃO
// ==========================================

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
      console.error(
        "Erro ao encerrar painel de votação:",
        error
      );
    }
  }

  const context = interaction || {
    client: voteClient,
    followUp: async payload => {
      if (!voteMessage?.channel) {
        throw new Error(
          "CAPTAIN_VOTE_CHANNEL_UNAVAILABLE"
        );
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
    console.error(
      "Erro ao iniciar draft:",
      error
    );
    throw error;
  }
}

// ==========================================
// RECUPERAÇÃO APÓS REINÍCIO
// ==========================================

async function restoreCaptainVote(client) {
  const session = getSession();

  if (
    !session ||
    session.stage !== "captain_vote"
  ) {
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
    nickname:
      row.r6_nickname || row.discord_id,
    rank:
      row.r6_rank || "Não informado"
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
        validIds.has(voter) &&
        validIds.has(selected)
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
    throw new Error(
      "CAPTAIN_VOTE_CHANNEL_NOT_FOUND"
    );
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
    voteMessage = await channel.send(
      createVotePanel()
    );

    saveVoteState();
  } else {
    await voteMessage.edit(
      createVotePanel()
    );
  }

  if (votes.size === captainPlayers.length) {
    await finishCaptainVote();
  }

  console.log(
    `Votação recuperada: ${votes.size}/${captainPlayers.length} votos.`
  );

  return true;
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

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
