
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const queueState = require("./queueState");

const {
  startMapVeto
} = require("./mapVeto");

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const PICK_TIMEOUT_SECONDS =
  config.matchmaking?.draftPickSeconds || 45;

const draftRounds = [
  { captain: "A", picks: 1 },
  { captain: "B", picks: 2 },
  { captain: "A", picks: 2 },
  { captain: "B", picks: 2 },
  { captain: "A", picks: 1 }
];

// ==========================================
// ESTADO
// ==========================================

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

// ==========================================
// UTILITÁRIOS
// ==========================================

function getSession() {
  return queueState.getActiveSession();
}

function limitText(value, maxLength) {
  const text = String(value || "—");

  return text.length <= maxLength
    ? text
    : text.slice(0, maxLength - 3) + "...";
}

function createPlayerList(players, captain) {
  if (!players?.length) {
    return "—";
  }

  return players.map((player) => {
    const isCaptain =
      captain?.discordId === player.discordId;

    return (
      `${isCaptain ? "👑" : "•"} ` +
      `${player.nickname} — ${player.rank}`
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

  if (!draftActive || !roundDeadline) {
    return;
  }

  const remaining = Math.max(
    0,
    roundDeadline - Date.now()
  );

  roundTimeout = setTimeout(() => {
    handleDraftTimeout().catch((error) => {
      console.error(
        "Erro no timeout do draft:",
        error
      );
    });
  }, remaining);
}

function saveDraftState() {
  const session = getSession();

  if (
    !session ||
    session.id !== draftSessionId ||
    session.stage !== "draft"
  ) {
    return;
  }

  const state = {
    draft: {
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
    }
  };

  db.prepare(`
    UPDATE matchmaking_sessions
    SET
      state_json = ?,
      deadline_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(state),
    roundDeadline,
    Date.now(),
    session.id
  );

  const updatePlayer = db.prepare(`
    UPDATE matchmaking_session_players
    SET team = ?
    WHERE session_id = ?
      AND discord_id = ?
  `);

  db.transaction(() => {
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
}

// ==========================================
// INICIAR DRAFT
// ==========================================

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

  const ids = players.map((player) => player?.discordId);

  if (
    ids.some((id) => !id) ||
    new Set(ids).size !== players.length ||
    !ids.includes(firstCaptain.discordId) ||
    !ids.includes(secondCaptain.discordId)
  ) {
    throw new Error("INVALID_DRAFT_PLAYER_LIST");
  }

  const session = getSession();

  if (!session) {
    throw new Error("DRAFT_SESSION_NOT_FOUND");
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

  availablePlayers = players.filter(
    (player) =>
      player.discordId !== captainA.discordId &&
      player.discordId !== captainB.discordId
  );

  currentRound = 0;
  draftSessionId = session.id;
  draftClient = interaction.client;
  draftActive = true;
  draftFinishing = false;

  roundDeadline =
    Date.now() + PICK_TIMEOUT_SECONDS * 1000;

  try {
    db.prepare(`
      UPDATE matchmaking_sessions
      SET
        stage = 'draft',
        updated_at = ?
      WHERE id = ?
    `).run(Date.now(), session.id);

    saveDraftState();

    draftMessage = await channel.send(
      createDraftPanel()
    );

    saveDraftState();
    scheduleRoundTimeout();

    try {
      await interaction.followUp({
        content:
          `🎯 O draft de jogadores foi iniciado em <#${channel.id}>.`
      });
    } catch (error) {
      console.warn(
        "Não foi possível anunciar o canal do draft:",
        error.message
      );
    }
  } catch (error) {
    resetDraft();
    throw error;
  }
}

// ==========================================
// PAINEL
// ==========================================

function createDraftPanel() {
  const round = getCurrentRound();

  if (!round) {
    return createFinishedDraftPanel();
  }

  const currentCaptain =
    round.captain === "A" ? captainA : captainB;

  if (availablePlayers.length < round.picks) {
    throw new Error("NOT_ENOUGH_PLAYERS_FOR_DRAFT_ROUND");
  }

  const deadline = roundDeadline
    ? `<t:${Math.ceil(roundDeadline / 1000)}:R>`
    : `${PICK_TIMEOUT_SECONDS}s`;

  const embed = new EmbedBuilder()
    .setTitle("Draft 5v5")
    .setDescription(
      `É a vez de <@${currentCaptain.discordId}> escolher.\n\n` +
      `Escolha **${round.picks} jogador${
        round.picks > 1 ? "es" : ""
      }**.\n\n` +
      `⏱️ Tempo restante: **${deadline}**.\n` +
      "Se o tempo acabar, a escolha será automática."
    )
    .addFields(
      {
        name: `Time A — ${captainA.nickname}`,
        value: createPlayerList(teamA, captainA),
        inline: true
      },
      {
        name: `Time B — ${captainB.nickname}`,
        value: createPlayerList(teamB, captainB),
        inline: true
      },
      {
        name: "Jogadores disponíveis",
        value: availablePlayers.map(
          (player) =>
            `• ${player.nickname} — ${player.rank}`
        ).join("\n") || "Nenhum.",
        inline: false
      }
    )
    .setFooter({
      text:
        `Rodada ${currentRound + 1}/${draftRounds.length}`
    });

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
      availablePlayers.map((player) => ({
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
// APLICAR ESCOLHAS
// ==========================================

function applyPicks(selectedPlayers) {
  const round = getCurrentRound();

  if (!round || selectedPlayers.length !== round.picks) {
    throw new Error("INVALID_DRAFT_SELECTION");
  }

  const selectedIds = new Set(
    selectedPlayers.map((player) => player.discordId)
  );

  if (selectedIds.size !== round.picks) {
    throw new Error("DUPLICATED_DRAFT_SELECTION");
  }

  for (const id of selectedIds) {
    if (!availablePlayers.some(
      (player) => player.discordId === id
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
    (player) => !selectedIds.has(player.discordId)
  );

  currentRound++;

  roundDeadline =
    currentRound < draftRounds.length
      ? Date.now() + PICK_TIMEOUT_SECONDS * 1000
      : null;

  saveDraftState();
}

// ==========================================
// PICK MANUAL
// ==========================================

async function handleDraftPick(interaction) {
  if (!draftActive || draftFinishing) {
    return interaction.reply({
      content: "Não existe um draft ativo.",
      ephemeral: true
    });
  }

  const round = getCurrentRound();

  if (!round) {
    return interaction.reply({
      content: "O draft já terminou.",
      ephemeral: true
    });
  }

  const currentCaptain =
    round.captain === "A" ? captainA : captainB;

  if (interaction.user.id !== currentCaptain.discordId) {
    return interaction.reply({
      content:
        `Agora é a vez de **${currentCaptain.nickname}** escolher.`,
      ephemeral: true
    });
  }

  if (Date.now() >= roundDeadline) {
    await interaction.reply({
      content: "O tempo desta rodada terminou.",
      ephemeral: true
    });

    await handleDraftTimeout();
    return;
  }

  if (interaction.values.length !== round.picks) {
    return interaction.reply({
      content:
        `Escolha exatamente ${round.picks} jogador(es).`,
      ephemeral: true
    });
  }

  const selectedIds = new Set(interaction.values);

  if (selectedIds.size !== round.picks) {
    return interaction.reply({
      content: "Existem jogadores duplicados.",
      ephemeral: true
    });
  }

  const selectedPlayers = interaction.values.map(
    (id) => availablePlayers.find(
      (player) => player.discordId === id
    )
  );

  if (selectedPlayers.some((player) => !player)) {
    return interaction.reply({
      content:
        "Um dos jogadores não está mais disponível.",
      ephemeral: true
    });
  }

  clearRoundTimer();
  applyPicks(selectedPlayers);

  if (currentRound >= draftRounds.length) {
    await interaction.deferUpdate();
    await finishDraft(interaction);
    return;
  }

  await interaction.update(createDraftPanel());
  scheduleRoundTimeout();
}

// ==========================================
// PICK AUTOMÁTICO
// ==========================================

async function handleDraftTimeout() {
  if (!draftActive || draftFinishing) {
    return;
  }

  const round = getCurrentRound();

  if (!round) {
    return;
  }

  if (Date.now() < roundDeadline) {
    scheduleRoundTimeout();
    return;
  }

  clearRoundTimer();

  // Escolha aleatória, sem repetição.
  const shuffled = [...availablePlayers];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [shuffled[i], shuffled[j]] = [
      shuffled[j], shuffled[i]
    ];
  }

  const selectedPlayers = shuffled.slice(
    0,
    round.picks
  );

  const captain =
    round.captain === "A" ? captainA : captainB;

  applyPicks(selectedPlayers);

  if (draftMessage) {
    try {
      await draftMessage.channel.send({
        content:
          `⏱️ O tempo de <@${captain.discordId}> terminou.\n` +
          `Escolha automática: **${selectedPlayers.map(
            (player) => player.nickname
          ).join(", ")}**.`
      });
    } catch (error) {
      console.error(
        "Erro ao anunciar pick automático:",
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
      await draftMessage.edit(
        createDraftPanel()
      );
    } catch (error) {
      console.error(
        "Erro ao atualizar draft:",
        error
      );
    }
  }

  scheduleRoundTimeout();
}

// ==========================================
// FINALIZAR DRAFT
// ==========================================

async function finishDraft(interaction = null) {
  if (!draftActive || draftFinishing) {
    return;
  }

  if (
    teamA.length !== config.matchmaking.teamSize ||
    teamB.length !== config.matchmaking.teamSize ||
    availablePlayers.length !== 0
  ) {
    throw new Error("INVALID_FINAL_DRAFT_TEAMS");
  }

  draftFinishing = true;
  clearRoundTimer();

  const result = {
    teamA: [...teamA],
    teamB: [...teamB]
  };

  const selectedCaptainA = captainA;
  const selectedCaptainB = captainB;

  const session = getSession();

  if (!session || session.id !== draftSessionId) {
    draftFinishing = false;
    throw new Error("DRAFT_SESSION_LOST");
  }

  db.prepare(`
    UPDATE matchmaking_sessions
    SET
      stage = 'map_veto',
      deadline_at = NULL,
      state_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify({
      draftCompleted: true,
      draft: result
    }),
    Date.now(),
    session.id
  );

  if (draftMessage) {
    try {
      await draftMessage.edit(
        createFinishedDraftPanel()
      );
    } catch (error) {
      console.error(
        "Erro ao finalizar painel do draft:",
        error
      );
    }
  }

  // O início do veto não depende de uma interação
  // ainda válida quando o draft termina por timeout.
  const context = interaction || {
    client: draftClient,
    followUp: async (payload) => {
      const channel = await draftClient.channels.fetch(
        config.discord.draftChannelId
      );

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

    resetDraft();
  } catch (error) {
    console.error(
      "Erro ao iniciar veto após draft:",
      error
    );

    throw error;
  }
}

// ==========================================
// PAINEL FINAL
// ==========================================

function createFinishedDraftPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Times definidos")
        .setDescription(
          "O draft foi concluído. Os dois times estão definidos."
        )
        .addFields(
          {
            name: `Time A — ${captainA.nickname}`,
            value: createPlayerList(teamA, captainA),
            inline: true
          },
          {
            name: `Time B — ${captainB.nickname}`,
            value: createPlayerList(teamB, captainB),
            inline: true
          }
        )
        .setFooter({
          text: "Veto de mapas iniciado"
        })
    ],
    components: []
  };
}

// ==========================================
// RECUPERAÇÃO
// ==========================================

async function restoreDraft(client) {
  const session = getSession();

  if (!session || session.stage !== "draft") {
    return false;
  }

  if (draftActive) {
    return true;
  }

  let state;

  try {
    state = JSON.parse(
      session.state_json || "{}"
    ).draft;
  } catch {
    state = null;
  }

  if (
    !state ||
    !state.captainA ||
    !state.captainB ||
    !Array.isArray(state.teamA) ||
    !Array.isArray(state.teamB) ||
    !Array.isArray(state.availablePlayers)
  ) {
    console.error(
      "Estado persistido do draft inválido."
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
    state.channelId || config.discord.draftChannelId;

  const channel = await client.channels.fetch(channelId);

  if (!channel?.isTextBased() || !channel.send) {
    throw new Error("INVALID_DRAFT_RESTORE_CHANNEL");
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

  if (!draftMessage) {
    draftMessage = await channel.send(
      createDraftPanel()
    );

    saveDraftState();
  } else {
    await draftMessage.edit(
      createDraftPanel()
    );
  }

  if (currentRound >= draftRounds.length) {
    console.warn(
      "Draft recuperado na transição final."
    );

    return true;
  }

  if (!roundDeadline) {
    console.warn(
      "Draft sem prazo persistido. Necessária recuperação administrativa."
    );

    return true;
  }

  if (Date.now() >= roundDeadline) {
    await handleDraftTimeout();
  } else {
    scheduleRoundTimeout();
  }

  console.log(
    `Draft recuperado na rodada ${currentRound + 1}.`
  );

  return true;
}

// ==========================================
// RESET
// ==========================================

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

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  startDraft,
  handleDraftPick,
  restoreDraft,

  resetDraft,
  isDraftActive,
  getTeams
};
