
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const { refreshSeason } = require("../services/seasonService");
const queueState = require("./queueState");

function generateMatchCode() {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code = `#${Math.floor(100000 + Math.random() * 900000)}`;

    const exists = db.prepare(`
      SELECT id FROM matches WHERE match_code = ?
    `).get(code);

    if (!exists) return code;
  }

  throw new Error("MATCH_CODE_GENERATION_FAILED");
}

function validateMatchData(data) {
  if (!data || typeof data.map !== "string" || !data.map.trim()) {
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

  const all = [...data.teamA, ...data.teamB];
  const ids = all.map(player => player?.discordId);

  if (
    ids.some(id => !id) ||
    ids.length !== config.matchmaking.requiredPlayers ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("INVALID_MATCH_PLAYERS");
  }

  if (
    !data.teamA.some(p => p.discordId === data.captainA.discordId) ||
    !data.teamB.some(p => p.discordId === data.captainB.discordId)
  ) {
    throw new Error("MATCH_CAPTAIN_NOT_IN_TEAM");
  }
}

function createTeamList(players, captain) {
  return players.map(player =>
    `${player.discordId === captain.discordId ? "👑" : "•"} ` +
    `<@${player.discordId}> — ${player.nickname || player.discordId}`
  ).join("\n");
}

function createMatchEmbed(match, data, season) {
  return new EmbedBuilder()
    .setTitle(`Partida ${match.matchCode}`)
    .setDescription(`**${season.name}**`)
    .addFields(
      { name: "Mapa", value: data.map, inline: true },
      { name: "Status", value: "Em andamento", inline: true },
      {
        name: `Time A — ${data.sideA}`,
        value: createTeamList(data.teamA, data.captainA),
        inline: true
      },
      {
        name: `Time B — ${data.sideB}`,
        value: createTeamList(data.teamB, data.captainB),
        inline: true
      }
    )
    .setFooter({
      text: "Somente os capitães podem informar o resultado."
    })
    .setTimestamp();
}

function createResultButtons(matchCode) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`result_report:${matchCode}`)
        .setLabel("Informar resultado")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function readSessionState(session) {
  try {
    return JSON.parse(session.state_json || "{}");
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

    if (match) return match;
  }

  const state = readSessionState(session);
  const matchId = state.createdMatchId;

  if (!matchId) return null;

  return db.prepare(`
    SELECT id, match_code
    FROM matches
    WHERE id = ?
  `).get(matchId) || null;
}

async function publishMatch(client, match, data, season) {
  const channelId = config.discord.resultsChannelId;

  if (!channelId) {
    throw new Error("RESULTS_CHANNEL_NOT_CONFIGURED");
  }

  const channel = await client.channels.fetch(channelId);

  if (!channel?.isTextBased() || !channel.send) {
    throw new Error("INVALID_RESULTS_CHANNEL");
  }

  // Busca uma publicação existente antes de enviar outra.
  // A verificação é uma proteção adicional, não uma garantia
  // absoluta contra duplicação de mensagens no Discord.
  const recent = await channel.messages.fetch({ limit: 100 });

  let existing = recent.find(message =>
    message.author.id === client.user.id &&
    message.embeds.some(embed =>
      embed.title === `Partida ${match.matchCode}`
    )
  );

  if (!existing) {
    existing = await channel.send({
      embeds: [createMatchEmbed(match, data, season)],
      components: createResultButtons(match.matchCode)
    });
  }

  return channel;
}

async function createMatch(interaction, matchData) {
  validateMatchData(matchData);

  const currentSession = queueState.getActiveSession();

  if (!currentSession || currentSession.stage !== "side_choice") {
    throw new Error("MATCH_SESSION_NOT_READY");
  }

  const seasonResult = refreshSeason();
  const season = seasonResult?.season;

  if (!season) {
    throw new Error("ACTIVE_SEASON_NOT_FOUND");
  }

  const created = db.transaction(() => {
    // A sessão é a chave de idempotência.
    // Uma mesma sessão nunca deve criar duas partidas.
    const session = db.prepare(`
      SELECT *
      FROM matchmaking_sessions
      WHERE id = ?
    `).get(currentSession.id);

    if (!session) {
      throw new Error("MATCH_SESSION_NOT_FOUND");
    }

    const previous = findPreviousMatch(session);

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
      throw new Error("MATCH_SESSION_NOT_READY");
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
      participants.some(p => !expectedIds.has(p.discord_id))
    ) {
      throw new Error("MATCH_SESSION_PLAYERS_MISMATCH");
    }

    const matchCode = generateMatchCode();

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

    const matchId = Number(insert.lastInsertRowid);

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
        Number(player.discordId === matchData.captainA.discordId)
      );
    }

    for (const player of matchData.teamB) {
      insertPlayer.run(
        matchId,
        player.discordId,
        "B",
        Number(player.discordId === matchData.captainB.discordId)
      );
    }

    const state = readSessionState(session);
    state.createdMatchId = matchId;
    state.createdMatchCode = matchCode;

    // Fecha a sessão anterior atomicamente com a partida.
    // Os participantes permanecem no histórico da sessão.
    const updated = db.prepare(`
      UPDATE matchmaking_sessions
      SET stage = 'playing',
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
      throw new Error("MATCH_SESSION_TRANSITION_FAILED");
    }

    return {
      matchId,
      matchCode,
      alreadyCreated: false
    };
  })();

  // Uma nova sessão de fila será criada somente depois
  // da transação anterior ser concluída.
  queueState.restoreQueueState();

  const queueMessage = queueState.getQueueMessage();

  if (queueMessage) {
    queueState.setQueueMessage(queueMessage);
  }

  try {
    const { updateQueuePanel } = require("./queue");
    await updateQueuePanel();
  } catch (error) {
    console.error("Erro ao atualizar painel da fila:", error);
  }

  // A partida já existe no SQLite. Falhas no Discord não
  // podem provocar a criação de uma segunda partida.
  const resultsChannel = await publishMatch(
    interaction.client,
    created,
    matchData,
    season
  );

  try {
    await interaction.followUp({
      content:
        `✅ Partida **${created.matchCode}** criada. ` +
        `Informe o resultado em <#${resultsChannel.id}>.`
    });
  } catch (error) {
    console.error("Erro ao anunciar partida:", error);
  }

  return {
    ...created,
    season,
    ...matchData
  };
}

module.exports = {
  createMatch,
  generateMatchCode,
  validateMatchData
};
