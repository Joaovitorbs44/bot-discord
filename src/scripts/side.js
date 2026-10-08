
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const { createMatch } = require("./match");
const queueState = require("./queueState");

// ==========================================
// IDENTIDADE VISUAL
// ==========================================

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451
};

// ==========================================
// ESTADO
// ==========================================

let sideChoiceActive = false;
let sideChoiceFinishing = false;

let captainA = null;
let captainB = null;

let teamA = [];
let teamB = [];

let selectedMap = null;

let sideA = null;
let sideB = null;

let sideMessage = null;
let sideClient = null;
let sideSessionId = null;

// ==========================================
// UTILITÁRIOS
// ==========================================

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

function validateMatchData(data) {
  if (
    !data ||
    !data.map ||
    !data.captainA?.discordId ||
    !data.captainB?.discordId ||
    !Array.isArray(data.teamA) ||
    !Array.isArray(data.teamB)
  ) {
    throw new Error("INVALID_SIDE_CHOICE_DATA");
  }

  if (
    data.captainA.discordId ===
    data.captainB.discordId
  ) {
    throw new Error(
      "SIDE_CHOICE_CAPTAINS_MUST_BE_DIFFERENT"
    );
  }

  if (
    data.teamA.length !==
      config.matchmaking.teamSize ||
    data.teamB.length !==
      config.matchmaking.teamSize
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_TEAM_SIZE"
    );
  }

  const ids = [
    ...data.teamA,
    ...data.teamB
  ].map(player => player.discordId);

  if (
    ids.length !==
      config.matchmaking.requiredPlayers ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_PLAYERS"
    );
  }

  if (
    !data.teamA.some(
      p => p.discordId === data.captainA.discordId
    ) ||
    !data.teamB.some(
      p => p.discordId === data.captainB.discordId
    )
  ) {
    throw new Error(
      "SIDE_CHOICE_CAPTAIN_NOT_IN_TEAM"
    );
  }
}

function getMatchSetup() {
  return {
    map: selectedMap,
    captainA,
    captainB,
    sideA,
    sideB,
    teamA: [...teamA],
    teamB: [...teamB]
  };
}

// ==========================================
// PERSISTÊNCIA
// ==========================================

function saveSideState() {
  const session = getSession();

  if (
    !session ||
    session.id !== sideSessionId ||
    session.stage !== "side_choice"
  ) {
    return;
  }

  const state = parseState(
    session.state_json
  );

  state.sideChoice = {
    map: selectedMap,
    captainA,
    captainB,
    teamA,
    teamB,
    sideA,
    sideB,
    messageId: sideMessage?.id || null,
    channelId: sideMessage?.channelId || null
  };

  db.prepare(`
    UPDATE matchmaking_sessions
    SET state_json = ?,
        updated_at = ?
    WHERE id = ? AND stage = 'side_choice'
  `).run(
    JSON.stringify(state),
    Date.now(),
    sideSessionId
  );
}

// ==========================================
// LISTA DE JOGADORES
// ==========================================

function createTeamList(players, captain) {
  if (!players?.length) {
    return "—";
  }

  return players.map(player => {
    const isCaptain =
      player.discordId === captain.discordId;

    return (
      `${isCaptain ? "👑" : "•"} ` +
      `<@${player.discordId}> · ` +
      `${safeText(player.nickname)}`
    );
  }).join("\n");
}

// ==========================================
// PAINEL DE ESCOLHA
// ==========================================

function createSideChoicePanel() {
  if (
    !captainA ||
    !captainB ||
    !selectedMap
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_STATE"
    );
  }

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.primary)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVISIXTATIONAL\n" +
        "### ESCOLHA DE LADO · 5V5"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Mapa:** ${safeText(selectedMap)}\n` +
        `**Quem escolhe:** <@${captainA.discordId}>\n\n` +
        "O capitão do Time A define o lado inicial."
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### 🔴 Time A\n" +
        createTeamList(teamA, captainA)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### 🔵 Time B\n" +
        createTeamList(teamB, captainB)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# O Time B receberá automaticamente o lado oposto."
      )
    );

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("side_attack")
        .setLabel("Ataque")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("side_defense")
        .setLabel("Defesa")
        .setEmoji("🛡️")
        .setStyle(ButtonStyle.Primary)
    );

  return {
    content: null,
    embeds: [],
    components: [
      container,
      buttons
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

// ==========================================
// PAINEL CONCLUÍDO
// ==========================================

function createCompletedPanel() {
  const container = new ContainerBuilder()
    .setAccentColor(COLORS.success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVISIXTATIONAL\n" +
        "### CONFIGURAÇÃO CONCLUÍDA"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Mapa:** ${safeText(selectedMap)}\n` +
        "**Status:** Criando partida..."
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🔴 Time A · ${safeText(sideA)}\n` +
        createTeamList(teamA, captainA)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🔵 Time B · ${safeText(sideB)}\n` +
        createTeamList(teamB, captainB)
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

// ==========================================
// INICIAR ESCOLHA DE LADO
// ==========================================

async function startSideChoice(
  interaction,
  matchData
) {
  if (sideChoiceActive) {
    throw new Error(
      "SIDE_CHOICE_ALREADY_ACTIVE"
    );
  }

  validateMatchData(matchData);

  const session = getSession();

  if (!session) {
    throw new Error(
      "SIDE_CHOICE_SESSION_NOT_FOUND"
    );
  }

  captainA = matchData.captainA;
  captainB = matchData.captainB;

  teamA = [...matchData.teamA];
  teamB = [...matchData.teamB];

  selectedMap = matchData.map;

  sideA = null;
  sideB = null;

  sideClient = interaction.client;
  sideSessionId = session.id;

  sideChoiceActive = true;
  sideChoiceFinishing = false;

  db.prepare(`
    UPDATE matchmaking_sessions
    SET stage = 'side_choice',
        deadline_at = NULL,
        state_json = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify({
      sideChoice: {
        map: selectedMap,
        captainA,
        captainB,
        teamA,
        teamB,
        sideA: null,
        sideB: null,
        messageId: null,
        channelId: null
      }
    }),
    Date.now(),
    sideSessionId
  );

  queueState.lockQueue();

  try {
    sideMessage =
      await interaction.followUp({
        ...createSideChoicePanel(),
        fetchReply: true
      });

    saveSideState();
  } catch (error) {
    resetSideChoice();
    throw error;
  }
}

// ==========================================
// PROCESSAR ESCOLHA
// ==========================================

async function handleSideChoice(interaction) {
  const session = getSession();

  if (
    !sideChoiceActive ||
    sideChoiceFinishing ||
    !session ||
    session.id !== sideSessionId ||
    session.stage !== "side_choice"
  ) {
    return interaction.reply({
      content:
        "Não existe uma escolha de lado ativa.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (
    interaction.user.id !==
    captainA.discordId
  ) {
    return interaction.reply({
      content:
        `Somente **${safeText(captainA.nickname)}** pode escolher o lado inicial.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (
    interaction.customId ===
    "side_attack"
  ) {
    sideA = "Ataque";
    sideB = "Defesa";
  } else if (
    interaction.customId ===
    "side_defense"
  ) {
    sideA = "Defesa";
    sideB = "Ataque";
  } else {
    return interaction.reply({
      content:
        "Escolha de lado inválida.",
      flags: MessageFlags.Ephemeral
    });
  }

  saveSideState();

  await finishSideChoice(interaction);
}

// ==========================================
// FINALIZAR E CRIAR PARTIDA
// ==========================================

async function finishSideChoice(
  interaction = null
) {
  if (
    !sideChoiceActive ||
    sideChoiceFinishing
  ) {
    return;
  }

  if (!sideA || !sideB) {
    throw new Error("SIDE_NOT_SELECTED");
  }

  sideChoiceFinishing = true;

  const matchData = getMatchSetup();

  try {
    if (interaction) {
      await interaction.update(
        createCompletedPanel()
      );
    } else if (sideMessage) {
      await sideMessage.edit(
        createCompletedPanel()
      );
    }

    const context = interaction || {
      client: sideClient,
      followUp: async payload => {
        if (!sideMessage?.channel) {
          throw new Error(
            "SIDE_CHOICE_CHANNEL_UNAVAILABLE"
          );
        }

        return sideMessage.channel.send(
          payload
        );
      }
    };

    await createMatch(
      context,
      matchData
    );

    const session = getSession();

    if (
      session &&
      session.id === sideSessionId
    ) {
      db.prepare(`
        UPDATE matchmaking_sessions
        SET stage = 'playing',
            deadline_at = NULL,
            updated_at = ?
        WHERE id = ?
          AND stage = 'side_choice'
      `).run(
        Date.now(),
        sideSessionId
      );
    }

    resetSideChoice();
  } catch (error) {
    sideChoiceFinishing = false;

    console.error(
      "Erro ao finalizar escolha de lado:",
      error
    );

    throw error;
  }
}

// ==========================================
// RESTAURAR ESCOLHA DE LADO
// ==========================================

async function restoreSideChoice(client) {
  const session = getSession();

  if (
    !session ||
    session.stage !== "side_choice"
  ) {
    return false;
  }

  if (sideChoiceActive) {
    return true;
  }

  const state = parseState(
    session.state_json
  );

  const saved = state.sideChoice;

  if (!saved) {
    console.error(
      "Não há dados persistidos da escolha de lado."
    );

    return false;
  }

  validateMatchData(saved);

  captainA = saved.captainA;
  captainB = saved.captainB;

  teamA = [...saved.teamA];
  teamB = [...saved.teamB];

  selectedMap = saved.map;

  sideA = saved.sideA || null;
  sideB = saved.sideB || null;

  sideSessionId = session.id;
  sideClient = client;

  sideChoiceActive = true;
  sideChoiceFinishing = false;

  const channel =
    await client.channels.fetch(
      saved.channelId ||
      config.discord.mapVetoChannelId ||
      config.discord.queueChannelId
    );

  if (!channel?.send) {
    resetSideChoice();
    throw new Error(
      "SIDE_CHOICE_CHANNEL_NOT_FOUND"
    );
  }

  if (
    saved.messageId &&
    channel.messages
  ) {
    try {
      sideMessage =
        await channel.messages.fetch(
          saved.messageId
        );
    } catch {
      sideMessage = null;
    }
  }

  if (!sideMessage) {
    sideMessage =
      await channel.send(
        sideA && sideB
          ? createCompletedPanel()
          : createSideChoicePanel()
      );

    saveSideState();
  } else {
    await sideMessage.edit(
      sideA && sideB
        ? createCompletedPanel()
        : createSideChoicePanel()
    );
  }

  if (sideA && sideB) {
    await finishSideChoice();
  }

  console.log(
    "Escolha de lado restaurada."
  );

  return true;
}

// ==========================================
// RESET
// ==========================================

function resetSideChoice() {
  sideChoiceActive = false;
  sideChoiceFinishing = false;

  captainA = null;
  captainB = null;

  teamA = [];
  teamB = [];

  selectedMap = null;

  sideA = null;
  sideB = null;

  sideMessage = null;
  sideClient = null;
  sideSessionId = null;
}

function isSideChoiceActive() {
  return sideChoiceActive;
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  startSideChoice,
  handleSideChoice,
  finishSideChoice,
  restoreSideChoice,
  resetSideChoice,
  isSideChoiceActive,
  getMatchSetup
};
