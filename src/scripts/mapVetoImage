
const sharp = require("sharp");

// ==========================================
// CONFIGURACOES
// ==========================================

const CARD_WIDTH = 160;
const CARD_HEIGHT = 100;

const GAP = 8;
const PADDING = 12;

const COLUMNS = 3;
const ROWS = 3;

const WIDTH =
  PADDING * 2 +
  COLUMNS * CARD_WIDTH +
  (COLUMNS - 1) * GAP;

const HEIGHT =
  PADDING * 2 +
  ROWS * CARD_HEIGHT +
  (ROWS - 1) * GAP;

const COLORS = {
  background: "#101014",
  primary: "#FF3D2C",
  success: "#36B37E",
  white: "#FFFFFF",
  muted: "#A1A1AA"
};

// ==========================================
// MAPAS
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

// ==========================================
// IMAGENS UBISOFT
// ==========================================

const MAP_IMAGES = {
  Bank:
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/4mjO2UYo1gqwhess6Mi5gb/a08a0b4886d73742e4d60315b9f21106/R6S_Maps_Bank_INT.jpg",

  Border:
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/5vsJsf9T6r7aFBLJX8dJOG/dafc156a04d0a488768bb67f4571ee9e/R6S_Maps_Border_INT.jpg",

  Chalet:
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/4M17EQjgQCJOy2NpZM08OT/36c6b2db0da388d851a5c518335c9145/R6S_Maps_Chalet_INT.jpg",

  Clubhouse:
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/2ljlmbIAzZyVPSxOIcnlBn/da345d768d59f205b55ebae07c9f5ab1/R6S_Maps_Clubhouse_INT.jpg",

  Villa:
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/6unM0FYNkxPsr7BSiKLPR5/1a3e9cf2565be709e993a809457e595a/r6s-maps-villa-main.jpg",

  "Kafe Dostoyevsky":
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/2fFapm8NXcr8tVPK5wKvAw/7badc6f2631b4954e11acb087b5cf24d/R6S_Maps_RussianCafe_INT.jpg",

  Lair:
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/2bKyUztyfsi7HfL9RGtPb9/b34c837688b2b4db51ce1e97520d61ef/ModernizedMap_Lair_keyart.jpg",

  "Nighthaven Labs":
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/2gMeZHxuUrUzHTTBdxqGJJ/3bb639dc291983d825cbde80c15efbad/ModernizedMap_Nighthaven_keyart.jpg",

  Fortress:
    "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/4WTHlSiKQwN09UHrKTSxo8/579a9b6411b879591f9a01124a0bae99/fortress-reworked-keyart.jpg"
};

// ==========================================
// CACHE DE IMAGENS
// ==========================================

const imageCache = new Map();

const CACHE_LIMIT = 9;

// ==========================================
// UTILITARIOS
// ==========================================

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getBanInfo(map, bannedMaps) {
  return bannedMaps.find(item => {
    if (typeof item === "string") {
      return item === map;
    }

    return item && item.map === map;
  }) || null;
}

function getBanTeam(banInfo) {
  if (!banInfo || typeof banInfo === "string") {
    return null;
  }

  return banInfo.captainTeam || banInfo.team || null;
}

// ==========================================
// DOWNLOAD DE IMAGENS
// ==========================================

async function downloadImage(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "image/*"
    }
  });

  if (!response.ok) {
    throw new Error(
      "Falha HTTP " + response.status
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    contentType &&
    !contentType.toLowerCase().startsWith("image/")
  ) {
    throw new Error(
      "Resposta nao e uma imagem: " + contentType
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

// ==========================================
// IMAGEM PADRAO
// ==========================================

async function createFallbackImage() {
  return sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 4,
      background: "#27272A"
    }
  })
    .png()
    .toBuffer();
}

// ==========================================
// PREPARAR IMAGEM DO MAPA
// ==========================================

async function getMapBackground(map) {
  if (imageCache.has(map)) {
    return imageCache.get(map);
  }

  let background;

  try {
    const url = MAP_IMAGES[map];

    if (!url) {
      throw new Error(
        "URL nao encontrada para " + map
      );
    }

    const downloaded = await downloadImage(url);

    background = await sharp(downloaded)
      .resize(CARD_WIDTH, CARD_HEIGHT, {
        fit: "cover",
        position: "centre"
      })
      .png()
      .toBuffer();

  } catch (error) {
    console.warn(
      "Falha ao carregar imagem de " +
      map + ": " + error.message
    );

    background = await createFallbackImage();
  }

  if (imageCache.size >= CACHE_LIMIT) {
    const firstKey =
      imageCache.keys().next().value;

    if (firstKey) {
      imageCache.delete(firstKey);
    }
  }

  imageCache.set(map, background);

  return background;
}

// ==========================================
// CRIAR SOBREPOSICAO SVG
// ==========================================

function createCardOverlay(
  map,
  isBanned,
  isSelected,
  banInfo
) {
  const label = escapeXml(map);

  const statusColor = isSelected
    ? COLORS.success
    : isBanned
      ? COLORS.primary
      : COLORS.success;

  const statusText = isSelected
    ? "ESCOLHIDO"
    : isBanned
      ? "BANIDO"
      : "DISPONIVEL";

  const banTeam = getBanTeam(banInfo);

  const teamText = banTeam
    ? " - TIME " + escapeXml(banTeam)
    : "";

  const darkOverlay = isBanned
    ? '<rect width="160" height="100" fill="#000000" opacity="0.70"/>'
    : "";

  const selectedBorder = isSelected
    ? '<rect x="1.5" y="1.5" width="157" height="97" rx="6" fill="none" stroke="' +
      COLORS.success +
      '" stroke-width="3"/>'
    : "";

  const banMark = isBanned
    ? '<path d="M62 32 L98 68 M98 32 L62 68" stroke="' +
      COLORS.primary +
      '" stroke-width="7" stroke-linecap="round"/>'
    : "";

  const svg = [
    '<svg width="160" height="100" xmlns="http://www.w3.org/2000/svg">',

    darkOverlay,

    '<rect x="0" y="65" width="160" height="35" fill="#000000" opacity="0.84"/>',

    banMark,

    '<text x="8" y="80" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF">',
    label,
    '</text>',

    '<text x="8" y="93" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="',
    statusColor,
    '">',
    statusText,
    teamText,
    '</text>',

    selectedBorder,

    '</svg>'
  ].join("");

  return Buffer.from(svg);
}

// ==========================================
// CRIAR CARD DO MAPA
// ==========================================

async function createMapCard(
  map,
  bannedMaps,
  selectedMap
) {
  const banInfo = getBanInfo(
    map,
    bannedMaps
  );

  const isBanned = Boolean(banInfo);
  const isSelected = selectedMap === map;

  const background = await getMapBackground(map);

  const overlay = createCardOverlay(
    map,
    isBanned,
    isSelected,
    banInfo
  );

  return sharp(background)
    .composite([
      {
        input: overlay,
        top: 0,
        left: 0
      }
    ])
    .png()
    .toBuffer();
}

// ==========================================
// GERAR MOSAICO 3X3
// ==========================================

async function generateMapVetoImage(options = {}) {
  const bannedMaps = Array.isArray(options.bannedMaps)
    ? options.bannedMaps
    : [];

  const selectedMap =
    options.selectedMap || null;

  const cards = await Promise.all(
    MAP_POOL.map(map =>
      createMapCard(
        map,
        bannedMaps,
        selectedMap
      )
    )
  );

  const composites = cards.map(
    (input, index) => {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);

      return {
        input,
        left:
          PADDING +
          column * (CARD_WIDTH + GAP),
        top:
          PADDING +
          row * (CARD_HEIGHT + GAP)
      };
    }
  );

  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: COLORS.background
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
}

// ==========================================
// EXPORTACOES
// ==========================================

module.exports = {
  MAP_POOL,
  MAP_IMAGES,
  generateMapVetoImage
};
