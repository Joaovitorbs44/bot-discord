
const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits
} = require("discord.js");

const config = require("../config/config");
const { renderMatchResult } = require("../ui/matchResultImage");
const {
  MAP_POOL,
  generateMapVetoImage
} = require("./mapVetoImage");

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const PRIMARY = 0xFF3D2C;
const SESSION_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 100;

const PANELS = [
  ["queue", "Fila"],
  ["ready", "Ready Check"],
  ["captains", "Capitães"],
  ["draft", "Draft"],
  ["maps", "Veto de mapas"],
  ["side", "Escolha de lado"],
  ["match", "Partida"],
  ["confirm", "Confirmação"],
  ["result", "Resultado final"]
];

const DRAFT_ROUNDS = [
  { captain: "A", picks: 1 },
  { captain: "B", picks: 2 },
  { captain: "A", picks: 2 },
  { captain: "B", picks: 2 },
  { captain: "A", picks: 1 }
];

const RANK_ORDER = [
  "Cobre",
  "Bronze",
  "Prata",
  "Ouro",
  "Platina",
  "Esmeralda",
  "Diamante",
  "Campeão"
];

const PLAYERS = Array.from(
  { length: 10 },
  (_, i) => ({
    id: `player${String(i + 1).padStart(2, "0")}`,
    rank: [
      "Diamante",
      "Esmeralda",
      "Platina",
      "Ouro",
      "Prata"
    ][i % 5]
  })
);

const PLAYER_IDS = PLAYERS.map(p => p.id);
const sessions = new Map();

// ==========================================
// RANKS E EQUILÍBRIO
// ==========================================

function rankScore(id) {
  const player = PLAYERS.find(p => p.id === id);

  return Math.max(
    0,
    RANK_ORDER.indexOf(player?.rank)
  );
}

function eligibleCaptains(session) {
  const levels = [
    ...new Set(
      session.queue.map(rankScore)
    )
  ]
    .sort((a, b) => b - a)
    .slice(0, 2);

  return session.queue.filter(
    id => levels.includes(rankScore(id))
  );
}

function teamStrength(ids) {
  return ids.reduce(
    (sum, id) => sum + rankScore(id),
    0
  );
}

function strengthDifference(session) {
  return Math.abs(
    teamStrength(session.teams.A) -
    teamStrength(session.teams.B)
  );
}

// ==========================================
// HORÁRIOS DA FILA
// ==========================================

function queueTime(timestamp) {
  if (!timestamp) return "—";

  return `<t:${Math.floor(timestamp / 1000)}:t>`;
}

function queueList(session) {
  if (!session.queue.length) {
    return "-# Nenhum jogador";
  }

  return session.queue.map((id, index) => {
    const player = PLAYERS.find(p => p.id === id);

    return (
      `${index + 1}. **${id}** · ` +
      `${player?.rank || "—"} · ` +
      `Entrou ${queueTime(session.joinedAt[id])}`
    );
  }).join("\n");
}

// ==========================================
// SIMULAÇÃO DOS CANAIS
// ==========================================

function stageChannel(panel) {
  if (["queue", "ready"].includes(panel)) {
    return "#puxar-partida";
  }

  if (["captains", "draft"].includes(panel)) {
    return "#pick-de-players";
  }

  if (["maps", "side"].includes(panel)) {
    return "#ban-de-mapas";
  }

  return "#resultados";
}

function transition(session, next) {
  if (session.panel === next) return;

  const previous = stageChannel(session.panel);
  const destination = stageChannel(next);

  if (previous !== destination) {
    session.channelEvents.push(
      `✅ ${destination}: próxima etapa publicada`
    );

    session.channelEvents.push(
      `🧹 ${previous}: mensagens temporárias ` +
      "removidas após publicação"
    );

    session.channelEvents =
      session.channelEvents.slice(-8);
  }

  session.panel = next;
}

// ==========================================
// SESSÕES ISOLADAS
// ==========================================

function newSession() {
  const now = Date.now();
  const initial = PLAYER_IDS.slice(0, 6);

  return {
    panel: "queue",
    queue: [...initial],

    joinedAt: Object.fromEntries(
      initial.map((id, i) => [
        id,
        now - (6 - i) * 60000
      ])
    ),

    channelEvents: [],
    ready: [],
    votes: {},
    captains: [],
    teams: { A: [], B: [] },
    draftStep: 0,
    bans: [],
    selectedMap: null,
    side: null,
    winner: null,
    reported: false,
    disputed: false,
    finished: false,
    updated: now
  };
}

function getSession(id, reset = false) {
  const now = Date.now();

  for (const [key, session] of sessions) {
    if (now - session.updated > SESSION_MS) {
      sessions.delete(key);
    }
  }

  if (reset || !sessions.has(id)) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      sessions.delete(oldest);
    }

    sessions.set(id, newSession());
  }

  const session = sessions.get(id);
  session.updated = now;

  return session;
}

// ==========================================
// PERMISSÕES
// ==========================================

function isStaff(interaction) {
  const roleId =
    config.discord?.staffRoleId ||
    process.env.STAFF_ROLE_ID;

  const roles = interaction.member?.roles;

  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    ) ||
    (
      roleId &&
      (
        roles?.cache?.has?.(roleId) ||
        (
          Array.isArray(roles) &&
          roles.includes(roleId)
        )
      )
    )
  );
}

// ==========================================
// COMPONENTES
// ==========================================

function addText(container, content) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content)
  );
}

function separator(container) {
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small)
  );
}

function createContainer(title, subtitle) {
  const container = new ContainerBuilder().setAccentColor(PRIMARY);

  addText(
    container,
    "-#  ◈  INVI SIX PRO     /     COMPETITIVE EXPERIENCE\n" +
    "## " + title + "\n" +
    "-# " + subtitle
  );
  separator(container);
  return container;
}

function list(ids, captains = []) {
  if (!ids.length) {
    return "-# Nenhum jogador";
  }

  return ids.map(id => {
    const player = PLAYERS.find(p => p.id === id);

    return (
      `${captains.includes(id) ? "👑" : "•"} ` +
      `**${id}** · ${player?.rank || "—"}`
    );
  }).join("\n");
}

function row(...components) {
  return new ActionRowBuilder()
    .addComponents(components);
}

function button(
  action,
  label,
  style = ButtonStyle.Secondary,
  disabled = false
) {
  return new ButtonBuilder()
    .setCustomId(`preview_action:${action}`)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

function select(
  action,
  placeholder,
  values,
  min = 1,
  max = 1
) {
  if (!values.length) return null;

  const options = values.map(value =>
    typeof value === "string"
      ? { label: value, value }
      : value
  );

  return row(
    new StringSelectMenuBuilder()
      .setCustomId(`preview_choice:${action}`)
      .setPlaceholder(placeholder)
      .setMinValues(min)
      .setMaxValues(max)
      .addOptions(options)
  );
}

// ==========================================
// DRAFT 1-2-2-2-1
// ==========================================

function currentDraftRound(session) {
  return DRAFT_ROUNDS[session.draftStep] || null;
}

function availableDraft(session) {
  return PLAYER_IDS.filter(id =>
    !session.teams.A.includes(id) &&
    !session.teams.B.includes(id)
  );
}

function autoCaptains(session) {
  const eligible = eligibleCaptains(session);
  const totals = {};

  for (const voted of Object.values(session.votes)) {
    if (eligible.includes(voted)) {
      totals[voted] = (totals[voted] || 0) + 1;
    }
  }

  const ranked = [...eligible].sort((a, b) =>
    (totals[b] || 0) - (totals[a] || 0) ||
    rankScore(b) - rankScore(a) ||
    a.localeCompare(b)
  );

  session.captains = ranked.slice(0, 2);

  session.teams = {
    A: session.captains[0]
      ? [session.captains[0]]
      : [],

    B: session.captains[1]
      ? [session.captains[1]]
      : []
  };

  session.draftStep = 0;
}

function ensureDraft(session) {
  if (session.captains.length !== 2) {
    autoCaptains(session);
  }
}

function applyDraftPicks(session, selectedIds) {
  ensureDraft(session);

  const round = currentDraftRound(session);

  if (!round) return false;

  if (
    !Array.isArray(selectedIds) ||
    selectedIds.length !== round.picks ||
    new Set(selectedIds).size !== round.picks
  ) {
    return false;
  }

  const available = availableDraft(session);

  if (
    !selectedIds.every(id =>
      available.includes(id)
    )
  ) {
    return false;
  }

  session.teams[round.captain].push(
    ...selectedIds
  );

  session.draftStep++;

  return true;
}

function ensureTeams(session) {
  ensureDraft(session);

  while (currentDraftRound(session)) {
    const round = currentDraftRound(session);

    const selected = availableDraft(session)
      .slice(0, round.picks);

    if (!applyDraftPicks(session, selected)) {
      break;
    }
  }
}

// ==========================================
// MAPAS
// ==========================================

function availableMaps(session) {
  return MAP_POOL.filter(map =>
    !session.bans.some(ban => ban.map === map)
  );
}

function ensureMap(session) {
  if (!session.selectedMap) {
    session.selectedMap =
      availableMaps(session)[0] ||
      MAP_POOL[0];
  }
}

function applyMapBan(session, map) {
  const available = availableMaps(session);

  if (
    session.selectedMap ||
    available.length <= 1 ||
    !available.includes(map)
  ) {
    return false;
  }

  session.bans.push({
    map,
    captainTeam:
      session.bans.length % 2 === 0
        ? "A"
        : "B"
  });

  if (availableMaps(session).length === 1) {
    ensureMap(session);
  }

  return true;
}

function completeMapVeto(session) {
  while (availableMaps(session).length > 1) {
    const map = availableMaps(session)[0];

    if (!applyMapBan(session, map)) {
      break;
    }
  }

  ensureMap(session);
}

function ensureResult(session) {
  ensureTeams(session);
  ensureMap(session);

  if (!session.side) {
    session.side = "attack";
  }

  if (!session.winner) {
    session.winner = "A";
  }
}

// ==========================================
// CONSTRUÇÃO DOS PAINÉIS
// ==========================================

async function buildPanel(session) {
  const components = [];
  const files = [];

  let container;

  switch (session.panel) {

    // ======================================
    // FILA
    // ======================================

    case "queue": {
      container = createContainer(
        "FILA COMPETITIVA",
        "SIMULAÇÃO · 5V5"
      );

      addText(
        container,
        `**Jogadores:** ${session.queue.length}/10\n` +
        `**Status:** ${
          session.queue.length === 10
            ? "Completa"
            : "Aberta"
        }`
      );

      separator(container);

      addText(
        container,
        "### JOGADORES NA FILA\n" +
        queueList(session)
      );

      components.push(
        row(
          button(
            "join",
            "Adicionar jogador",
            ButtonStyle.Success,
            session.queue.length === 10
          ),
          button(
            "leave",
            "Remover jogador",
            ButtonStyle.Secondary,
            session.queue.length === 0
          )
        )
      );

      components.push(
        row(
          button(
            "fill",
            "Completar fila",
            ButtonStyle.Primary,
            session.queue.length === 10
          ),
          button(
            "to_ready",
            "Iniciar Ready Check",
            ButtonStyle.Success,
            session.queue.length !== 10
          )
        )
      );

      break;
    }

    // ======================================
    // READY CHECK
    // ======================================

    case "ready": {
      container = createContainer(
        "READY CHECK",
        "CONFIRMAÇÃO FICTÍCIA"
      );

      addText(
        container,
        `**Confirmados:** ${session.ready.length}/10\n` +
        "**Prazo demonstrativo:** sem limite"
      );

      separator(container);

      addText(
        container,
        PLAYER_IDS.map(id =>
          `${session.ready.includes(id) ? "✅" : "⏳"} ${id}`
        ).join("\n")
      );

      const pending = PLAYER_IDS.filter(
        id => !session.ready.includes(id)
      );

      if (pending.length) {
        components.push(
          select(
            "ready",
            "Confirmar jogador",
            pending
          )
        );
      }

      components.push(
        row(
          button(
            "ready_all",
            "Confirmar todos",
            ButtonStyle.Primary,
            pending.length === 0
          ),
          button(
            "to_captains",
            "Votar capitães",
            ButtonStyle.Success,
            pending.length !== 0
          )
        )
      );

      break;
    }

    // ======================================
    // CAPITÃES
    // ======================================

    case "captains": {
      const eligible = eligibleCaptains(session);

      container = createContainer(
        "VOTAÇÃO DE CAPITÃES",
        "APENAS RANKS MAIS ALTOS"
      );

      addText(
        container,
        `**Votos:** ${
          Object.keys(session.votes).length
        }/10\n` +
        `**Elegíveis:** ${eligible.join(", ")}\n` +
        `**Capitães:** ${
          session.captains.join(" e ") ||
          "A definir"
        }`
      );

      separator(container);

      addText(
        container,
        "### VOTAÇÃO\n" +
        PLAYER_IDS.map(id =>
          `${session.votes[id] ? "✅" : "⏳"} ${id}` +
          (
            session.votes[id]
              ? ` → ${session.votes[id]}`
              : ""
          )
        ).join("\n")
      );

      separator(container);

      addText(
        container,
        "### CANDIDATOS ELEGÍVEIS\n" +
        list(eligible)
      );

      if (
        Object.keys(session.votes).length < 10 &&
        eligible.length
      ) {
        components.push(
          select(
            "captain",
            "Vote no capitão",
            eligible.map(id => ({
              label: id,
              value: id,
              description:
                PLAYERS.find(p => p.id === id)?.rank ||
                "Sem rank"
            }))
          )
        );
      }

      components.push(
        row(
          button(
            "captain_auto",
            "Concluir votação",
            ButtonStyle.Primary
          ),
          button(
            "to_draft",
            "Ir ao draft",
            ButtonStyle.Success,
            session.captains.length !== 2
          )
        )
      );

      break;
    }

    // ======================================
    // DRAFT
    // ======================================

    case "draft": {
      ensureDraft(session);

      const round = currentDraftRound(session);
      const available = availableDraft(session);

      container = createContainer(
        "DRAFT 5V5",
        "ESCOLHA 1-2-2-2-1"
      );

      addText(
        container,
        `**Rodada:** ${
          round
            ? `${session.draftStep + 1}/5`
            : "5/5 · Concluído"
        }\n` +
        `**Vez:** ${
          round
            ? `👑 ${
                session.captains[
                  round.captain === "A" ? 0 : 1
                ]
              } · Time ${round.captain}`
            : "Draft finalizado"
        }\n` +
        `**Escolhas:** ${
          round?.picks || 0
        }\n` +
        `**Disponíveis:** ${available.length}`
      );

      separator(container);

      addText(
        container,
        `### 🔴 TIME A · ${
          session.teams.A.length
        }/5\n` +
        list(
          session.teams.A,
          session.captains
        )
      );

      separator(container);

      addText(
        container,
        `### 🔵 TIME B · ${
          session.teams.B.length
        }/5\n` +
        list(
          session.teams.B,
          session.captains
        )
      );

      separator(container);

      addText(
        container,
        "### FORÇA ESTIMADA\n" +
        `**Time A:** ${
          teamStrength(session.teams.A)
        }\n` +
        `**Time B:** ${
          teamStrength(session.teams.B)
        }\n` +
        `**Diferença:** ${
          strengthDifference(session)
        }\n` +
        "-# Comparação ilustrativa baseada nos ranks."
      );

      separator(container);

      addText(
        container,
        "### JOGADORES DISPONÍVEIS\n" +
        list(available)
      );

      if (
        round &&
        available.length >= round.picks
      ) {
        components.push(
          select(
            "draft",
            `Escolha ${round.picks} jogador(es)`,
            available.map(id => ({
              label: id,
              value: id,
              description:
                PLAYERS.find(p => p.id === id)?.rank ||
                "Sem rank"
            })),
            round.picks,
            round.picks
          )
        );
      }

      components.push(
        row(
          button(
            "draft_auto",
            "Completar draft",
            ButtonStyle.Primary,
            !round
          ),
          button(
            "to_maps",
            "Ir ao veto",
            ButtonStyle.Success,
            Boolean(round)
          )
        )
      );

      break;
    }

    // ======================================
    // VETO DE MAPAS
    // ======================================

    case "maps": {
      const available = availableMaps(session);

      container = createContainer(
        "VETO DE MAPAS",
        "PICK & BAN · MELHOR DE 1"
      );

      addText(
        container,
        `**Banimentos:** ${
          session.bans.length
        }/${MAP_POOL.length - 1}\n` +
        `**Vez:** Time ${
          session.bans.length % 2
            ? "B"
            : "A"
        }\n` +
        `**Mapa escolhido:** ${
          session.selectedMap ||
          "A definir"
        }`
      );

      separator(container);

      addText(
        container,
        "### MAP POOL\n" +
        "-# Verde: disponível · Vermelho: banido"
      );

      const imageName = "map-veto-preview.png";

      const image = await generateMapVetoImage({
        bannedMaps: session.bans,
        selectedMap: session.selectedMap
      });

      files.push(
        new AttachmentBuilder(image, {
          name: imageName
        })
      );

      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL(`attachment://${imageName}`)
            .setDescription(
              "Mosaico dos mapas"
            )
        )
      );

      separator(container);

      addText(
        container,
        "### MAPAS DISPONÍVEIS\n" +
        (
          available.map(map =>
            `🟢 ${map}`
          ).join("\n") ||
          "Nenhum"
        )
      );

      separator(container);

      addText(
        container,
        "### HISTÓRICO\n" +
        (
          session.bans.map((ban, i) =>
            `${i + 1}. ❌ ${ban.map} · ` +
            `Time ${ban.captainTeam}`
          ).join("\n") ||
          "-# Sem banimentos"
        )
      );

      if (
        available.length > 1 &&
        !session.selectedMap
      ) {
        components.push(
          select(
            "map",
            "Banir um mapa",
            available
          )
        );
      }

      components.push(
        row(
          button(
            "map_auto",
            "Concluir veto",
            ButtonStyle.Primary,
            Boolean(session.selectedMap)
          ),
          button(
            "to_side",
            "Escolher lado",
            ButtonStyle.Success,
            !session.selectedMap
          )
        )
      );

      break;
    }

    // ======================================
    // ESCOLHA DE LADO
    // ======================================

    case "side": {
      ensureTeams(session);
      ensureMap(session);

      container = createContainer(
        "ESCOLHA DE LADO",
        "CONFIGURAÇÃO DA PARTIDA"
      );

      addText(
        container,
        `**Mapa:** ${session.selectedMap}\n` +
        `**Time A:** ${
          session.side === "attack"
            ? "Ataque"
            : session.side === "defense"
              ? "Defesa"
              : "A definir"
        }`
      );

      separator(container);

      addText(
        container,
        "### 🔴 TIME A\n" +
        list(
          session.teams.A,
          session.captains
        )
      );

      separator(container);

      addText(
        container,
        "### 🔵 TIME B\n" +
        list(
          session.teams.B,
          session.captains
        )
      );

      components.push(
        row(
          button(
            "attack",
            "Ataque",
            ButtonStyle.Danger
          ),
          button(
            "defense",
            "Defesa",
            ButtonStyle.Primary
          )
        )
      );

      components.push(
        row(
          button(
            "to_match",
            "Iniciar partida",
            ButtonStyle.Success,
            !session.side
          )
        )
      );

      break;
    }

    // ======================================
    // PARTIDA
    // ======================================

    case "match": {
      ensureTeams(session);
      ensureMap(session);

      container = createContainer(
        "PARTIDA COMPETITIVA",
        "PARTIDA DEMONSTRATIVA #482731"
      );

      addText(
        container,
        `**Mapa:** ${session.selectedMap}\n` +
        `**Status:** ${
          session.reported
            ? "Resultado informado"
            : "Em andamento"
        }`
      );

      separator(container);

      addText(
        container,
        "### 🔴 TIME A · " +
        (
          session.side === "defense"
            ? "DEFESA"
            : "ATAQUE"
        ) +
        "\n" +
        list(
          session.teams.A,
          session.captains
        )
      );

      separator(container);

      addText(
        container,
        "### 🔵 TIME B · " +
        (
          session.side === "defense"
            ? "ATAQUE"
            : "DEFESA"
        ) +
        "\n" +
        list(
          session.teams.B,
          session.captains
        )
      );

      components.push(
        row(
          button(
            "winner_A",
            "Vitória Time A",
            ButtonStyle.Danger
          ),
          button(
            "winner_B",
            "Vitória Time B",
            ButtonStyle.Primary
          )
        )
      );

      break;
    }

    // ======================================
    // CONFIRMAÇÃO
    // ======================================

    case "confirm": {
      ensureResult(session);

      container = createContainer(
        "CONFIRMAÇÃO DE RESULTADO",
        "PARTIDA #482731"
      );

      addText(
        container,
        `**Mapa:** ${session.selectedMap}\n` +
        `**Vencedor informado:** Time ${
          session.winner
        }\n` +
        `**Status:** ${
          session.disputed
            ? "⚠️ Contestado"
            : "⏳ Aguardando confirmação"
        }`
      );

      separator(container);

      addText(
        container,
        session.disputed
          ? "A Staff pode definir o vencedor ou cancelar."
          : "Confirme ou conteste o resultado fictício."
      );

      if (!session.disputed) {
        components.push(
          row(
            button(
              "confirm",
              "Confirmar",
              ButtonStyle.Success
            ),
            button(
              "dispute",
              "Contestar",
              ButtonStyle.Danger
            )
          )
        );
      } else {
        components.push(
          row(
            button(
              "staff_A",
              "Staff: Time A",
              ButtonStyle.Danger
            ),
            button(
              "staff_B",
              "Staff: Time B",
              ButtonStyle.Primary
            ),
            button(
              "cancel",
              "Cancelar",
              ButtonStyle.Secondary
            )
          )
        );
      }

      break;
    }

    // ======================================
    // RESULTADO FINAL
    // ======================================

    case "result": {
      ensureResult(session);
      const loser = session.winner === "A" ? "B" : "A";
      const formatPlayers = ids => ids.map(id => ({
        name: id,
        rank: PLAYERS.find(p => p.id === id)?.rank || "—",
        captain: session.captains.includes(id)
      }));
      const buffer = await renderMatchResult({
        matchCode: "482731",
        map: session.selectedMap,
        winner: session.winner,
        winners: formatPlayers(session.teams[session.winner]),
        losers: formatPlayers(session.teams[loser])
      });
      const filename = "invi-six-pro-v2-result.png";
      files.push(new AttachmentBuilder(buffer, { name: filename }));
      // Render the image as a top-level gallery, outside Discord's container.
      // Preserve accessible result text without duplicating the entire scoreboard.
      components.push(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL("attachment://" + filename)
            .setDescription(
              "Resultado da partida: Time " + session.winner +
              " venceu em " + session.selectedMap +
              ". Vencedores recebem 5 pontos e derrotados perdem 3 pontos."
            )
        )
      );
      break;
    }

    default:
      throw new Error(
        "INVALID_PREVIEW_PANEL"
      );
  }

  // Keep the old containers for all other preview stages.
  // The graphical result deliberately has no outer container or duplicate footer.
  if (session.panel !== "result") {
    separator(container);
    addText(
      container,
      "-# " + stageChannel(session.panel) +
      "   /   AMBIENTE DE TESTES   /   DADOS FICTÍCIOS" +
      (session.channelEvents.length
        ? "\n-# " + session.channelEvents.slice(-2).join("  ·  ").slice(0, 450)
        : "")
    );
    components.unshift(container);
  }

  // ========================================
  // NAVEGAÇÃO
  // ========================================

  components.push(
    row(
      new StringSelectMenuBuilder()
        .setCustomId("preview_select")
        .setPlaceholder(
          "Navegar pelos painéis"
        )
        .addOptions(
          PANELS.map(([value, label]) => ({
            value,
            label,
            default: value === session.panel
          }))
        )
    )
  );

  components.push(
    row(
      button(
        "reset",
        "Reiniciar simulação",
        ButtonStyle.Secondary
      )
    )
  );

  return {
    components,
    files,
    allowedMentions: {
      parse: []
    }
  };
}

// ==========================================
// CRIAR MENSAGEM DO PREVIEW
// ==========================================

async function createPreviewMessage(
  type = "queue",
  session = null
) {
  const current = session || newSession();

  current.panel = PANELS.some(
    panel => panel[0] === type
  )
    ? type
    : "queue";

  return {
    ...await buildPanel(current),
    flags: MessageFlags.IsComponentsV2
  };
}

// ==========================================
// COMANDO /PREVIEW
// ==========================================

const command = new SlashCommandBuilder()
  .setName("preview")
  .setDescription(
    "Prévia interativa dos painéis INVI SIX PRO V2."
  )
  .setDMPermission(false);

async function executePreview(interaction) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content: "Acesso restrito à Staff.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  const session = getSession(
    interaction.user.id,
    true
  );

  return interaction.editReply(
    await createPreviewMessage(
      "queue",
      session
    )
  );
}

// ==========================================
// NAVEGAÇÃO ENTRE PAINÉIS
// ==========================================

async function handlePreviewSelect(interaction) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content: "Acesso restrito à Staff.",
      flags: MessageFlags.Ephemeral
    });
  }

  const type = interaction.values?.[0];

  if (
    !PANELS.some(
      panel => panel[0] === type
    )
  ) {
    return interaction.reply({
      content: "Painel inválido.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate();

  const session = getSession(
    interaction.user.id
  );

  return interaction.editReply({
    ...await createPreviewMessage(
      type,
      session
    ),
    attachments: []
  });
}

// ==========================================
// AÇÕES INTERATIVAS
// ==========================================

async function handlePreviewAction(interaction) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content: "Acesso restrito à Staff.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate();

  let session = getSession(
    interaction.user.id
  );

  const action =
    interaction.customId.startsWith(
      "preview_action:"
    )
      ? interaction.customId.slice(
          "preview_action:".length
        )
      : interaction.customId.slice(
          "preview_choice:".length
        );

  const values =
    interaction.isStringSelectMenu()
      ? interaction.values || []
      : [];

  const value = values[0] || null;

  switch (action) {

    // ======================================
    // RESET
    // ======================================

    case "reset":
      session = getSession(
        interaction.user.id,
        true
      );
      break;

    // ======================================
    // FILA
    // ======================================

    case "join": {
      const next = PLAYER_IDS.find(
        id => !session.queue.includes(id)
      );

      if (next) {
        session.queue.push(next);
        session.joinedAt[next] = Date.now();
      }

      break;
    }

    case "leave": {
      const removed = session.queue.pop();

      if (removed) {
        delete session.joinedAt[removed];
      }

      break;
    }

    case "fill":
      session.queue = [...PLAYER_IDS];

      for (const id of PLAYER_IDS) {
        if (!session.joinedAt[id]) {
          session.joinedAt[id] = Date.now();
        }
      }

      break;

    case "to_ready":
      if (session.queue.length === 10) {
        transition(session, "ready");
      }
      break;

    // ======================================
    // READY CHECK
    // ======================================

    case "ready":
      if (
        PLAYER_IDS.includes(value) &&
        !session.ready.includes(value)
      ) {
        session.ready.push(value);
      }
      break;

    case "ready_all":
      session.ready = [...PLAYER_IDS];
      break;

    case "to_captains":
      if (session.ready.length === 10) {
        transition(session, "captains");
      }
      break;

    // ======================================
    // CAPITÃES
    // ======================================

    case "captain": {
      const eligible =
        eligibleCaptains(session);

      if (!eligible.includes(value)) {
        break;
      }

      const voter = PLAYER_IDS.find(
        id => !Object.hasOwn(
          session.votes,
          id
        )
      );

      if (voter) {
        session.votes[voter] = value;
      }

      if (
        Object.keys(session.votes).length === 10
      ) {
        autoCaptains(session);
      }

      break;
    }

    case "captain_auto":
      autoCaptains(session);
      break;

    case "to_draft":
      if (session.captains.length === 2) {
        transition(session, "draft");
      }
      break;

    // ======================================
    // DRAFT
    // ======================================

    case "draft":
      applyDraftPicks(
        session,
        values
      );
      break;

    case "draft_auto":
      ensureTeams(session);
      break;

    case "to_maps":
      if (!currentDraftRound(session)) {
        transition(session, "maps");
      }
      break;

    // ======================================
    // VETO
    // ======================================

    case "map":
      applyMapBan(session, value);
      break;

    case "map_auto":
      completeMapVeto(session);
      break;

    case "to_side":
      if (session.selectedMap) {
        transition(session, "side");
      }
      break;

    // ======================================
    // ESCOLHA DE LADO
    // ======================================

    case "attack":
      session.side = "attack";
      break;

    case "defense":
      session.side = "defense";
      break;

    case "to_match":
      if (session.side) {
        transition(session, "match");
      }
      break;

    // ======================================
    // RESULTADOS
    // ======================================

    case "winner_A":
    case "winner_B":
      session.winner = action.slice(-1);
      session.reported = true;
      session.disputed = false;

      transition(session, "confirm");
      break;

    case "confirm":
      session.finished = true;

      transition(session, "result");
      break;

    case "dispute":
      session.disputed = true;
      break;

    case "staff_A":
    case "staff_B":
      session.winner = action.slice(-1);
      session.finished = true;

      transition(session, "result");
      break;

    case "cancel":
      session.reported = false;
      session.disputed = false;
      session.winner = null;
      session.finished = false;

      transition(session, "match");
      break;

    default:
      break;
  }

  return interaction.editReply({
    ...await createPreviewMessage(
      session.panel,
      session
    ),
    attachments: []
  });
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  command,
  executePreview,
  handlePreviewSelect,
  handlePreviewAction,
  createPreviewMessage
};
