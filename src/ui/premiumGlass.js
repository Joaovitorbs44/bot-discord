"use strict";

/**
 * INVI SIX PRO V2 — Premium Glass
 *
 * Discord Components V2 do not support CSS, custom fonts, backdrop-filter,
 * translucent backgrounds or arbitrary gradients. This theme keeps text and
 * buttons native and accessible. Future optional image headers can be
 * rendered separately without changing interaction IDs or game state.
 */
const COLORS = Object.freeze({
  primary: 0xFF3D2C,
  success: 0x278451,
  danger: 0xD74747,
  warning: 0xE9A23B,
  neutral: 0x242B38,
  background: 0x171C26,
  muted: 0x8995A7
});

const LABELS = Object.freeze({
  brand: "INVI SIX PRO",
  tagline: "COMPETITIVE EXPERIENCE",
  queue: "MATCHMAKING / FILA 5V5",
  ready: "MATCHMAKING / READY CHECK",
  captains: "MATCHMAKING / CAPITÃES",
  draft: "MATCHMAKING / DRAFT",
  veto: "MATCHMAKING / VETO DE MAPAS",
  sides: "MATCHMAKING / ESCOLHA DE LADOS",
  match: "PARTIDA COMPETITIVA",
  result: "RESULTADO DA PARTIDA",
  profile: "PERFIL COMPETITIVO",
  ranking: "RANKING COMPETITIVO",
  history: "HISTÓRICO DE PARTIDAS",
  staff: "CENTRAL DA STAFF"
});

function header(section, subtitle = "") {
  return "## " + LABELS.brand + "\n-# " + section +
    (subtitle ? "  /  " + safe(subtitle, 80) : "");
}

function safe(value, limit = 100) {
  return String(value ?? "—")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .slice(0, limit);
}

module.exports = { COLORS, LABELS, header, safe };
