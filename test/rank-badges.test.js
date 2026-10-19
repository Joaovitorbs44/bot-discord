const test = require('node:test');
const assert = require('node:assert/strict');
const { initialize, badge, rankKey } = require('../src/services/rankBadges');
test('rank badges register once, match Portuguese and English ranks and leave unknown ranks empty', async () => {
  const emojis = new Map();
  emojis.find = predicate => [...emojis.values()].find(predicate);
  let creates = 0;
  const client = {application:{emojis:{fetch:async()=>emojis,create:async({name,attachment})=>{
    assert.ok(Buffer.isBuffer(attachment));
    assert.equal(attachment.subarray(1,4).toString(),'PNG');
    const emoji={name,id:String(++creates)};emojis.set(emoji.id,emoji);return emoji;
  }}}};
  assert.equal(badge('Diamante'),'');
  await initialize(client);
  await initialize(client);
  assert.equal(creates,8);
  assert.match(badge('Campeão'),/^<:invi_rank_champion:\d+> /);
  assert.equal(badge('Campeão'),badge('Champion'));
  assert.equal(badge('Diamante III'),badge('Diamond 3'));
  assert.equal(rankKey('Esmeralda'),'esmeralda');
  assert.equal(badge('Sem rank'),'');
  assert.equal(badge(null),'');
});
