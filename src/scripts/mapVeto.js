
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const queueState = require("./queueState");
const { startSideChoice } = require("./side");

const {
  MAP_POOL,
  generateMapVetoImage
} = require("./mapVetoImage");

const BAN_TIMEOUT_SECONDS =
  config.matchmaking.mapVetoSeconds || 30;

const IMAGE_NAME = "map-veto.png";

let vetoActive = false;
let vetoFinishing = false;
let processingBan = false;

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
let vetoChannelId = null;

let banDeadline = null;
let banTimeout = null;

function getSession() {
  return queueState.getActiveSession();
}

function parseState(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function safeText(value) {
  return String(value || "—")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, 80);
}

function currentCaptainData() {
  return currentCaptain === "A"
    ? captainA
    : captainB;
}

function clearBanTimer() {
  if (banTimeout) {
    clearTimeout(banTimeout);
    banTimeout = null;
  }
}

function scheduleBanTimeout() {
  clearBanTimer();

  if (
    !vetoActive ||
    vetoFinishing ||
    !banDeadline
  ) {
    return;
  }

  banTimeout = setTimeout(() => {
    handleMapVetoTimeout().catch(error => {
      console.error(
        "[MAP VETO] Timeout:",
        error
      );
    });
  }, Math.max(0, banDeadline - Date.now()));
}

async function getVetoChannel() {
  if (!vetoClient) {
    throw new Error("MAP_VETO_CLIENT_UNAVAILABLE");
  }

  const channelId =
    vetoChannelId ||
    config.discord.mapVetoChannelId;

  const channel = await vetoClient.channels.fetch(
    channelId
  );

  if (!channel?.isTextBased() || !channel.send) {
    throw new Error("INVALID_MAP_VETO_CHANNEL");
  }

  return channel;
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

  const state = parseState(session.state_json);

  state.mapVeto = {
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
      vetoChannelId ||
      config.discord.mapVetoChannelId
  };

  db.prepare(`
    UPDATE matchmaking_sessions
    SET state_json = ?,
        deadline_at = ?,
        updated_at = ?
    WHERE id = ?
      AND stage = 'map_veto'
  `).run(
    JSON.stringify(state),
    banDeadline,
    Date.now(),
    session.id
  );
}

async function createMapImage() {
  const buffer = await generateMapVetoImage({
    bannedMaps,
    selectedMap
  });

  return new AttachmentBuilder(buffer, {
    name: IMAGE_NAME
  });
}

function addText(container, content) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content)
  );
}

function addSeparator(container) {
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true)
  );
}

function addMapImage(container) {
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${IMAGE_NAME}`)
        .setDescription("Mosaico de mapas")
    )
  );
}

async function createMapVetoPanel() {
  const captain = currentCaptainData();

  if (!captain) {
    throw new Error("INVALID_MAP_VETO_CAPTAIN");
  }

  const availableList = availableMaps.length
    ? availableMaps.map(map =>
        `🟢 ${safeText(map)}`
      ).join("\n")
    : "Nenhum mapa disponível.";

  const bannedList = bannedMaps.length
    ? bannedMaps.map((ban, index) =>
        `**${index + 1}.** ❌ ` +
        `${safeText(ban.map)} · Time ` +
        `${ban.captainTeam}` +
        (ban.automatic ? " *(automático)*" : "")
      ).join("\n")
    : "Nenhum mapa banido.";

  const deadline = banDeadline
    ? `<t:${Math.ceil(banDeadline / 1000)}:R>`
    : "Encerrado";

  const container = new ContainerBuilder()
    .setAccentColor(0xFF3D2C);

  addText(
    container,
    "## INVISIX PRO\n" +
    "### PICK & BAN · MELHOR DE 1\n" +
    "-# Rainbow Six Siege · Matchmaking competitivo"
  );

  addSeparator(container);

  addText(
    container,
    `**Rodada:** ${Math.min(
      bannedMaps.length + 1,
      MAP_POOL.length - 1
    )}/${MAP_POOL.length - 1}\n` +
    `**Vez de banir:** <@${captain.discordId}>\n` +
    `**Time:** ${currentCaptain}\n` +
    `**Tempo restante:** ${deadline}\n` +
    `**Mapas disponíveis:** ${availableMaps.length}`
  );

  addSeparator(container);

  addText(
    container,
    "### MAP POOL\n" +
    "-# Verde: disponível · Vermelho: banido"
  );

  addMapImage(container);
  addSeparator(container);

  addText(
    container,
    `### MAPAS DISPONÍVEIS\n${availableList}`
  );

  addSeparator(container);

  addText(
    container,
    `### HISTÓRICO DE BANIMENTOS\n${bannedList}`
  );

  addSeparator(container);

  addText(
    container,
    "-# Se o tempo terminar, um mapa será " +
    "banido automaticamente."
  );

  const components = [container];

  if (availableMaps.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("map_veto")
      .setPlaceholder("Selecione um mapa para banir")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        availableMaps.map(map => ({
          label: map,
          value: map
        }))
      );

    components.push(
      new ActionRowBuilder().addComponents(select)
    );
  }

  return {
    components,
    files: [await createMapImage()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

async function createFinishedMapVetoPanel() {
  const bannedList = bannedMaps.length
    ? bannedMaps.map((ban, index) =>
        `**${index + 1}.** ${safeText(ban.map)} · ` +
        `Time ${ban.captainTeam}` +
        (ban.automatic ? " *(automático)*" : "")
      ).join("\n")
    : "Nenhum.";

  const container = new ContainerBuilder()
    .setAccentColor(0x278451);

  addText(
    container,
    "## INVISIX PRO\n### MAPA DEFINIDO"
  );

  addSeparator(container);

  addText(
    container,
    `# ${safeText(selectedMap)}\n` +
    "🏆 **Mapa selecionado para a partida**"
  );

  addSeparator(container);

  addText(
    container,
    "### MAP POOL FINAL\n" +
    "-# O mapa escolhido está destacado em verde."
  );

  addMapImage(container);
  addSeparator(container);

  addText(
    container,
    `### HISTÓRICO DE VETOS\n${bannedList}`
  );

  addSeparator(container);

  addText(
    container,
    "-# Próxima etapa: escolha de lado."
  );

  return {
    components: [container],
    files: [await createMapImage()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

async function updateVetoMessage(finished = false) {
  const payload = finished
    ? await createFinishedMapVetoPanel()
    : await createMapVetoPanel();

  if (vetoMessage) {
    try {
      vetoMessage = await vetoMessage.edit({
        ...payload,
        attachments: []
      });

      return vetoMessage;
    } catch (error) {
      console.warn(
        "[MAP VETO] Não foi possível editar " +
        "o painel anterior:",
        error.message
      );
    }
  }

  const channel = await getVetoChannel();

  vetoMessage = await channel.send(payload);

  saveMapVetoState();

  return vetoMessage;
}

function validateTeams(teams, firstCaptain, secondCaptain) {
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

  const all = [...teams.teamA, ...teams.teamB];

  const ids = all.map(player => player.discordId);

  if (
    ids.length !== config.matchmaking.requiredPlayers ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("INVALID_MAP_VETO_PLAYERS");
  }

  if (
    !teams.teamA.some(
      p => p.discordId === firstCaptain.discordId
    ) ||
    !teams.teamB.some(
      p => p.discordId === secondCaptain.discordId
    )
  ) {
    throw new Error("MAP_VETO_CAPTAIN_NOT_IN_TEAM");
  }
}

async function startMapVeto(
  interaction,
  teams,
  firstCaptain,
  secondCaptain
) {
  if (vetoActive) {
    throw new Error("MAP_VETO_ALREADY_ACTIVE");
  }

  validateTeams(
    teams,
    firstCaptain,
    secondCaptain
  );

  const session = getSession();

  if (!session) {
    throw new Error("MAP_VETO_SESSION_NOT_FOUND");
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
  vetoChannelId = config.discord.mapVetoChannelId;

  vetoActive = true;
  vetoFinishing = false;
  processingBan = false;

  banDeadline =
    Date.now() + BAN_TIMEOUT_SECONDS * 1000;

  db.prepare(`
    UPDATE matchmaking_sessions
    SET stage = 'map_veto',
        updated_at = ?
    WHERE id = ?
  `).run(Date.now(), session.id);

  saveMapVetoState();

  try {
    await updateVetoMessage();
    scheduleBanTimeout();

    try {
      await interaction.followUp({
        content:
          `🗺️ Veto iniciado em ` +
          `<#${vetoChannelId}>.`
      });
    } catch (error) {
      console.warn(
        "[MAP VETO] Aviso não enviado:",
        error.message
      );
    }
  } catch (error) {
    console.error(
      "[MAP VETO] Falha ao publicar painel:",
      error
    );

    // Mantém o estado no banco para recuperação.
    resetMapVeto();

    throw error;
  }
}

function applyBan(map, automatic = false) {
  if (!availableMaps.includes(map)) {
    throw new Error("MAP_NOT_AVAILABLE");
  }

  const captain = currentCaptainData();

  bannedMaps.push({
    map,
    captain,
    captainTeam: currentCaptain,
    automatic
  });

  availableMaps = availableMaps.filter(
    item => item !== map
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

async function handleMapVeto(interaction) {
  if (!vetoActive || vetoFinishing) {
    return interaction.reply({
      content: "Não existe um veto de mapas ativo.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (processingBan) {
    return interaction.reply({
      content: "Um banimento já está sendo processado.",
      flags: MessageFlags.Ephemeral
    });
  }

  const captain = currentCaptainData();

  if (interaction.user.id !== captain?.discordId) {
    return interaction.reply({
      content:
        `Agora é a vez de **${safeText(
          captain?.nickname
        )}** banir.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (banDeadline && Date.now() >= banDeadline) {
    await interaction.reply({
      content: "O tempo para banir terminou.",
      flags: MessageFlags.Ephemeral
    });

    await handleMapVetoTimeout();
    return;
  }

  const map = interaction.values?.[0];

  if (!map || !availableMaps.includes(map)) {
    return interaction.reply({
      content: "Esse mapa não está disponível.",
      flags: MessageFlags.Ephemeral
    });
  }

  processingBan = true;

  try {
    clearBanTimer();

    await interaction.deferUpdate();

    applyBan(map);

    if (availableMaps.length === 1) {
      await finishMapVeto(interaction);
      return;
    }

    try {
      await updateVetoMessage();
    } catch (error) {
      console.error(
        "[MAP VETO] Erro ao atualizar painel:",
        error
      );
    }
  } finally {
    processingBan = false;

    if (
      vetoActive &&
      !vetoFinishing &&
      banDeadline
    ) {
      scheduleBanTimeout();
    }
  }
}

async function handleMapVetoTimeout() {
  if (!vetoActive || vetoFinishing) return;

  if (processingBan) return;

  if (banDeadline && Date.now() < banDeadline) {
    scheduleBanTimeout();
    return;
  }

  if (availableMaps.length <= 1) {
    return finishMapVeto();
  }

  processingBan = true;

  try {
    clearBanTimer();

    const captain = currentCaptainData();

    const randomIndex = Math.floor(
      Math.random() * availableMaps.length
    );

    const map = availableMaps[randomIndex];

    applyBan(map, true);

    try {
      const channel = await getVetoChannel();

      await channel.send({
        content:
          `⏱️ Tempo de <@${captain.discordId}> encerrado.\n` +
          `❌ Mapa banido automaticamente: **${map}**.`,
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      console.warn(
        "[MAP VETO] Aviso automático:",
        error.message
      );
    }

    if (availableMaps.length === 1) {
      await finishMapVeto();
      return;
    }

    try {
      await updateVetoMessage();
    } catch (error) {
      console.error(
        "[MAP VETO] Erro no mosaico automático:",
        error
      );
    }
  } finally {
    processingBan = false;

    if (
      vetoActive &&
      !vetoFinishing &&
      banDeadline
    ) {
      scheduleBanTimeout();
    }
  }
}

async function finishMapVeto(interaction = null) {
  if (!vetoActive || vetoFinishing) return;

  if (availableMaps.length !== 1) {
    throw new Error("INVALID_MAP_VETO_RESULT");
  }

  vetoFinishing = true;
  clearBanTimer();

  selectedMap = availableMaps[0];

  const session = getSession();

  if (!session || session.id !== vetoSessionId) {
    vetoFinishing = false;
    throw new Error("MAP_VETO_SESSION_LOST");
  }

  const vetoResult = {
    map: selectedMap,
    bannedMaps: [...bannedMaps],
    captainA,
    captainB,
    teamA: [...teamA],
    teamB: [...teamB]
  };

  const state = parseState(session.state_json);

  state.mapVetoCompleted = true;
  state.vetoResult = vetoResult;

  db.prepare(`
    UPDATE matchmaking_sessions
    SET stage = 'side_choice',
        deadline_at = NULL,
        state_json = ?,
        updated_at = ?
    WHERE id = ?
      AND stage = 'map_veto'
  `).run(
    JSON.stringify(state),
    Date.now(),
    session.id
  );

  try {
    await updateVetoMessage(true);
  } catch (error) {
    console.warn(
      "[MAP VETO] Painel final não atualizado:",
      error.message
    );
  }

  const context = {
    client: vetoClient,
    followUp: async payload => {
      const channel = await getVetoChannel();
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

    console.log(
      "[MAP VETO] Finalizado:",
      selectedMap
    );

    resetMapVeto();
  } catch (error) {
    vetoFinishing = false;

    console.error(
      "[MAP VETO] Erro ao iniciar escolha de lado:",
      error
    );

    // A etapa side_choice já foi persistida.
    // A recuperação dela ocorrerá após reiniciar.
    resetMapVeto();

    throw error;
  }
}

async function restoreMapVeto(client) {
  const session = getSession();

  if (!session || session.stage !== "map_veto") {
    return false;
  }

  if (vetoActive) return true;

  const state = parseState(session.state_json).mapVeto;

  if (
    !state ||
    !Array.isArray(state.teamA) ||
    !Array.isArray(state.teamB) ||
    !Array.isArray(state.availableMaps) ||
    !Array.isArray(state.bannedMaps)
  ) {
    console.error(
      "[MAP VETO] Estado persistido inválido."
    );

    return false;
  }

  captainA = state.captainA;
  captainB = state.captainB;

  teamA = [...state.teamA];
  teamB = [...state.teamB];

  availableMaps = [...state.availableMaps];
  bannedMaps = [...state.bannedMaps];

  currentCaptain = state.currentCaptain || "A";
  selectedMap = state.selectedMap || null;

  vetoSessionId = session.id;
  vetoClient = client;

  vetoChannelId =
    state.channelId ||
    config.discord.mapVetoChannelId;

  banDeadline = session.deadline_at
    ? Number(session.deadline_at)
    : null;

  vetoActive = true;
  vetoFinishing = false;
  processingBan = false;

  try {
    const channel = await getVetoChannel();

    vetoMessage = null;

    if (state.messageId && channel.messages) {
      try {
        vetoMessage = await channel.messages.fetch(
          state.messageId
        );
      } catch (error) {
        console.warn(
          "[MAP VETO] Mensagem antiga indisponível:",
          error.message
        );
      }
    }

    if (availableMaps.length === 1) {
      await finishMapVeto();
      return true;
    }

    // Evita restaurar um painel com prazo já
    // encerrado sem oferecer novo tempo ao capitão.
    if (!banDeadline || Date.now() >= banDeadline) {
      banDeadline =
        Date.now() + BAN_TIMEOUT_SECONDS * 1000;

      saveMapVetoState();

      console.log(
        "[MAP VETO] Prazo renovado na recuperação."
      );
    }

    await updateVetoMessage();

    scheduleBanTimeout();

    console.log(
      `[MAP VETO] Recuperado com ` +
      `${availableMaps.length} mapas disponíveis.`
    );

    return true;
  } catch (error) {
    console.error(
      "[MAP VETO] Falha na recuperação:",
      error
    );

    resetMapVeto();
    throw error;
  }
}

function resetMapVeto() {
  clearBanTimer();

  vetoActive = false;
  vetoFinishing = false;
  processingBan = false;

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
  vetoChannelId = null;

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
