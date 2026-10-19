// Application emojis belong to this bot and do not consume server emoji slots.
const assets = require('../assets/rankBadges.json');
const badges = new Map();
function rankKey(rank) {
  const value = String(rank || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const aliases = { copper:'cobre', bronze:'bronze', silver:'prata', gold:'ouro', platinum:'platina', emerald:'esmeralda', diamond:'diamante', champion:'champion', campeao:'champion' };
  const word = value.split(/[\s_-]/)[0];
  return Object.hasOwn(assets, word) ? word : aliases[word] || null;
}
function badge(rank) { return badges.get(rankKey(rank)) || ''; }
function playerBadge(discordId) {
  try {
    const db = require('../database/database');
    return badge(db.prepare('SELECT r6_rank FROM players WHERE discord_id=?').get(discordId)?.r6_rank);
  } catch { return ''; }
}
async function initialize(client) {
  const manager = client.application.emojis;
  const existing = await manager.fetch();
  for (const [key, image] of Object.entries(assets)) {
    const name = 'invi_rank_' + key;
    try {
      const emoji = existing.find(item => item.name === name) || await manager.create({ name, attachment: Buffer.from(image, 'base64') });
      badges.set(key, `<:${name}:${emoji.id}> `);
    } catch (error) {
      console.error('[RANK BADGES] Falha ao registrar', key, error.code || error.message);
    }
  }
  console.log(`[RANK BADGES] ${badges.size}/8 badges disponíveis.`);
}
module.exports = { initialize, badge, playerBadge, rankKey };
