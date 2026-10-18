const sharp = require("sharp");

const CARD_WIDTH = 240;
const CARD_HEIGHT = 144;
const GAP = 8;
const PADDING = 12;
const COLUMNS = 3;

const WIDTH =
  PADDING * 2 +
  COLUMNS * CARD_WIDTH +
  (COLUMNS - 1) * GAP;

const HEIGHT =
  PADDING * 2 +
  COLUMNS * CARD_HEIGHT +
  (COLUMNS - 1) * GAP;

const COLORS = {
  background: "#101014",
  primary: "#FF3D2C",
  success: "#36B37E",
  white: "#FFFFFF"
};

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

const imageCache = new Map();

// Fonte bitmap 5x7.
// Cada caractere é desenhado com retângulos SVG.
// Não depende de fontes instaladas no Railway.

const FONT = {
  A: ["01110","10001","10001","11111","10001","10001","10001"],
  B: ["11110","10001","10001","11110","10001","10001","11110"],
  C: ["01111","10000","10000","10000","10000","10000","01111"],
  D: ["11110","10001","10001","10001","10001","10001","11110"],
  E: ["11111","10000","10000","11110","10000","10000","11111"],
  F: ["11111","10000","10000","11110","10000","10000","10000"],
  G: ["01111","10000","10000","10111","10001","10001","01111"],
  H: ["10001","10001","10001","11111","10001","10001","10001"],
  I: ["11111","00100","00100","00100","00100","00100","11111"],
  J: ["00111","00010","00010","00010","10010","10010","01100"],
  K: ["10001","10010","10100","11000","10100","10010","10001"],
  L: ["10000","10000","10000","10000","10000","10000","11111"],
  M: ["10001","11011","10101","10101","10001","10001","10001"],
  N: ["10001","11001","10101","10011","10001","10001","10001"],
  O: ["01110","10001","10001","10001","10001","10001","01110"],
  P: ["11110","10001","10001","11110","10000","10000","10000"],
  Q: ["01110","10001","10001","10001","10101","10010","01101"],
  R: ["11110","10001","10001","11110","10100","10010","10001"],
  S: ["01111","10000","10000","01110","00001","00001","11110"],
  T: ["11111","00100","00100","00100","00100","00100","00100"],
  U: ["10001","10001","10001","10001","10001","10001","01110"],
  V: ["10001","10001","10001","10001","10001","01010","00100"],
  W: ["10001","10001","10001","10101","10101","10101","01010"],
  X: ["10001","10001","01010","00100","01010","10001","10001"],
  Y: ["10001","10001","01010","00100","00100","00100","00100"],
  Z: ["11111","00001","00010","00100","01000","10000","11111"],
  "0": ["01110","10011","10101","10101","11001","10001","01110"],
  "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"],
  "3": ["11110","00001","00001","01110","00001","00001","11110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "5": ["11111","10000","10000","11110","00001","00001","11110"],
  "6": ["01110","10000","10000","11110","10001","10001","01110"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
  "9": ["01110","10001","10001","01111","00001","00001","01110"],
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "-": ["00000","00000","00000","11111","00000","00000","00000"]
};

function drawText(text, x, y, scale, color, maxWidth) {
  const value = String(text).toUpperCase();
  const advance = 6 * scale;

  let output = "";
  let offset = 0;

  for (const char of value) {
    if (offset + 5 * scale > maxWidth) {
      break;
    }

    const glyph = FONT[char] || FONT[" "];

    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] !== "1") {
          continue;
        }

        output +=
          `<rect x="${x + offset + col * scale}" ` +
          `y="${y + row * scale}" ` +
          `width="${scale}" height="${scale}" ` +
          `fill="${color}"/>`;
      }
    }

    offset += advance;
  }

  return output;
}

function normalizeBan(item) {
  if (typeof item === "string") {
    return { map: item };
  }

  return item && typeof item === "object"
    ? item
    : null;
}

async function getBackground(map) {
  if (imageCache.has(map)) {
    return imageCache.get(map);
  }

  let buffer;

  try {
    const response = await fetch(MAP_IMAGES[map], {
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "image/*",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();

    if (
      !response.ok ||
      !contentType.startsWith("image/")
    ) {
      throw new Error(`HTTP ${response.status}`);
    }

    buffer = await sharp(
      Buffer.from(await response.arrayBuffer())
    )
      .resize(CARD_WIDTH, CARD_HEIGHT, {
        fit: "cover",
        position: "centre"
      })
      .png()
      .toBuffer();
  } catch (error) {
    console.warn(
      `[mapVetoImage] ${map}: ${error.message}`
    );

    buffer = await sharp({
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

  imageCache.set(map, buffer);

  return buffer;
}

function createOverlay(map, ban, selected) {
  const banned = Boolean(ban) && !selected;

  const color = selected
    ? COLORS.success
    : banned
      ? COLORS.primary
      : COLORS.success;

  const status = selected
    ? "ESCOLHIDO"
    : banned
      ? "BANIDO"
      : "DISPONIVEL";

  const teamValue =
    ban?.captainName || null;

  const team = banned && teamValue
    ? ` - ${String(teamValue).replace(/[^A-Za-z0-9 ._-]/g, "").slice(0,18)}`
    : "";

  const darkOverlay = banned
    ? `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}"
        fill="#000000" opacity="0.62"/>`
    : "";

  const cross = banned
    ? `<path
        d="M101 35 L139 73 M139 35 L101 73"
        stroke="${COLORS.primary}"
        stroke-width="8"
        stroke-linecap="round"
        fill="none"/>`
    : "";

  const border = selected
    ? `<rect x="2" y="2"
        width="${CARD_WIDTH - 4}"
        height="${CARD_HEIGHT - 4}"
        rx="5"
        fill="none"
        stroke="${COLORS.success}"
        stroke-width="4"/>`
    : "";

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg"
      width="${CARD_WIDTH}"
      height="${CARD_HEIGHT}">

      ${darkOverlay}

      <rect
        x="0"
        y="${CARD_HEIGHT - 47}"
        width="${CARD_WIDTH}"
        height="47"
        fill="#000000"
        opacity="0.88"
      />

      ${cross}

      ${drawText(
        map,
        12,
        CARD_HEIGHT - 37,
        2,
        COLORS.white,
        CARD_WIDTH - 24
      )}

      ${drawText(
        status + team,
        12,
        CARD_HEIGHT - 16,
        1.5,
        color,
        CARD_WIDTH - 24
      )}

      ${border}
    </svg>
  `);
}

async function generateMapVetoImage(options = {}) {
  const bans = (
    Array.isArray(options.bannedMaps)
      ? options.bannedMaps
      : []
  )
    .map(normalizeBan)
    .filter(Boolean);

  const selectedMap = options.selectedMap || null;

  const cards = await Promise.all(
    MAP_POOL.map(async map => {
      const ban = bans.find(item => item.map === map);
      const selected = selectedMap === map;

      const background = await getBackground(map);
      const overlay = createOverlay(map, ban, selected);

      return sharp(background)
        .composite([
          {
            input: overlay,
            left: 0,
            top: 0
          }
        ])
        .png()
        .toBuffer();
    })
  );

  const composites = cards.map((input, index) => ({
    input,
    left:
      PADDING +
      (index % COLUMNS) * (CARD_WIDTH + GAP),
    top:
      PADDING +
      Math.floor(index / COLUMNS) *
        (CARD_HEIGHT + GAP)
  }));

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

module.exports = {
  MAP_POOL,
  MAP_IMAGES,
  generateMapVetoImage,
  drawText
};

