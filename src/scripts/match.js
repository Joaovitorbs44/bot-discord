const { cleanup } = require("../services/panelLifecycle");

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
const { refreshSeason } = require("../services/seasonService");
const queueState = require("./queueState");

// ==========================================
// IDENTIDADE VISUAL
// ==========================================

const COLORS = {
  primary: 0xFF3D2C
};

// ==========================================
// UTILITÁRIOS
// ==========================================

function safeText(value, maxLength = 80) {
  return String(value || "—")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, maxLength);
}

function generateMatchCode() {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code =
      `#${Math.floor(100000 + Math.random() * 900000)}`;

    const exists = db.prepare(`
      SELECT id
      FROM matches
      WHERE match_code = ?
    `).get(code);

    if (!exists) {
      return code;
    }
  }

  throw new Error("MATCH_CODE_GENERATION_FAILED");
}

// ==========================================
// VALIDAÇÃO
// ==========================================

function validateMatchData(data) {
  if (
    !data ||
    typeof data.map !== "string" ||
    !data.map.trim()
  ) {
    throw new Error("INVALID_MATCH_MAP");
  }

  if (
    !data.captainA?.discordId ||
    !data.captainB?.discordId ||
    data.captainA.discordId === data.captainB.discordId
  ) {
    throw new Error("INVALID_MATCH_CAPTAINS");
  }

  if (
    !["Ataque", "Defesa"].includes(data.sideA) ||
    !["Ataque", "Defesa"].includes(data.sideB) ||
    data.sideA === data.sideB
  ) {
    throw new Error("INVALID_MATCH_SIDES");
  }

  if (
    !Array.isArray(data.teamA) ||
    !Array.isArray(data.teamB) ||
    data.teamA.length !== config.matchmaking.teamSize ||
    data.teamB.length !== config.matchmaking.teamSize
  ) {
    throw new Error("INVALID_MATCH_TEAM_SIZE");
  }

  const all = [
    ...data.teamA,
    ...data.teamB
  ];

  const ids = all.map(
    player => player?.discordId
  );

  if (
    ids.some(id => !id) ||
    ids.length !== config.matchmaking.requiredPlayers ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("INVALID_MATCH_PLAYERS");
  }

  if (
    !data.teamA.some(
      p => p.discordId === data.captainA.discordId
    ) ||
    !data.teamB.some(
      p => p.discordId === data.captainB.discordId
    )
  ) {
    throw new Error("MATCH_CAPTAIN_NOT_IN_TEAM");
  }
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
      safeText(player.nickname || player.discordId)
    );
  }).join("\n");
}

function sideIcon(side) {
  return side === "Ataque" ? "⚔️" : "🛡️";
}

// ==========================================
// PAINEL COMPONENTS V2
// ==========================================

function createMatchPanel(match, data, season) {
  const matchCode = match.matchCode;

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.primary)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## INVI SIX PRO\n" +
        "### PARTIDA COMPETITIVA · 5V5"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Partida:** ${matchCode}\n` +
        `**Temporada:** ${safeText(season.name)}\n` +
        `**Mapa:** ${safeText(data.map)}\n` +
        "**Status:** 🟢 Em andamento"
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🟠 TIME A · ${sideIcon(data.sideA)} ${data.sideA}\n` +
        createTeamList(
          data.teamA,
          data.captainA
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
        `### 🔵 TIME B · ${sideIcon(data.sideB)} ${data.sideB}\n` +
        createTeamList(
          data.teamB,
          data.captainB
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
        "-# Somente os capitães podem informar o resultado."
      )
    );

  const buttons = createResultButtons(matchCode);

  return {
    components: [
      container,
      ...buttons
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: []
    }
  };
}

// ==========================================
// BOTÃO DE RESULTADO
// ==========================================

function createResultButtons(matchCode) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `result_report:${matchCode}`
        )
        .setLabel("Informar resultado")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

// ==========================================
// ESTADO DA SESSÃO
// ==========================================

function readSessionState(session) {
  try {
    return JSON.parse(
      session.state_json || "{}"
    );
  } catch {
    return {};
  }
}

function findPreviousMatch(session) {
  if (session.match_id) {
    const match = db.prepare(`
      SELECT id, match_code
      FROM matches
      WHERE id = ?
    `).get(session.match_id);

    if (match) {
      return match;
    }
  }

  const state = readSessionState(session);
  const matchId = state.createdMatchId;

  if (!matchId) {
    return null;
  }

  return db.prepare(`
    SELECT id, match_code
    FROM matches
    WHERE id = ?
  `).get(matchId) || null;
}

// ==========================================
// IDENTIFICAR PUBLICAÇÃO EXISTENTE
// ==========================================

function hasMatchCodeInComponents(components, matchCode) {
  if (!Array.isArray(components)) {
    return false;
  }

  const marker = `Partida:** ${matchCode}`;

  for (const component of components) {
    if (
      typeof component.content === "string" &&
      component.content.includes(marker)
    ) {
      return true;
    }

    if (
      component.customId ===
      `result_report:${matchCode}`
    ) {
      return true;
    }

    if (
      component.custom_id ===
      `result_report:${matchCode}`
    ) {
      return true;
    }

    const nested =
      Array.isArray(component.components)
        ? component.components
        : [];

    if (
      hasMatchCodeInComponents(nested, matchCode)
    ) {
      return true;
    }
  }

  return false;
}

function isMatchPublication(message, matchCode, clientId) {
  if (
    !message ||
    message.author?.id !== clientId
  ) {
    return false;
  }

  // Compatibilidade com mensagens antigas em Embed.
  const oldEmbed = message.embeds?.some(
    embed =>
      embed.title === `Partida ${matchCode}`
  );

  if (oldEmbed) {
    return true;
  }

  // Identifica mensagens novas em Components V2.
  const components = message.components?.map(
    component =>
      typeof component.toJSON === "function"
        ? component.toJSON()
        : component
  ) || [];

  return hasMatchCodeInComponents(
    components,
    matchCode
  );
}

// ==========================================
// PUBLICAR PARTIDA
// ==========================================

async function publishMatch(client, match, data, season, sessionId = null) {
  const channelId = config.discord.resultsChannelId;
  if (!channelId) throw new Error("RESULTS_CHANNEL_NOT_CONFIGURED");
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.send) {
    throw new Error("INVALID_RESULTS_CHANNEL");
  }

  const session = sessionId
    ? db.prepare("SELECT * FROM matchmaking_sessions WHERE id = ?").get(sessionId)
    : null;
  const state = session ? readSessionState(session) : {};
  let existing = null;

  if (state.resultMessageId) {
    try {
      existing = await channel.messages.fetch(state.resultMessageId);
    } catch (error) {
      if (error.code !== 10008) throw error;
    }
  }

  if (!existing) {
    const recent = await channel.messages.fetch({ limit: 100 });
    existing = recent.find(message =>
      isMatchPublication(message, match.matchCode, client.user.id)
    );
  }

  if (!existing) {
    existing = await channel.send(createMatchPanel(match, data, season));
  }

  if (session && state.resultMessageId !== existing.id) {
    state.resultMessageId = existing.id;
    state.resultChannelId = channel.id;
    db.prepare(`
      UPDATE matchmaking_sessions
      SET state_json = ?, updated_at = ?
      WHERE id = ? AND match_id = ?
    `).run(JSON.stringify(state), Date.now(), session.id, match.matchId);
  }

  await cleanup(client, state, ["readyCheckPanel", "captainVotePanel", "draftPanel", "mapVetoPanel", "sideChoicePanel"]);
  return channel;
}

// Recupera partidas já gravadas cuja publicação falhou antes de
// salvar o ID da mensagem. Nunca cria uma nova partida.
async function restoreMatchPublications(client) {
  const sessions = db.prepare(`
    SELECT s.*, m.match_code, m.map, m.side_a, m.side_b,
           m.captain_a_discord_id, m.captain_b_discord_id,
           se.name AS season_name
    FROM matchmaking_sessions s
    JOIN matches m ON m.id = s.match_id
    LEFT JOIN seasons se ON se.id = m.season_id
    WHERE s.status = 'completed'
      AND s.match_id IS NOT NULL
      AND m.status IN ('playing', 'pending_confirmation')
    ORDER BY s.id DESC
    LIMIT 100
  `).all();

  for (const session of sessions) {
    const state = readSessionState(session);
    if (state.resultMessageId) continue;
    const saved = state.sideChoice;
    if (!saved?.teamA || !saved?.teamB) {
      console.warn("[MATCH] Dados de times indisponíveis:", session.match_code);
      continue;
    }
    try {
      await publishMatch(
        client,
        { matchId: session.match_id, matchCode: session.match_code },
        {
          map: session.map,
          sideA: session.side_a,
          sideB: session.side_b,
          captainA: saved.captainA,
          captainB: saved.captainB,
          teamA: saved.teamA,
          teamB: saved.teamB
        },
        { name: session.season_name || "Temporada" },
        session.id
      );
      console.log("[MATCH] Publicação recuperada:", session.match_code);
    } catch (error) {
      console.error("[MATCH] Falha ao recuperar publicação:", session.match_code, error);
    }
  }
}

// ==========================================
// CRIAR PARTIDA
// ==========================================

async function createMatch(interaction, matchData) {
  validateMatchData(matchData);

  const currentSession =
    queueState.getActiveSession();

  if (
    !currentSession ||
    currentSession.stage !== "side_choice"
  ) {
    throw new Error(
      "MATCH_SESSION_NOT_READY"
    );
  }

  const seasonResult = refreshSeason();
  const season = seasonResult?.season;

  if (!season) {
    throw new Error(
      "ACTIVE_SEASON_NOT_FOUND"
    );
  }

  // ========================================
  // TRANSAÇÃO ATÔMICA
  // ========================================

  const created = db.transaction(() => {
    const session = db.prepare(`
      SELECT *
      FROM matchmaking_sessions
      WHERE id = ?
    `).get(currentSession.id);

    if (!session) {
      throw new Error(
        "MATCH_SESSION_NOT_FOUND"
      );
    }

    // Impede criar duas partidas para a mesma sessão.
    const previous =
      findPreviousMatch(session);

    if (previous) {
      return {
        matchId: previous.id,
        matchCode: previous.match_code,
        alreadyCreated: true
      };
    }

    if (
      session.status !== "active" ||
      session.stage !== "side_choice"
    ) {
      throw new Error(
        "MATCH_SESSION_NOT_READY"
      );
    }

    const expectedIds = new Set([
      ...matchData.teamA,
      ...matchData.teamB
    ].map(player => player.discordId));

    const participants = db.prepare(`
      SELECT discord_id
      FROM matchmaking_session_players
      WHERE session_id = ?
    `).all(session.id);

    if (
      participants.length !== expectedIds.size ||
      participants.some(
        p => !expectedIds.has(p.discord_id)
      )
    ) {
      throw new Error(
        "MATCH_SESSION_PLAYERS_MISMATCH"
      );
    }

    const matchCode =
      generateMatchCode();

    const insert = db.prepare(`
      INSERT INTO matches (
        match_code,
        season_id,
        map,
        captain_a_discord_id,
        captain_b_discord_id,
        side_a,
        side_b,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'playing')
    `).run(
      matchCode,
      season.id,
      matchData.map,
      matchData.captainA.discordId,
      matchData.captainB.discordId,
      matchData.sideA,
      matchData.sideB
    );

    const matchId =
      Number(insert.lastInsertRowid);

    const insertPlayer = db.prepare(`
      INSERT INTO match_players (
        match_id,
        discord_id,
        team,
        is_captain
      )
      VALUES (?, ?, ?, ?)
    `);

    for (const player of matchData.teamA) {
      insertPlayer.run(
        matchId,
        player.discordId,
        "A",
        Number(
          player.discordId ===
          matchData.captainA.discordId
        )
      );
    }

    for (const player of matchData.teamB) {
      insertPlayer.run(
        matchId,
        player.discordId,
        "B",
        Number(
          player.discordId ===
          matchData.captainB.discordId
        )
      );
    }

    const state =
      readSessionState(session);

    state.createdMatchId = matchId;
    state.createdMatchCode = matchCode;

    // Registra a partida e encerra a sessão
    // na mesma transação SQLite.
    const updated = db.prepare(`
      UPDATE matchmaking_sessions
      SET
        stage = 'playing',
        status = 'completed',
        match_id = ?,
        state_json = ?,
        deadline_at = NULL,
        current_turn_discord_id = NULL,
        updated_at = ?
      WHERE id = ?
        AND status = 'active'
        AND stage = 'side_choice'
    `).run(
      matchId,
      JSON.stringify(state),
      Date.now(),
      session.id
    );

    if (updated.changes !== 1) {
      throw new Error(
        "MATCH_SESSION_TRANSITION_FAILED"
      );
    }

    return {
      matchId,
      matchCode,
      alreadyCreated: false
    };
  })();

  // ========================================
  // RESTAURAR FILA
  // ========================================

  queueState.restoreQueueState();

  const queueMessage =
    queueState.getQueueMessage();

  if (queueMessage) {
    queueState.setQueueMessage(
      queueMessage
    );
  }

  try {
    const {
      updateQueuePanel
    } = require("./queue");

    await updateQueuePanel();
  } catch (error) {
    console.error(
      "Erro ao atualizar painel da fila:",
      error
    );
  }

  // ========================================
  // PUBLICAR NO CANAL DE RESULTADOS
  // ========================================

  // A partida já está persistida no SQLite.
  // Falhas no Discord não criam uma nova partida.
  const resultsChannel =
    await publishMatch(
      interaction.client,
      created,
      matchData,
      season,
      currentSession.id
    );

  try {
    await interaction.followUp({
      content:
        `✅ Partida **${created.matchCode}** criada. ` +
        `Informe o resultado em <#${resultsChannel.id}>.`
    });
  } catch (error) {
    console.error(
      "Erro ao anunciar partida:",
      error
    );
  }

  return {
    ...created,
    season,
    ...matchData
  };
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  createMatch,
  publishMatch,
  generateMatchCode,
  restoreMatchPublications,
  validateMatchData
};

