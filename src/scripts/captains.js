const { removeMessage } = require("../services/panelLifecycle");

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
const config = require("../config/config");
const queueState = require("./queueState");
const { startDraft } = require("./drafts");

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451
};

const RANK_ORDER = [
  "cobre",
  "bronze",
  "prata",
  "ouro",
  "platina",
  "esmeralda",
  "diamante",
  "campeao"
];

let voteActive = false;
let voteFinishing = false;

let captainA = null;
let captainB = null;

let captainPlayers = [];
let eligibleIds = [];
let votes = new Map();

let voteMessage = null;
let voteClient = null;
let voteSessionId = null;
let voteChannelId = null;

function getSession() {
  return queueState.getActiveSession();
}

function parseState(raw) {
  try {
    const value = JSON.parse(raw || "{}");

    return value &&
      typeof value === "object" &&
      !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

function safeText(value, fallback = "Não informado") {
  return String(value || fallback)
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, 80);
}

function normalizeRank(rank) {
  return String(rank || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function rankScore(rank) {
  const normalized = normalizeRank(rank);

  return RANK_ORDER.findIndex(
    name => normalized.startsWith(name)
  );
}

function validatePlayers(players) {
  if (
    !Array.isArray(players) ||
    players.length !== config.matchmaking.requiredPlayers ||
    players.some(player => !player?.discordId) ||
    new Set(
      players.map(player => player.discordId)
    ).size !== players.length
  ) {
    throw new Error("INVALID_CAPTAIN_VOTE_PLAYERS");
  }
}

function calculateEligibleIds(players) {
  const ranked = players.map(player => ({
    id: player.discordId,
    score: rankScore(player.rank)
  }));

  const unknown = ranked.filter(
    player => player.score < 0
  );

  if (unknown.length) {
    throw new Error(
      "CAPTAIN_VOTE_UNKNOWN_RANKS: " +
      unknown.map(player => player.id).join(", ")
    );
  }

  const levels = [
    ...new Set(ranked.map(player => player.score))
  ].sort((a, b) => b - a);

  const selectedLevels = new Set(
    levels.slice(0, 2)
  );

  return ranked
    .filter(player =>
      selectedLevels.has(player.score)
    )
    .map(player => player.id);
}

function getEligiblePlayers() {
  const allowed = new Set(eligibleIds);

  return captainPlayers.filter(
    player => allowed.has(player.discordId)
  );
}

function resetCaptainVote() {
  voteActive = false;
  voteFinishing = false;

  captainA = null;
  captainB = null;

  captainPlayers = [];
  eligibleIds = [];
  votes = new Map();

  voteMessage = null;
  voteClient = null;
  voteSessionId = null;
  voteChannelId = null;
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
  const count = votes.size;
  const total = captainPlayers.length;
  const remaining = Math.max(0, total - count);

  const eligible = getEligiblePlayers();
  const allowed = new Set(eligibleIds);

  const playerList = captainPlayers.map(
    (player, index) => {
      const eligibleForCaptain =
        allowed.has(player.discordId);

      return (
        `**${String(index + 1).padStart(2, "0")}.** ` +
        `${safeText(player.nickname)}\n` +
        `-# ${safeText(player.rank)} · ` +
        (
          eligibleForCaptain
            ? "👑 Elegível"
            : "Jogador"
        )
      );
    }
  ).join("\n");

  const description = finished
    ? (
      "### Capitães eleitos\n" +
      `**Time A:** <@${captainA.discordId}>\n` +
      `**Time B:** <@${captainB.discordId}>\n\n` +
      "-# O draft de jogadores será iniciado."
    )
    : (
      "Todos os jogadores podem votar uma vez.\n" +
      "Somente os jogadores dos dois níveis de " +
      "rank mais altos podem receber votos."
    );

  const container = new ContainerBuilder()
    .setAccentColor(
      finished ? COLORS.success : COLORS.primary
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVI SIX PRO\n" +
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
        `**Status:** ${
          finished
            ? "Votação encerrada"
            : "Votação em andamento"
        }\n` +
        `**Votos registrados:** ${count}/${total}\n` +
        `**Restantes:** ${remaining}\n` +
        `**Candidatos elegíveis:** ${eligible.length}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(description)
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
          : "-# Em caso de empate, o rank mais alto " +
            "tem preferência."
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

  if (eligible.length < 2) {
    throw new Error(
      "CAPTAIN_VOTE_NOT_ENOUGH_ELIGIBLE_PLAYERS"
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("captain_vote")
    .setPlaceholder("Selecione um capitão")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      eligible.map(player => ({
        label: String(
          player.nickname || "Jogador"
        ).slice(0, 100),
        description:
          `Rank: ${player.rank || "Não informado"}`
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

function saveVoteState() {
  const session = getSession();

  if (
    !session ||
    session.id !== voteSessionId ||
    session.stage !== "captain_vote"
  ) {
    return false;
  }

  const state = parseState(session.state_json);

  state.captainVote = {
    votes: Object.fromEntries(votes),
    eligibleIds: [...eligibleIds],
    messageId: voteMessage?.id || null,
    channelId:
      voteMessage?.channelId ||
      voteChannelId ||
      config.discord.draftChannelId
  };

  const result = db.prepare(`
    UPDATE matchmaking_sessions
    SET state_json = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'active'
      AND stage = 'captain_vote'
  `).run(
    JSON.stringify(state),
    Date.now(),
    voteSessionId
  );

  return result.changes === 1;
}

async function getVoteChannel() {
  if (!voteClient) {
    throw new Error(
      "CAPTAIN_VOTE_CLIENT_UNAVAILABLE"
    );
  }

  const channelId =
    voteChannelId ||
    config.discord.draftChannelId;

  if (!channelId) {
    throw new Error(
      "CAPTAIN_VOTE_CHANNEL_NOT_CONFIGURED"
    );
  }

  const channel =
    await voteClient.channels.fetch(channelId);

  if (!channel?.isTextBased() || !channel.send) {
    throw new Error(
      "CAPTAIN_VOTE_CHANNEL_UNAVAILABLE"
    );
  }

  return channel;
}

async function publishVotePanel(finished = false) {
  const payload = createVotePanel(finished);

  if (voteMessage) {
    try {
      voteMessage = await voteMessage.edit(payload);
      return voteMessage;
    } catch (error) {
      console.warn(
        "[CAPTAINS] Painel anterior indisponível:",
        error.message
      );

      voteMessage = null;
    }
  }

  const channel = await getVoteChannel();

  voteMessage = await channel.send(payload);

  saveVoteState();

  return voteMessage;
}

async function startCaptainVote(interaction, players) {
  if (voteActive) {
    throw new Error(
      "CAPTAIN_VOTE_ALREADY_ACTIVE"
    );
  }

  validatePlayers(players);

  const session = getSession();

  if (!session) {
    throw new Error(
      "CAPTAIN_VOTE_SESSION_NOT_FOUND"
    );
  }

  const calculatedEligible =
    calculateEligibleIds(players);

  if (calculatedEligible.length < 2) {
    throw new Error(
      "CAPTAIN_VOTE_NOT_ENOUGH_ELIGIBLE_PLAYERS"
    );
  }

  if (!interaction?.client) {
    throw new Error(
      "CAPTAIN_VOTE_CLIENT_UNAVAILABLE"
    );
  }

  captainPlayers = [...players];
  eligibleIds = calculatedEligible;

  votes = new Map();

  captainA = null;
  captainB = null;

  voteSessionId = session.id;
  voteClient = interaction.client;
  voteChannelId = config.discord.draftChannelId;

  voteMessage = null;

  voteActive = true;
  voteFinishing = false;

  const state = parseState(session.state_json);

  state.captainVote = {
    votes: {},
    eligibleIds: [...eligibleIds],
    messageId: null,
    channelId: voteChannelId
  };

  const updated = db.prepare(`
    UPDATE matchmaking_sessions
    SET stage = 'captain_vote',
        deadline_at = NULL,
        state_json = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'active'
      AND stage IN ('ready_check', 'captain_vote')
  `).run(
    JSON.stringify(state),
    Date.now(),
    voteSessionId
  );

  if (updated.changes !== 1) {
    resetCaptainVote();

    throw new Error(
      "CAPTAIN_VOTE_TRANSITION_FAILED"
    );
  }

  try {
    await publishVotePanel();

    console.log(
      `[CAPTAINS] Votação iniciada com ` +
      `${eligibleIds.length} candidatos elegíveis.`
    );

    return true;
  } catch (error) {
    console.error(
      "[CAPTAINS] Erro ao publicar votação:",
      error
    );

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
      content:
        "Não existe uma votação de capitães ativa.",
      flags: MessageFlags.Ephemeral
    });
  }

  const voterId = interaction.user.id;
  const selectedId = interaction.values?.[0];

  if (
    !captainPlayers.some(
      player => player.discordId === voterId
    )
  ) {
    return interaction.reply({
      content:
        "Você não participa desta votação.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (votes.has(voterId)) {
    return interaction.reply({
      content:
        "Você já registrou seu voto.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (!eligibleIds.includes(selectedId)) {
    return interaction.reply({
      content:
        "Esse jogador não está entre os ranks " +
        "elegíveis para capitão.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate();

  votes.set(voterId, selectedId);

  if (!saveVoteState()) {
    votes.delete(voterId);

    throw new Error(
      "CAPTAIN_VOTE_SAVE_FAILED"
    );
  }

  if (votes.size === captainPlayers.length) {
    await finishCaptainVote(interaction);
    return;
  }

  try {
    await publishVotePanel();
  } catch (error) {
    console.warn(
      "[CAPTAINS] Voto salvo, mas painel " +
      "não foi atualizado:",
      error.message
    );
  }
}

function selectCaptains() {
  const eligible = getEligiblePlayers();

  const counts = new Map(
    eligible.map(player => [
      player.discordId,
      0
    ])
  );

  for (const selectedId of votes.values()) {
    if (counts.has(selectedId)) {
      counts.set(
        selectedId,
        counts.get(selectedId) + 1
      );
    }
  }

  const ranked = [...eligible].sort((a, b) => {
    const voteDifference =
      counts.get(b.discordId) -
      counts.get(a.discordId);

    if (voteDifference !== 0) {
      return voteDifference;
    }

    const rankDifference =
      rankScore(b.rank) - rankScore(a.rank);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    return a.discordId.localeCompare(b.discordId);
  });

  if (ranked.length < 2) {
    throw new Error(
      "CAPTAIN_VOTE_NOT_ENOUGH_CAPTAINS"
    );
  }

  return [ranked[0], ranked[1]];
}

async function finishCaptainVote(interaction = null) {
  if (!voteActive || voteFinishing) return;

  if (votes.size !== captainPlayers.length) {
    return;
  }

  voteFinishing = true;

  const session = getSession();

  if (
    !session ||
    session.id !== voteSessionId ||
    session.stage !== "captain_vote"
  ) {
    voteFinishing = false;

    throw new Error(
      "CAPTAIN_VOTE_SESSION_LOST"
    );
  }

  [captainA, captainB] = selectCaptains();

  const state = parseState(session.state_json);

  state.captainVoteCompleted = true;
  state.votes = Object.fromEntries(votes);
  state.captainVote = {
    ...state.captainVote,
    votes: Object.fromEntries(votes),
    eligibleIds: [...eligibleIds],
    captainA,
    captainB,
    messageId: voteMessage?.id || null,
    channelId: voteChannelId
  };

  try {
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

      const result = db.prepare(`
        UPDATE matchmaking_sessions
        SET stage = 'draft',
            captain_a_discord_id = ?,
            captain_b_discord_id = ?,
            deadline_at = NULL,
            state_json = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'active'
          AND stage = 'captain_vote'
      `).run(
        captainA.discordId,
        captainB.discordId,
        JSON.stringify(state),
        Date.now(),
        voteSessionId
      );

      if (result.changes !== 1) {
        throw new Error(
          "CAPTAIN_VOTE_FINISH_FAILED"
        );
      }
    })();
  } catch (error) {
    voteFinishing = false;
    throw error;
  }

  try {
    await publishVotePanel(true);
  } catch (error) {
    console.warn(
      "[CAPTAINS] Painel final indisponível:",
      error.message
    );
  }

  const completedVoteMessage = voteMessage;
  const context = {
    client: voteClient,
    followUp: async payload => {
      const channel = await getVoteChannel();
      return channel.send(payload);
    }
  };

  try {
    await startDraft(
      context,
      [...captainPlayers],
      captainA,
      captainB
    );

    await removeMessage(voteClient, completedVoteMessage);

    console.log(
      `[CAPTAINS] Capitães definidos: ` +
      `${captainA.discordId} e ${captainB.discordId}.`
    );

    resetCaptainVote();
  } catch (error) {
    voteFinishing = false;

    console.error(
      "[CAPTAINS] Erro ao iniciar draft:",
      error
    );

    resetCaptainVote();
    throw error;
  }
}

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

  if (
    rows.length !==
    config.matchmaking.requiredPlayers
  ) {
    console.error(
      `[CAPTAINS] Recuperação impossível: ` +
      `${rows.length} jogadores.`
    );

    return false;
  }

  const restoredPlayers = rows.map(row => ({
    discordId: row.discord_id,
    nickname:
      row.r6_nickname || row.discord_id,
    rank:
      row.r6_rank || "Não informado"
  }));

  validatePlayers(restoredPlayers);

  const state = parseState(session.state_json);
  const saved = state.captainVote || {};

  let restoredEligible;

  try {
    restoredEligible = calculateEligibleIds(
      restoredPlayers
    );
  } catch (error) {
    console.error(
      "[CAPTAINS] Ranks inválidos na recuperação:",
      error
    );

    return false;
  }

  captainPlayers = restoredPlayers;

  const playerIds = new Set(
    captainPlayers.map(player => player.discordId)
  );

  eligibleIds = Array.isArray(saved.eligibleIds)
    ? saved.eligibleIds.filter(id =>
        playerIds.has(id) &&
        restoredEligible.includes(id)
      )
    : restoredEligible;

  if (eligibleIds.length < 2) {
    eligibleIds = restoredEligible;
  }

  const allowed = new Set(eligibleIds);

  votes = new Map(
    Object.entries(saved.votes || {}).filter(
      ([voterId, selectedId]) =>
        playerIds.has(voterId) &&
        allowed.has(selectedId)
    )
  );

  voteSessionId = session.id;
  voteClient = client;

  voteChannelId =
    saved.channelId ||
    config.discord.draftChannelId;

  voteMessage = null;

  captainA = null;
  captainB = null;

  voteActive = true;
  voteFinishing = false;

  try {
    const channel = await getVoteChannel();

    if (saved.messageId && channel.messages) {
      try {
        voteMessage = await channel.messages.fetch(
          saved.messageId
        );
      } catch (error) {
        console.warn(
          "[CAPTAINS] Mensagem antiga indisponível:",
          error.message
        );
      }
    }

    if (!saveVoteState()) {
      throw new Error(
        "CAPTAIN_VOTE_RESTORE_SAVE_FAILED"
      );
    }

    if (votes.size === captainPlayers.length) {
      await finishCaptainVote();
    } else {
      await publishVotePanel();
    }

    console.log(
      `[CAPTAINS] Votação recuperada: ` +
      `${votes.size}/${captainPlayers.length} votos.`
    );

    return true;
  } catch (error) {
    console.error(
      "[CAPTAINS] Erro na recuperação:",
      error
    );

    resetCaptainVote();
    throw error;
  }
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

