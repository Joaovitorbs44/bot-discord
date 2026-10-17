
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
let sideChannelId = null;

// ==========================================
// UTILITÁRIOS
// ==========================================

function getSession() {
  return queueState.getActiveSession();
}

function parseState(raw) {
  try {
    const state = JSON.parse(raw || "{}");

    return state &&
      typeof state === "object" &&
      !Array.isArray(state)
      ? state
      : {};
  } catch {
    return {};
  }
}

function safeText(value, maxLength = 80) {
  return String(value || "—")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, maxLength);
}

function validateMatchData(data) {
  if (
    !data ||
    typeof data.map !== "string" ||
    !data.map.trim() ||
    !data.captainA?.discordId ||
    !data.captainB?.discordId ||
    !Array.isArray(data.teamA) ||
    !Array.isArray(data.teamB)
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_DATA"
    );
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

  const allPlayers = [
    ...data.teamA,
    ...data.teamB
  ];

  const ids = allPlayers.map(
    player => player?.discordId
  );

  if (
    ids.some(id => !id) ||
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
      player =>
        player.discordId ===
        data.captainA.discordId
    ) ||
    !data.teamB.some(
      player =>
        player.discordId ===
        data.captainB.discordId
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

async function getSideChannel() {
  if (!sideClient) {
    throw new Error(
      "SIDE_CHOICE_CLIENT_UNAVAILABLE"
    );
  }

  const channelId =
    sideChannelId ||
    config.discord.mapVetoChannelId;

  if (!channelId) {
    throw new Error(
      "SIDE_CHOICE_CHANNEL_NOT_CONFIGURED"
    );
  }

  const channel =
    await sideClient.channels.fetch(channelId);

  if (
    !channel?.isTextBased() ||
    typeof channel.send !== "function"
  ) {
    throw new Error(
      "INVALID_SIDE_CHOICE_CHANNEL"
    );
  }

  return channel;
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
    return false;
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
    channelId:
      sideMessage?.channelId ||
      sideChannelId ||
      config.discord.mapVetoChannelId
  };

  const result = db.prepare(`
    UPDATE matchmaking_sessions
    SET
      state_json = ?,
      updated_at = ?
    WHERE id = ?
      AND status = 'active'
      AND stage = 'side_choice'
  `).run(
    JSON.stringify(state),
    Date.now(),
    sideSessionId
  );

  return result.changes === 1;
}

// ==========================================
// JOGADORES
// ==========================================

function createTeamList(players, captain) {
  if (!players?.length) {
    return "Nenhum jogador.";
  }

  return players.map(player => {
    const isCaptain =
      player.discordId === captain.discordId;

    return (
      `${isCaptain ? "👑" : "•"} ` +
      `<@${player.discordId}> · ` +
      safeText(
        player.nickname ||
        player.discordId
      )
    );
  }).join("\n");
}

// ==========================================
// PAINEL DE ESCOLHA DE LADO
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
        "## INVISIX PRO\n" +
        "### ESCOLHA DE LADO · 5V5"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(
          SeparatorSpacingSize.Small
        )
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
        .setSpacing(
          SeparatorSpacingSize.Small
        )
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### 🔴 TIME A\n" +
        createTeamList(teamA, captainA)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(
          SeparatorSpacingSize.Small
        )
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### 🔵 TIME B\n" +
        createTeamList(teamB, captainB)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(
          SeparatorSpacingSize.Small
        )
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# O Time B receberá automaticamente " +
        "o lado oposto."
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
    components: [
      container,
      buttons
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: []
    }
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
        "## INVISIX PRO\n" +
        "### CONFIGURAÇÃO CONCLUÍDA"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(
          SeparatorSpacingSize.Small
        )
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
        .setSpacing(
          SeparatorSpacingSize.Small
        )
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🔴 TIME A · ${safeText(sideA)}\n` +
        createTeamList(teamA, captainA)
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(
          SeparatorSpacingSize.Small
        )
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🔵 TIME B · ${safeText(sideB)}\n` +
        createTeamList(teamB, captainB)
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: []
    }
  };
}

// ==========================================
// PUBLICAÇÃO DO PAINEL
// ==========================================

async function publishSidePanel(
  completed = false
) {
  const payload = completed
    ? createCompletedPanel()
    : createSideChoicePanel();

  if (sideMessage) {
    try {
      sideMessage =
        await sideMessage.edit(payload);

      return sideMessage;
    } catch (error) {
      console.warn(
        "[SIDE] Não foi possível editar " +
        "a mensagem anterior:",
        error.message
      );

      sideMessage = null;
    }
  }

  const channel = await getSideChannel();

  sideMessage = await channel.send(payload);

  saveSideState();

  return sideMessage;
}

// ==========================================
// CARREGAR ESTADO
// ==========================================

function loadSideState(saved, session, client) {
  validateMatchData(saved);

  captainA = saved.captainA;
  captainB = saved.captainB;

  teamA = [...saved.teamA];
  teamB = [...saved.teamB];

  selectedMap = saved.map;

  sideA = saved.sideA || null;
  sideB = saved.sideB || null;

  sideClient = client;
  sideSessionId = session.id;

  sideChannelId =
    saved.channelId ||
    config.discord.mapVetoChannelId;

  sideMessage = null;

  sideChoiceActive = true;
  sideChoiceFinishing = false;
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

  if (
    !session ||
    session.status !== "active" ||
    ![
      "map_veto",
      "side_choice"
    ].includes(session.stage)
  ) {
    throw new Error(
      "SIDE_CHOICE_SESSION_NOT_READY"
    );
  }

  if (!interaction?.client) {
    throw new Error(
      "SIDE_CHOICE_CLIENT_UNAVAILABLE"
    );
  }

  // Se a etapa ainda for map_veto,
  // a transição é persistida antes
  // de publicar o painel.
  if (session.stage === "map_veto") {
    const state = parseState(
      session.state_json
    );

    state.mapVetoCompleted = true;

    state.vetoResult = {
      map: matchData.map,
      captainA: matchData.captainA,
      captainB: matchData.captainB,
      teamA: matchData.teamA,
      teamB: matchData.teamB
    };

    const updated = db.prepare(`
      UPDATE matchmaking_sessions
      SET
        stage = 'side_choice',
        deadline_at = NULL,
        state_json = ?,
        updated_at = ?
      WHERE id = ?
        AND status = 'active'
        AND stage = 'map_veto'
    `).run(
      JSON.stringify(state),
      Date.now(),
      session.id
    );

    if (updated.changes !== 1) {
      throw new Error(
        "SIDE_CHOICE_TRANSITION_FAILED"
      );
    }
  }

  loadSideState(
    {
      ...matchData,
      sideA: null,
      sideB: null,
      channelId:
        config.discord.mapVetoChannelId
    },
    session,
    interaction.client
  );

  saveSideState();

  queueState.lockQueue();

  try {
    await publishSidePanel();

    console.log(
      "[SIDE] Escolha de lado publicada."
    );

    return true;
  } catch (error) {
    console.error(
      "[SIDE] Falha ao publicar escolha de lado:",
      error
    );

    // Não apaga a sessão persistida.
    resetSideChoice();

    throw error;
  }
}

// ==========================================
// PROCESSAR BOTÕES
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
        `Somente **${safeText(
          captainA.nickname
        )}** pode escolher o lado inicial.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (sideA || sideB) {
    return interaction.reply({
      content:
        "O lado inicial já foi escolhido.",
      flags: MessageFlags.Ephemeral
    });
  }

  let chosenA;
  let chosenB;

  if (
    interaction.customId === "side_attack"
  ) {
    chosenA = "Ataque";
    chosenB = "Defesa";
  } else if (
    interaction.customId === "side_defense"
  ) {
    chosenA = "Defesa";
    chosenB = "Ataque";
  } else {
    return interaction.reply({
      content:
        "Escolha de lado inválida.",
      flags: MessageFlags.Ephemeral
    });
  }

  // Confirma rapidamente o clique.
  await interaction.deferUpdate();

  sideA = chosenA;
  sideB = chosenB;

  const saved = saveSideState();

  if (!saved) {
    sideA = null;
    sideB = null;

    throw new Error(
      "SIDE_CHOICE_SAVE_FAILED"
    );
  }

  console.log(
    `[SIDE] Capitão ${captainA.discordId} ` +
    `escolheu ${sideA}.`
  );

  await finishSideChoice(interaction);
}

// ==========================================
// FINALIZAR ESCOLHA E CRIAR PARTIDA
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
    throw new Error(
      "SIDE_NOT_SELECTED"
    );
  }

  const session = getSession();

  if (
    !session ||
    session.id !== sideSessionId ||
    session.stage !== "side_choice"
  ) {
    throw new Error(
      "SIDE_CHOICE_SESSION_LOST"
    );
  }

  sideChoiceFinishing = true;

  const matchData = getMatchSetup();

  try {
    // A falha ao editar o painel não pode
    // impedir a criação da partida.
    try {
      await publishSidePanel(true);
    } catch (error) {
      console.warn(
        "[SIDE] Não foi possível atualizar " +
        "o painel concluído:",
        error.message
      );
    }

    // Não depende de interaction.followUp()
    // de uma interação antiga.
    const context = {
      client: sideClient,

      followUp: async payload => {
        const channel =
          await getSideChannel();

        return channel.send(payload);
      }
    };

    const created = await createMatch(
      context,
      matchData
    );

    console.log(
      `[SIDE] Partida registrada: ` +
      `${created.matchCode}`
    );

    // createMatch já encerra a sessão
    // de matchmaking no SQLite.
    resetSideChoice();

    return created;
  } catch (error) {
    sideChoiceFinishing = false;

    console.error(
      "[SIDE] Erro ao finalizar " +
      "a escolha de lado:",
      error
    );

    // Se a partida foi gravada, mas a
    // publicação falhou, createMatch()
    // poderá ter lançado erro após
    // persistir os dados.
    //
    // Não tentamos criar outra partida
    // automaticamente aqui.
    throw error;
  }
}

// ==========================================
// RECONSTRUIR ESTADO ANTIGO
// ==========================================

function recoverSavedState(session) {
  const state = parseState(
    session.state_json
  );

  if (state.sideChoice) {
    return state.sideChoice;
  }

  // Compatibilidade com sessões em que
  // mapVeto.js mudou para side_choice,
  // mas o painel ainda não foi publicado.
  const vetoResult = state.vetoResult;

  if (
    !vetoResult ||
    !vetoResult.map ||
    !vetoResult.captainA ||
    !vetoResult.captainB ||
    !Array.isArray(vetoResult.teamA) ||
    !Array.isArray(vetoResult.teamB)
  ) {
    return null;
  }

  console.warn(
    "[SIDE] Recuperando escolha de lado " +
    "a partir de vetoResult."
  );

  return {
    map: vetoResult.map,
    captainA: vetoResult.captainA,
    captainB: vetoResult.captainB,
    teamA: vetoResult.teamA,
    teamB: vetoResult.teamB,
    sideA: null,
    sideB: null,
    messageId: null,
    channelId:
      config.discord.mapVetoChannelId
  };
}

// ==========================================
// RESTAURAR APÓS REINICIALIZAÇÃO
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

  const saved = recoverSavedState(
    session
  );

  if (!saved) {
    console.error(
      "[SIDE] Não foi possível recuperar " +
      "os dados da escolha de lado."
    );

    return false;
  }

  loadSideState(
    saved,
    session,
    client
  );

  try {
    const channel = await getSideChannel();

    if (
      saved.messageId &&
      channel.messages
    ) {
      try {
        sideMessage =
          await channel.messages.fetch(
            saved.messageId
          );
      } catch (error) {
        console.warn(
          "[SIDE] Mensagem anterior " +
          "não encontrada:",
          error.message
        );

        sideMessage = null;
      }
    }

    // Salva inclusive estados recuperados
    // do veto anterior.
    saveSideState();

    if (sideA && sideB) {
      console.log(
        "[SIDE] Lados já definidos. " +
        "Retomando criação da partida."
      );

      await finishSideChoice();

      return true;
    }

    await publishSidePanel();

    console.log(
      "[SIDE] Escolha de lado restaurada."
    );

    return true;
  } catch (error) {
    console.error(
      "[SIDE] Erro na recuperação:",
      error
    );

    // Os dados permanecem no SQLite.
    resetSideChoice();

    throw error;
  }
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
  sideChannelId = null;
}

// ==========================================
// CONSULTAS
// ==========================================

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
