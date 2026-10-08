const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const db = require("../database/database");
const config = require("../config/config");
const queueState = require("./queueState");

const { startSideChoice } = require("./side");

// ==========================================
// MAPAS E IMAGENS
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

const MAP_SLUGS = {
  Bank: "bank",
  Border: "border",
  Chalet: "chalet",
  Clubhouse: "clubhouse",
  Villa: "villa",
  "Kafe Dostoyevsky": "kafe-dostoyevsky",
  Lair: "lair",
  "Nighthaven Labs": "nighthaven-labs",
  Fortress: "fortress"
};

const MAP_IMAGES_DIR = path.resolve(
  __dirname,
  "../assets/maps"
);

// Opcional: URLs HTTPS das imagens no Railway.
// Exemplo:
// MAP_IMAGE_URLS={"Bank":"https://exemplo.com/bank.jpg"}
let MAP_IMAGE_URLS = {};

try {
  const parsed = JSON.parse(
    process.env.MAP_IMAGE_URLS || "{}"
  );

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed)
  ) {
    MAP_IMAGE_URLS = parsed;
  }
} catch {
  console.warn(
    "MAP_IMAGE_URLS inválido. Usando imagens locais."
  );
}

const BAN_TIMEOUT_SECONDS =
  config.matchmaking?.mapBanSeconds || 30;

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451
};

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

// Impede dois banimentos simultâneos.
let processingBan = false;

// ==========================================
// UTILITÁRIOS
// ==========================================

function getSession() {
  return queueState.getActiveSession();
}

function safeText(value) {
  return String(value || "—")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, 80);
}

function getCurrentCaptain() {
  return currentCaptain === "A"
    ? captainA
    : captainB;
}

function separator(container) {
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true)
  );

  return container;
}

function addText(container, content) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content)
  );

  return container;
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

  const remaining = Math.max(
    0,
    banDeadline - Date.now()
  );

  banTimeout = setTimeout(() => {
    handleMapVetoTimeout().catch(error => {
      console.error(
        "Erro no timeout do veto:",
        error
      );
    });
  }, remaining);
}

// ==========================================
// IMAGENS DOS MAPAS
// ==========================================

function getMapImage(map) {
  const slug = MAP_SLUGS[map];

  if (!slug) {
    return null;
  }

  const remoteUrl = MAP_IMAGE_URLS[map];

  if (
    typeof remoteUrl === "string" &&
    /^https:\/\//i.test(remoteUrl)
  ) {
    return {
      url: remoteUrl,
      file: null
    };
  }

  for (const extension of [
    "jpg",
    "jpeg",
    "png",
    "webp"
  ]) {
    const filePath = path.join(
      MAP_IMAGES_DIR,
      `${slug}.${extension}`
    );

    if (fs.existsSync(filePath)) {
      const filename =
        `r6-map-${slug}.${extension}`;

      return {
        url: `attachment://${filename}`,
        file: {
          attachment: filePath,
          name: filename
        }
      };
    }
  }

  return null;
}

function createMapGallery(maps) {
  const gallery = new MediaGalleryBuilder();

  const files = [];
  let count = 0;

  for (const map of maps) {
    const image = getMapImage(map);

    if (!image) {
      continue;
    }

    const isAvailable =
      availableMaps.includes(map);

    const status = isAvailable
      ? "DISPONÍVEL"
      : "BANIDO";

    gallery.addItems(
      new MediaGalleryItemBuilder()
        .setURL(image.url)
        .setDescription(
          `${map} · ${status}`
        )
    );

    if (image.file) {
      files.push(image.file);
    }

    count++;
  }

  return {
    gallery: count > 0 ? gallery : null,
    files
  };
}

// ==========================================
// PERSISTÊNCIA
// ==========================================

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
// CRIAR PAINEL
// ==========================================

function createMapVetoPanel() {
  if (!vetoActive) {
    throw new Error("MAP_VETO_NOT_ACTIVE");
  }

  const captain = getCurrentCaptain();

  if (!captain) {
    throw new Error(
      "INVALID_CURRENT_MAP_VETO_CAPTAIN"
    );
  }

  const deadline = banDeadline
    ? `<t:${Math.ceil(banDeadline / 1000)}:R>`
    : "Encerrado";

  const availableList = availableMaps.length
    ? availableMaps
        .map(map => `🟢 ${safeText(map)}`)
        .join("\n")
    : "Nenhum mapa disponível.";

  const bannedList = bannedMaps.length
    ? bannedMaps
        .map((ban, index) => {
          const automatic = ban.automatic
            ? " · Automático"
            : "";

          return (
            `**${String(index + 1).padStart(2, "0")}.** ` +
            `❌ ${safeText(ban.map)} ` +
            `· Time ${ban.captainTeam}${automatic}`
          );
        })
        .join("\n")
    : "Nenhum mapa banido.";

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.primary);

  addText(
    container,
    "## INVISIXTATIONAL\n" +
    "### PICK & BAN · MELHOR DE 1\n" +
    "-# Rainbow Six Siege · Matchmaking competitivo"
  );

  separator(container);

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

  separator(container);

  addText(
    container,
    "### MAP POOL\n" +
    "-# Imagens dos mapas da partida"
  );

  const {
    gallery,
    files
  } = createMapGallery(MAP_POOL);

  if (gallery) {
    container.addMediaGalleryComponents(gallery);
  } else {
    addText(
      container,
      "-# Adicione as imagens em src/assets/maps " +
      "para visualizar a galeria."
    );
  }

  separator(container);

  addText(
    container,
    `### MAPAS DISPONÍVEIS\n${availableList}`
  );

  separator(container);

  addText(
    container,
    `### HISTÓRICO DE BANIMENTOS\n${bannedList}`
  );

  separator(container);

  addText(
    container,
    "-# Se o tempo terminar, o sistema " +
    "banirá um mapa automaticamente."
  );

  const components = [container];

  if (availableMaps.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("map_veto")
      .setPlaceholder(
        "Selecione um mapa para banir"
      )
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        availableMaps.map(map => ({
          label: map,
          value: map
        }))
      );

    components.push(
      new ActionRowBuilder()
        .addComponents(select)
    );
  }

  return {
    components,
    files,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: []
    }
  };
}

// ==========================================
// PAINEL FINAL
// ==========================================

function createFinishedMapVetoPanel() {
  const bannedList = bannedMaps.length
    ? bannedMaps
        .map((ban, index) => {
          return (
            `**${index + 1}.** ` +
            `${safeText(ban.map)} · ` +
            `Time ${ban.captainTeam}` +
            (ban.automatic
              ? " *(automático)*"
              : "")
          );
        })
        .join("\n")
    : "Nenhum.";

  const container = new ContainerBuilder()
    .setAccentColor(COLORS.success);

  addText(
    container,
    "## INVISIXTATIONAL\n" +
    "### MAPA DEFINIDO"
  );

  separator(container);

  addText(
    container,
    `# ${safeText(selectedMap)}\n` +
    "🏆 **Mapa selecionado para a partida**"
  );

  const {
    gallery,
    files
  } = createMapGallery([selectedMap]);

  if (gallery) {
    separator(container);
    container.addMediaGalleryComponents(gallery);
  }

  separator(container);
