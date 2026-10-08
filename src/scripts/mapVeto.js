
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const queueState = require("./queueState");

const {
  startSideChoice
} = require("./side");

// ==========================================
// MAP POOL
// ==========================================

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

const BAN_TIMEOUT_SECONDS =
  config.matchmaking?.mapBanSeconds || 30;

// ==========================================
// ESTADO
// ==========================================

let vetoActive = false;
let vetoFinishing = false;

let captainA = null;
let captainB = null;

let teamA = [];
let teamB = [];

let availableMaps = [];
let bannedMaps = [];

let currentCaptain = "A";
let selectedMap = null;

let vetoMessage = null;
let vetoClient = null;
let vetoSessionId = null;

let banDeadline = null;
let banTimeout = null;

// ==========================================
// UTILITÁRIOS
// ==========================================

function getSession() {
  return queueState.getActiveSession();
}

function clearBanTimer() {
  if (banTimeout) {
    clearTimeout(banTimeout);
    banTimeout = null;
  }
}

function scheduleBanTimeout() {
  clearBanTimer();

  if (!vetoActive || !banDeadline) {
    return;
  }

  const remaining = Math.max(
    0,
    banDeadline - Date.now()
  );

  banTimeout = setTimeout(() => {
    handleMapVetoTimeout().catch((error) => {
      console.error(
        "Erro no timeout do veto:",
        error
      );
    });
  }, remaining);
}

function saveMapVetoState() {
  const session = getSession();

  if (
    !session ||
    session.id !== vetoSessionId ||
    session.stage !== "map_veto"
  ) {
    return;
  }

  const state = {
    mapVeto: {
      captainA,
      captainB,
      teamA,
      teamB,
      availableMaps,
      bannedMaps,
      currentCaptain,
      selectedMap,
      messageId: vetoMessage?.id || null,
      channelId:
        vetoMessage?.channelId ||
        config.discord.mapVetoChannelId
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
    banDeadline,
    Date.now(),
    session.id
  );
}

// ==========================================
// INICIAR VETO
// ==========================================

async function startMapVeto(
  interaction,
  teams,
  firstCaptain,
  secondCaptain
) {
  if (vetoActive) {
    throw new Error("MAP_VETO_ALREADY_ACTIVE");
  }

  if (
    !Array.isArray(teams?.teamA) ||
    !Array.isArray(teams?.teamB) ||
    teams.teamA.length !== config.matchmaking.teamSize ||
    teams.teamB.length !== config.matchmaking.teamSize
  ) {
    throw new Error("INVALID_MAP_VETO_TEAMS");
  }

  if (
    !firstCaptain?.discordId ||
    !secondCaptain?.discordId ||
    firstCaptain.discordId === secondCaptain.discordId
  ) {
    throw new Error("INVALID_MAP_VETO_CAPTAINS");
  }

  const allPlayers = [
    ...teams.teamA,
    ...teams.teamB
  ];

  if (
    new Set(
      allPlayers.map((player) => player.discordId)
    ).size !== config.matchmaking.requiredPlayers
  ) {
    throw new Error("INVALID_MAP_VETO_PLAYERS");
  }

  if (
    !teams.teamA.some(
      (player) => player.discordId === firstCaptain.discordId
    ) ||
    !teams.teamB.some(
      (player) => player.discordId === secondCaptain.discordId
    )
  ) {
    throw new Error("MAP_VETO_CAPTAIN_NOT_IN_TEAM");
  }

  const session = getSession();

  if (!session) {
    throw new Error("MAP_VETO_SESSION_NOT_FOUND");
  }

  const channel = await interaction.client.channels.fetch(
    config.discord.mapVetoChannelId
  );

  if (!channel?.isTextBased() || !channel.send) {
    throw new Error("INVALID_MAP_VETO_CHANNEL");
  }

  captainA = firstCaptain;
  captainB = secondCaptain;

  teamA = [...teams.teamA];
  teamB = [...teams.teamB];

  availableMaps = [...MAP_POOL];
  bannedMaps = [];

  currentCaptain = "A";
  selectedMap = null;

  vetoSessionId = session.id;
  vetoClient = interaction.client;

  vetoActive = true;
  vetoFinishing = false;

  banDeadline =
    Date.now() + BAN_TIMEOUT_SECONDS * 1000;

  try {
    db.prepare(`
      UPDATE matchmaking_sessions
      SET
        stage = 'map_veto',
        updated_at = ?
      WHERE id = ?
    `).run(Date.now(), session.id);

    saveMapVetoState();

    vetoMessage = await channel.send(
      createMapVetoPanel()
    );

    saveMapVetoState();
    scheduleBanTimeout();

    try {
      await interaction.followUp({
        content:
          `🗺️ O veto de mapas foi iniciado em <#${channel.id}>.`
      });
    } catch (error) {
      console.warn(
        "Não foi possível anunciar canal do veto:",
        error.message
      );
    }
  } catch (error) {
    resetMapVeto();
    throw error;
  }
}

// ==========================================
// PAINEL
// ==========================================

function createMapVetoPanel() {
  if (!vetoActive) {
    throw new Error("MAP_VETO_NOT_ACTIVE");
  }

  const captain =
    currentCaptain === "A" ? captainA : captainB;

  if (!captain) {
    throw new Error("INVALID_CURRENT_MAP_VETO_CAPTAIN");
  }

  const bannedList = bannedMaps.length
    ? bannedMaps.map(
        (ban, index) =>
          `**${index + 1}.** ❌ ${ban.map} — ${ban.captain.nickname}` +
          (ban.automatic ? " *(automático)*" : "")
      ).join("\n")
    : "Nenhum mapa banido.";

  const availableList = availableMaps.length
    ? availableMaps.map(
        (map) => `• ${map}`
      ).join("\n")
    : "Nenhum mapa disponível.";

  const deadline = banDeadline
    ? `<t:${Math.ceil(banDeadline / 1000)}:R>`
    : `${BAN_TIMEOUT_SECONDS}s`;

  const embed = new EmbedBuilder()
    .setTitle("Veto de mapas")
    .setDescription(
      `É a vez de <@${captain.discordId}> banir um mapa.\n\n` +
      `⏱️ Tempo restante: **${deadline}**.\n` +
      "Se o tempo acabar, um mapa será banido automaticamente."
    )
    .addFields(
      {
        name: "Mapas disponíveis",
        value: availableList,
        inline: false
      },
      {
        name: "Banimentos",
        value: bannedList,
        inline: false
      }
    )
    .setFooter({
      text:
        `${availableMaps.length} mapas restantes • Capitão ${currentCaptain}`
    });

  if (availableMaps.length <= 1) {
    return {
      embeds: [embed],
      components: []
    };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("map_veto")
    .setPlaceholder("Escolha um mapa para banir")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      availableMaps.map((map) => ({
        label: map,
        value: map
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
// APLICAR BAN
// ==========================================

function applyBan(map, automatic = false) {
  if (!availableMaps.includes(map)) {
    throw new Error("MAP_NOT_AVAILABLE");
  }

  const captain =
    currentCaptain === "A" ? captainA : captainB;

  bannedMaps.push({
    map,
    captain,
    captainTeam: currentCaptain,
    automatic
  });

  availableMaps = availableMaps.filter(
    (item) => item !== map
  );

  if (availableMaps.length === 1) {
    selectedMap = availableMaps[0];
    banDeadline = null;
  } else {
    currentCaptain =
      currentCaptain === "A" ? "B" : "A";

    banDeadline =
      Date.now() + BAN_TIMEOUT_SECONDS * 1000;
  }

  saveMapVetoState();
}

// ==========================================
// BAN MANUAL
// ==========================================

async function handleMapVeto(interaction) {
  if (!vetoActive || vetoFinishing) {
    return interaction.reply({
      content: "Não existe um veto de mapas ativo.",
      ephemeral: true
    });
  }

  const captain =
    currentCaptain === "A" ? captainA : captainB;

  if (interaction.user.id !== captain.discordId) {
    return interaction.reply({
      content:
        `Agora é a vez de **${captain.nickname}** banir um mapa.`,
      ephemeral: true
    });
  }

  if (Date.now() >= banDeadline) {
    await interaction.reply({
      content: "O tempo para banir terminou.",
      ephemeral: true
    });

    await handleMapVetoTimeout();
    return;
  }

  const selected = interaction.values[0];

  if (!selected || !availableMaps.includes(selected)) {
    return interaction.reply({
      content: "Esse mapa não está mais disponível.",
      ephemeral: true
    });
  }

  clearBanTimer();
  applyBan(selected);

  if (availableMaps.length === 1) {
    await interaction.deferUpdate();
    await finishMapVeto(interaction);
    return;
  }

  await interaction.update(
    createMapVetoPanel()
  );

  scheduleBanTimeout();
}

// ==========================================
// BAN AUTOMÁTICO
// ==========================================

async function handleMapVetoTimeout() {
  if (!vetoActive || vetoFinishing) {
    return;
  }

  if (Date.now() < banDeadline) {
    scheduleBanTimeout();
    return;
  }

  if (availableMaps.length <= 1) {
    return finishMapVeto();
  }

  clearBanTimer();

  const captain =
    currentCaptain === "A" ? captainA : captainB;

  const randomIndex = Math.floor(
    Math.random() * availableMaps.length
  );

  const selected = availableMaps[randomIndex];

  applyBan(selected, true);

  if (vetoMessage) {
    try {
      await vetoMessage.channel.send({
        content:
          `⏱️ O tempo de <@${captain.discordId}> terminou.\n` +
          `❌ Mapa banido automaticamente: **${selected}**.`
      });
    } catch (error) {
      console.error(
        "Erro ao anunciar ban automático:",
        error
      );
    }
  }

  if (availableMaps.length === 1) {
    await finishMapVeto();
    return;
  }

  if (vetoMessage) {
    try {
      await vetoMessage.edit(
        createMapVetoPanel()
      );
    } catch (error) {
      console.error(
        "Erro ao atualizar painel de veto:",
        error
      );
    }
  }

  scheduleBanTimeout();
}

// ==========================================
// FINALIZAR VETO
// ==========================================

async function finishMapVeto(interaction = null) {
  if (!vetoActive || vetoFinishing) {
    return;
  }

  if (availableMaps.length !== 1) {
    throw new Error("INVALID_MAP_VETO_RESULT");
  }

  vetoFinishing = true;
  clearBanTimer();

  selectedMap = availableMaps[0];

  const vetoResult = {
    map: selectedMap,
    bannedMaps: [...bannedMaps],
    captainA,
    captainB,
    teamA: [...teamA],
    teamB: [...teamB]
  };

  const session = getSession();

  if (!session || session.id !== vetoSessionId) {
    vetoFinishing = false;
    throw new Error("MAP_VETO_SESSION_LOST");
  }

  db.prepare(`
    UPDATE matchmaking_sessions
    SET
      stage = 'side_choice',
      deadline_at = NULL,
      state_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify({
      mapVetoCompleted: true,
      vetoResult
    }),
    Date.now(),
    session.id
  );

  const bannedList = bannedMaps.map(
    (ban, index) =>
      `**${index + 1}.** ❌ ${ban.map} — ${ban.captain.nickname}` +
      (ban.automatic ? " *(automático)*" : "")
  ).join("\n");

  const finalPanel = {
    embeds: [
      new EmbedBuilder()
        .setTitle("Mapa definido")
        .setDescription(
          `A partida será disputada em **${selectedMap}**.`
        )
        .addFields(
          {
            name: "Mapa escolhido",
            value: `🗺️ **${selectedMap}**`,
            inline: false
          },
          {
            name: "Vetos",
            value: bannedList || "Nenhum.",
            inline: false
          }
        )
        .setFooter({
          text: "Escolha de lado iniciada"
        })
    ],
    components: []
  };

  if (vetoMessage) {
    try {
      await vetoMessage.edit(finalPanel);
    } catch (error) {
      console.error(
        "Erro ao finalizar painel de veto:",
        error
      );
    }
  }

  const context = interaction || {
    client: vetoClient,
    followUp: async (payload) => {
      const channel = await vetoClient.channels.fetch(
        config.discord.mapVetoChannelId
      );

      return channel.send(payload);
    }
  };

  try {
    await startSideChoice(context, {
      map: vetoResult.map,
      captainA: vetoResult.captainA,
      captainB: vetoResult.captainB,
      teamA: [...vetoResult.teamA],
      teamB: [...vetoResult.teamB]
    });

    resetMapVeto();
  } catch (error) {
    console.error(
      "Erro ao iniciar escolha de lado:",
      error
    );

    throw error;
  }
}

// ==========================================
// RECUPERAÇÃO
// ==========================================

async function restoreMapVeto(client) {
  const session = getSession();

  if (!session || session.stage !== "map_veto") {
    return false;
  }

  if (vetoActive) {
    return true;
  }

  let state;

  try {
    state = JSON.parse(
      session.state_json || "{}"
    ).mapVeto;
  } catch {
    state = null;
  }

  if (
    !state ||
    !Array.isArray(state.teamA) ||
    !Array.isArray(state.teamB) ||
    !Array.isArray(state.availableMaps) ||
    !Array.isArray(state.bannedMaps)
  ) {
    console.error(
      "Estado persistido do veto inválido."
    );

    return false;
  }

  captainA = state.captainA;
  captainB = state.captainB;

  teamA = state.teamA;
  teamB = state.teamB;

  availableMaps = state.availableMaps;
  bannedMaps = state.bannedMaps;

  currentCaptain = state.currentCaptain || "A";
  selectedMap = state.selectedMap || null;

  vetoSessionId = session.id;
  vetoClient = client;
  banDeadline = session.deadline_at;

  vetoActive = true;
  vetoFinishing = false;

  const channelId =
    state.channelId || config.discord.mapVetoChannelId;

  const channel = await client.channels.fetch(channelId);

  if (!channel?.isTextBased() || !channel.send) {
    throw new Error("INVALID_MAP_VETO_RESTORE_CHANNEL");
  }

  if (state.messageId && channel.messages) {
    try {
      vetoMessage = await channel.messages.fetch(
        state.messageId
      );
    } catch {
      vetoMessage = null;
    }
  }

  if (!vetoMessage) {
    vetoMessage = await channel.send(
      createMapVetoPanel()
    );

    saveMapVetoState();
  } else {
    await vetoMessage.edit(
      createMapVetoPanel()
    );
  }

  if (availableMaps.length === 1) {
    console.warn(
      "Veto recuperado na transição final."
    );

    return true;
  }

  if (!banDeadline) {
    console.warn(
      "Veto sem prazo persistido. Necessária recuperação administrativa."
    );

    return true;
  }

  if (Date.now() >= banDeadline) {
    await handleMapVetoTimeout();
  } else {
    scheduleBanTimeout();
  }

  console.log(
    `Veto recuperado com ${availableMaps.length} mapas disponíveis.`
  );

  return true;
}

// ==========================================
// RESET
// ==========================================

function resetMapVeto() {
  clearBanTimer();

  vetoActive = false;
  vetoFinishing = false;

  captainA = null;
  captainB = null;

  teamA = [];
  teamB = [];

  availableMaps = [];
  bannedMaps = [];

  currentCaptain = "A";
  selectedMap = null;

  vetoMessage = null;
  vetoClient = null;
  vetoSessionId = null;
  banDeadline = null;
}

function isMapVetoActive() {
  return vetoActive;
}

function getSelectedMap() {
  return selectedMap;
}

function getVetoData() {
  return {
    map: selectedMap,
    bannedMaps: [...bannedMaps],
    captainA,
    captainB,
    teamA: [...teamA],
    teamB: [...teamB]
  };
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  MAP_POOL,

  startMapVeto,
  handleMapVeto,
  restoreMapVeto,

  resetMapVeto,
  isMapVetoActive,

  getSelectedMap,
  getVetoData
};
