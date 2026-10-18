const { captainTeam } = require("../services/teamLabels");
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
const { startMapVeto } = require("./mapVeto");

const PICK_TIMEOUT_SECONDS =
  config.matchmaking?.draftPickSeconds || 45;

const draftRounds = [
  { captain: "A", picks: 1 },
  { captain: "B", picks: 2 },
  { captain: "A", picks: 2 },
  { captain: "B", picks: 2 },
  { captain: "A", picks: 1 }
];

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451
};

const RANKS = [
  "cobre",
  "bronze",
  "prata",
  "ouro",
  "platina",
  "esmeralda",
  "diamante",
  "campeao"
];

let draftActive = false;
let draftFinishing = false;

let captainA = null;
let captainB = null;

let teamA = [];
let teamB = [];
let availablePlayers = [];

let currentRound = 0;
let draftMessage = null;
let draftClient = null;
let draftSessionId = null;

let roundDeadline = null;
let roundTimeout = null;

function getSession() {
  return queueState.getActiveSession();
}

function parseState(raw) {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" &&
      !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function limitText(value, maxLength = 100) {
  const text = String(value || "—");
  return text.length <= maxLength
    ? text
    : text.slice(0, maxLength - 3) + "...";
}

function safeText(value) {
  return String(value || "—")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, 80);
}

function rankScore(rank) {
  const normalized = String(rank || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const index = RANKS.findIndex(name =>
    normalized.startsWith(name)
  );

  return index < 0 ? 0 : index + 1;
}

function teamStrength(players) {
  return players.reduce(
    (total, player) => total + rankScore(player.rank),
    0
  );
}

function strengthText() {
  const scoreA = teamStrength(teamA);
  const scoreB = teamStrength(teamB);

  // Comparação ilustrativa, não um MMR oficial.
  const averageA = teamA.length
    ? (scoreA / teamA.length).toFixed(1)
    : "0.0";

  const averageB = teamB.length
    ? (scoreB / teamB.length).toFixed(1)
    : "0.0";

  return (
    `**${teamName("A")}:** ${averageA}\n` +
    `**${teamName("B")}:** ${averageB}\n` +
    "-# Média ilustrativa baseada nos ranks. " +
    "Não representa o MMR oficial do Rainbow Six."
  );
}

function createPlayerList(players, captain) {
  if (!players?.length) return "—";

  return players.map(player => {
    const isCaptain =
      captain?.discordId === player.discordId;

    return (
      `${isCaptain ? "👑" : "•"} ` +
      `${safeText(player.nickname)}\n` +
      `-# ${safeText(player.rank)}`
    );
  }).join("\n");
}

function getCurrentRound() {
  return draftRounds[currentRound] || null;
}

function clearRoundTimer() {
  if (roundTimeout) {
    clearTimeout(roundTimeout);
    roundTimeout = null;
  }
}

function scheduleRoundTimeout() {
  clearRoundTimer();

  if (
    !draftActive ||
    draftFinishing ||
    !roundDeadline
  ) {
    return;
  }

  roundTimeout = setTimeout(() => {
    handleDraftTimeout().catch(error => {
      console.error(
        "[DRAFT] Erro no timeout:",
        error
      );
    });
  }, Math.max(0, roundDeadline - Date.now()));
}

function saveDraftState() {
  const session = getSession();

  if (
    !session ||
    session.id !== draftSessionId ||
    session.stage !== "draft"
  ) {
    return false;
  }

  const state = parseState(session.state_json);

  state.draft = {
    captainA,
    captainB,
    teamA,
    teamB,
    availablePlayers,
    currentRound,
    messageId: draftMessage?.id || null,
    channelId:
      draftMessage?.channelId ||
      config.discord.draftChannelId
  };

  const updatePlayer = db.prepare(`
    UPDATE matchmaking_session_players
    SET team = ?
    WHERE session_id = ?
      AND discord_id = ?
  `);

  db.transaction(() => {
    const updated = db.prepare(`
      UPDATE matchmaking_sessions
      SET state_json = ?,
          deadline_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'active'
        AND stage = 'draft'
    `).run(
      JSON.stringify(state),
      roundDeadline,
      Date.now(),
      session.id
    );

    if (updated.changes !== 1) {
      throw new Error("DRAFT_SAVE_FAILED");
    }

    for (const player of teamA) {
      updatePlayer.run(
        "A",
        session.id,
        player.discordId
      );
    }

    for (const player of teamB) {
      updatePlayer.run(
        "B",
        session.id,
        player.discordId
      );
    }
  })();

  return true;
}

function createDraftPanel() {
  const round = getCurrentRound();

  if (!round) {
    return createFinishedDraftPanel();
  }

  const currentCaptain =
    round.captain === "A" ? captainA : captainB;

  if (availablePlayers.length < round.picks) {
    throw new Error(
      "NOT_ENOUGH_PLAYERS_FOR_DRAFT_ROUND"
    );
  }

  const deadline = roundDeadline
    ? `<t:${Math.ceil(roundDeadline / 1000)}:R>`
    : `${PICK_TIMEOUT_SECONDS}s`;

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.primary)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVI SIX PRO\n" +
        "### DRAFT DE JOGADORES · 5V5"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Rodada:** ${currentRound + 1}/${draftRounds.length}\n` +
        `**Vez de escolher:** <@${currentCaptain.discordId}>\n` +
        `**Escolhas:** ${round.picks} jogador(es)\n` +
        `**Tempo restante:** ${deadline}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${teamName("A")} · ${teamA.length}/${config.matchmaking.teamSize}\n` +
        createPlayerList(teamA, captainA)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${teamName("B")} · ${teamB.length}/${config.matchmaking.teamSize}\n` +
        createPlayerList(teamB, captainB)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### Força estimada dos times\n" +
        strengthText()
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### Jogadores disponíveis\n" +
        (
          availablePlayers.length
            ? availablePlayers.map(player =>
                `• ${safeText(player.nickname)} · ` +
                safeText(player.rank)
              ).join("\n")
            : "Nenhum."
        )
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# Se o tempo terminar, os jogadores " +
        "serão escolhidos automaticamente."
      )
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId("draft_pick")
    .setPlaceholder(
      round.picks === 1
        ? "Escolha 1 jogador"
        : `Escolha ${round.picks} jogadores`
    )
    .setMinValues(round.picks)
    .setMaxValues(round.picks)
    .addOptions(
      availablePlayers.map(player => ({
        label: limitText(player.nickname),
        description: limitText(
          `Rank: ${player.rank}`
        ),
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

function createFinishedDraftPanel() {
  const container = new ContainerBuilder()
    .setAccentColor(COLORS.success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVI SIX PRO\n" +
        "### TIMES DEFINIDOS · 5V5"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "O draft foi concluído. " +
        "Os dois times estão definidos."
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${teamName("A")}\n` +
        createPlayerList(teamA, captainA)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${teamName("B")}\n` +
        createPlayerList(teamB, captainB)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### Força estimada\n" +
        strengthText()
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# Veto de mapas iniciado."
      )
    );

  return {
    content: null,
    embeds: [],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

async function startDraft(
  interaction,
  players,
  firstCaptain,
  secondCaptain
) {
  if (draftActive) {
    throw new Error("DRAFT_ALREADY_ACTIVE");
  }

  if (
    !Array.isArray(players) ||
    players.length !== config.matchmaking.requiredPlayers
  ) {
    throw new Error("INVALID_DRAFT_PLAYERS");
  }

  if (
    !firstCaptain?.discordId ||
    !secondCaptain?.discordId ||
    firstCaptain.discordId === secondCaptain.discordId
  ) {
    throw new Error("INVALID_DRAFT_CAPTAINS");
  }

  const ids = players.map(player => player?.discordId);

  if (
    ids.some(id => !id) ||
    new Set(ids).size !== players.length ||
    !ids.includes(firstCaptain.discordId) ||
    !ids.includes(secondCaptain.discordId)
  ) {
    throw new Error("INVALID_DRAFT_PLAYER_LIST");
  }

  const session = getSession();

  if (
    !session ||
    !["captain_vote", "draft"].includes(session.stage)
  ) {
    throw new Error("DRAFT_SESSION_NOT_READY");
  }

  const channel = await interaction.client.channels.fetch(
    config.discord.draftChannelId
  );

  if (!channel?.isTextBased() || !channel.send) {
    throw new Error("INVALID_DRAFT_CHANNEL");
  }

  captainA = firstCaptain;
  captainB = secondCaptain;

  teamA = [captainA];
  teamB = [captainB];

  availablePlayers = players.filter(player =>
    player.discordId !== captainA.discordId &&
    player.discordId !== captainB.discordId
  );

  currentRound = 0;
  draftMessage = null;
  draftSessionId = session.id;
  draftClient = interaction.client;

  draftActive = true;
  draftFinishing = false;

  roundDeadline =
    Date.now() + PICK_TIMEOUT_SECONDS * 1000;

  try {
    if (session.stage === "captain_vote") {
      const updated = db.prepare(`
        UPDATE matchmaking_sessions
        SET stage = 'draft',
            updated_at = ?
        WHERE id = ?
          AND stage = 'captain_vote'
      `).run(Date.now(), session.id);

      if (updated.changes !== 1) {
        throw new Error("DRAFT_TRANSITION_FAILED");
      }
    }

    saveDraftState();

    draftMessage = await channel.send(
      createDraftPanel()
    );

    saveDraftState();
    scheduleRoundTimeout();

    // Não usa interaction.followUp: a votação
    // pode ter sido concluída após uma espera
    // maior que o tempo válido da interação.
    console.log(
      `[DRAFT] Painel publicado no canal ${channel.id}.`
    );

    return draftMessage;
  } catch (error) {
    console.error(
      "[DRAFT] Erro ao iniciar:",
      error
    );

    // Mantém a etapa persistida para recuperação.
    resetDraft();
    throw error;
  }
}

function applyPicks(selectedPlayers) {
  const round = getCurrentRound();

  if (
    !round ||
    selectedPlayers.length !== round.picks
  ) {
    throw new Error("INVALID_DRAFT_SELECTION");
  }

  const selectedIds = new Set(
    selectedPlayers.map(player => player.discordId)
  );

  if (selectedIds.size !== round.picks) {
    throw new Error("DUPLICATED_DRAFT_SELECTION");
  }

  for (const id of selectedIds) {
    if (!availablePlayers.some(player =>
      player.discordId === id
    )) {
      throw new Error("DRAFT_PLAYER_UNAVAILABLE");
    }
  }

  if (round.captain === "A") {
    teamA.push(...selectedPlayers);
  } else {
    teamB.push(...selectedPlayers);
  }

  availablePlayers = availablePlayers.filter(
    player => !selectedIds.has(player.discordId)
  );

  currentRound++;

  roundDeadline =
    currentRound < draftRounds.length
      ? Date.now() + PICK_TIMEOUT_SECONDS * 1000
      : null;

  saveDraftState();
}

async function handleDraftPick(interaction) {
  if (!draftActive || draftFinishing) {
    return interaction.reply({
      content: "Não existe um draft ativo.",
      flags: MessageFlags.Ephemeral
    });
  }

  const round = getCurrentRound();

  if (!round) {
    return interaction.reply({
      content: "O draft já terminou.",
      flags: MessageFlags.Ephemeral
    });
  }

  const currentCaptain =
    round.captain === "A" ? captainA : captainB;

  if (interaction.user.id !== currentCaptain.discordId) {
    return interaction.reply({
      content:
        `Agora é a vez de **${safeText(currentCaptain.nickname)}** escolher.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (Date.now() >= roundDeadline) {
    await interaction.reply({
      content: "O tempo desta rodada terminou.",
      flags: MessageFlags.Ephemeral
    });

    await handleDraftTimeout();
    return;
  }

  if (interaction.values.length !== round.picks) {
    return interaction.reply({
      content:
        `Escolha exatamente ${round.picks} jogador(es).`,
      flags: MessageFlags.Ephemeral
    });
  }

  const selectedIds = new Set(interaction.values);

  if (selectedIds.size !== round.picks) {
    return interaction.reply({
      content: "Existem jogadores duplicados.",
      flags: MessageFlags.Ephemeral
    });
  }

  const selectedPlayers = interaction.values.map(
    id => availablePlayers.find(
      player => player.discordId === id
    )
  );

  if (selectedPlayers.some(player => !player)) {
    return interaction.reply({
      content:
        "Um dos jogadores não está mais disponível.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate();

  clearRoundTimer();
  applyPicks(selectedPlayers);

  if (currentRound >= draftRounds.length) {
    await finishDraft();
    await interaction.followUp({ content: `Draft concluído. Continuem em <#${config.discord.mapVetoChannelId}>.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (draftMessage) {
    await draftMessage.edit(createDraftPanel());
  }

  scheduleRoundTimeout();
}

async function handleDraftTimeout() {
  if (!draftActive || draftFinishing) return;

  const round = getCurrentRound();

  if (!round) return;

  if (Date.now() < roundDeadline) {
    scheduleRoundTimeout();
    return;
  }

  clearRoundTimer();

  const shuffled = [...availablePlayers];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [shuffled[i], shuffled[j]] = [
      shuffled[j],
      shuffled[i]
    ];
  }

  const selectedPlayers =
    shuffled.slice(0, round.picks);

  const captain =
    round.captain === "A" ? captainA : captainB;

  applyPicks(selectedPlayers);

  if (draftMessage) {
    try {
      await draftMessage.channel.send({
        content:
          `⏱️ O tempo de <@${captain.discordId}> terminou.\n` +
          `Escolha automática: **${selectedPlayers.map(
            player => safeText(player.nickname)
          ).join(", ")}**.`,
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      console.error(
        "[DRAFT] Erro ao anunciar pick automático:",
        error
      );
    }
  }

  if (currentRound >= draftRounds.length) {
    await finishDraft();
    return;
  }

  if (draftMessage) {
    try {
      await draftMessage.edit(createDraftPanel());
    } catch (error) {
      console.error(
        "[DRAFT] Erro ao atualizar painel:",
        error
      );
    }
  }

  scheduleRoundTimeout();
}

async function finishDraft() {
  if (!draftActive || draftFinishing) return;

  if (
    teamA.length !== config.matchmaking.teamSize ||
    teamB.length !== config.matchmaking.teamSize ||
    availablePlayers.length !== 0
  ) {
    throw new Error("INVALID_FINAL_DRAFT_TEAMS");
  }

  draftFinishing = true;
  clearRoundTimer();

  const session = getSession();

  if (
    !session ||
    session.id !== draftSessionId ||
    session.stage !== "draft"
  ) {
    draftFinishing = false;
    throw new Error("DRAFT_SESSION_LOST");
  }

  const result = {
    teamA: [...teamA],
    teamB: [...teamB]
  };

  const selectedCaptainA = captainA;
  const selectedCaptainB = captainB;

  const oldMessage = draftMessage;

  const state = parseState(session.state_json);

  state.draftCompleted = true;
  state.draft = {
    ...state.draft,
    ...result,
    captainA: selectedCaptainA,
    captainB: selectedCaptainB,
    availablePlayers: [],
    currentRound: draftRounds.length,
    messageId: oldMessage?.id || null,
    channelId:
      oldMessage?.channelId ||
      config.discord.draftChannelId
  };

  const updated = db.prepare(`
    UPDATE matchmaking_sessions
    SET stage = 'map_veto',
        deadline_at = NULL,
        state_json = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'active'
      AND stage = 'draft'
  `).run(
    JSON.stringify(state),
    Date.now(),
    session.id
  );

  if (updated.changes !== 1) {
    draftFinishing = false;
    throw new Error("DRAFT_FINISH_SAVE_FAILED");
  }

  try {
    if (oldMessage) {
      await oldMessage.edit(createFinishedDraftPanel());
    }
  } catch (error) {
    console.warn(
      "[DRAFT] Não foi possível finalizar painel:",
      error.message
    );
  }

  const context = {
    client: draftClient,
    followUp: async payload => {
      const channel = await draftClient.channels.fetch(
        config.discord.mapVetoChannelId
      );

      if (!channel?.send) {
        throw new Error(
          "MAP_VETO_CHANNEL_UNAVAILABLE"
        );
      }

      return channel.send(payload);
    }
  };

  try {
    await startMapVeto(
      context,
      result,
      selectedCaptainA,
      selectedCaptainB
    );

    await removeMessage(draftClient, oldMessage);

    resetDraft();

    console.log(
      "[DRAFT] Draft concluído e veto iniciado."
    );
  } catch (error) {
    console.error(
      "[DRAFT] Erro ao iniciar veto:",
      error
    );

    // A sessão já está em map_veto.
    // Não refaz o draft automaticamente.
    resetDraft();
    throw error;
  }
}

async function restoreDraft(client) {
  const session = getSession();

  if (!session || session.stage !== "draft") {
    return false;
  }

  if (draftActive) return true;

  const state = parseState(session.state_json).draft;

  if (
    !state ||
    !state.captainA ||
    !state.captainB ||
    !Array.isArray(state.teamA) ||
    !Array.isArray(state.teamB) ||
    !Array.isArray(state.availablePlayers)
  ) {
    console.error(
      "[DRAFT] Estado persistido inválido."
    );

    return false;
  }

  captainA = state.captainA;
  captainB = state.captainB;

  teamA = state.teamA;
  teamB = state.teamB;
  availablePlayers = state.availablePlayers;

  currentRound = state.currentRound || 0;

  draftSessionId = session.id;
  draftClient = client;
  roundDeadline = session.deadline_at;

  draftActive = true;
  draftFinishing = false;

  const channelId =
    state.channelId ||
    config.discord.draftChannelId;

  const channel = await client.channels.fetch(channelId);

  if (!channel?.isTextBased() || !channel.send) {
    resetDraft();
    throw new Error(
      "INVALID_DRAFT_RESTORE_CHANNEL"
    );
  }

  if (state.messageId && channel.messages) {
    try {
      draftMessage = await channel.messages.fetch(
        state.messageId
      );
    } catch {
      draftMessage = null;
    }
  }

  if (currentRound >= draftRounds.length) {
    await finishDraft();
    return true;
  }

  if (!roundDeadline) {
    roundDeadline =
      Date.now() + PICK_TIMEOUT_SECONDS * 1000;

    saveDraftState();
  }

  if (!draftMessage) {
    draftMessage = await channel.send(
      createDraftPanel()
    );

    saveDraftState();
  } else {
    await draftMessage.edit(createDraftPanel());
  }

  if (Date.now() >= roundDeadline) {
    await handleDraftTimeout();
  } else {
    scheduleRoundTimeout();
  }

  console.log(
    `[DRAFT] Recuperado na rodada ${currentRound + 1}.`
  );

  return true;
}

function resetDraft() {
  clearRoundTimer();

  draftActive = false;
  draftFinishing = false;

  captainA = null;
  captainB = null;

  teamA = [];
  teamB = [];
  availablePlayers = [];

  currentRound = 0;

  draftMessage = null;
  draftClient = null;
  draftSessionId = null;
  roundDeadline = null;
}

function isDraftActive() {
  return draftActive;
}

function getTeams() {
  return {
    teamA: [...teamA],
    teamB: [...teamB]
  };
}

module.exports = {
  startDraft,
  handleDraftPick,
  restoreDraft,
  resetDraft,
  isDraftActive,
  getTeams
};


function teamName(team) { return captainTeam(team === "A" ? captainA : captainB, db); }
