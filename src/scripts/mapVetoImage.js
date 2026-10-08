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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeBan(item) {
  return typeof item === "string"
    ? { map: item }
    : item;
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

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !response.ok ||
      !contentType.startsWith("image/")
    ) {
      throw new Error(
        "HTTP " + response.status
      );
    }

    buffer = await sharp(
      Buffer.from(await response.arrayBuffer())
    )
      .resize(CARD_WIDTH, CARD_HEIGHT, {
        fit: "cover"
      })
      .png()
      .toBuffer();

  } catch (error) {
    console.warn(
      "[mapVetoImage] " +
      map +
      ": " +
      error.message
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

async function generateMapVetoImage(options = {}) {
  const bans = (
    Array.isArray(options.bannedMaps)
      ? options.bannedMaps
      : []
  )
    .map(normalizeBan)
    .filter(Boolean);

  const selectedMap =
    options.selectedMap || null;

  const cards = await Promise.all(
    MAP_POOL.map(async map => {
      const ban = bans.find(
        item => item.map === map
      );

      const selected =
        map === selectedMap;

      const banned =
        Boolean(ban) && !selected;

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

      const team =
        banned && (ban.captainTeam || ban.team)
          ? " - TIME " +
            String(
              ban.captainTeam || ban.team
            ).replace(/[^a-zA-Z0-9]/g, "")
          : "";

      const overlay = `
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="${CARD_WIDTH}"
          height="${CARD_HEIGHT}"
        >
          ${
            banned
              ? `
                <rect
                  width="100%"
                  height="100%"
                  fill="#000"
                  opacity="0.62"
                />
              `
              : ""
          }

          <rect
            x="0"
            y="${CARD_HEIGHT - 47}"
            width="${CARD_WIDTH}"
            height="47"
            fill="#000"
            opacity="0.88"
          />

          ${
            banned
              ? `
                <path
                  d="
                    M${CARD_WIDTH / 2 - 19} 35
                    l38 38
                    m0 -38
                    l-38 38
                  "
                  fill="none"
                  stroke="${COLORS.primary}"
                  stroke-width="8"
                  stroke-linecap="round"
                />
              `
              : ""
          }

          <text
            x="12"
            y="${CARD_HEIGHT - 26}"
            font-family="DejaVu Sans, sans-serif"
            font-size="15"
            font-weight="bold"
            fill="white"
          >${escapeXml(map)}</text>

          <text
            x="12"
            y="${CARD_HEIGHT - 10}"
            font-family="DejaVu Sans, sans-serif"
            font-size="11"
            font-weight="bold"
            fill="${color}"
          >${escapeXml(status + team)}</text>

          ${
            selected
              ? `
                <rect
                  x="2"
                  y="2"
                  width="${CARD_WIDTH - 4}"
                  height="${CARD_HEIGHT - 4}"
                  rx="5"
                  fill="none"
                  stroke="${COLORS.success}"
                  stroke-width="4"
                />
              `
              : ""
          }
        </svg>
      `;

      return sharp(
        await getBackground(map)
      )
        .composite([
          {
            input: Buffer.from(overlay),
            left: 0,
            top: 0
          }
        ])
        .png()
        .toBuffer();
    })
  );

  const composites = cards.map(
    (input, index) => ({
      input,
      left:
        PADDING +
        (index % COLUMNS) *
          (CARD_WIDTH + GAP),
      top:
        PADDING +
        Math.floor(index / COLUMNS) *
          (CARD_HEIGHT + GAP)
    })
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

module.exports = {
  MAP_POOL,
  MAP_IMAGES,
  generateMapVetoImage
};
