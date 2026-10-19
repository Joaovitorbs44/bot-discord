const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { MessageFlags } = require('discord.js');
test('public ranking opens a private page and subsequent clicks edit only the private message', async () => {
  const filename = require.resolve('../src/scripts/ranking');
  const original = Module._load;
  let handleRankingPage;
  try {
    Module._load = function(request,parent) {
      if (parent?.filename===filename) {
        if(request==='../database/database')return {prepare:()=>({get:()=>({total:30}),all:()=>[]})};
        if(request==='../services/competitiveStats')return {activeSeason:()=>({id:1,name:'Temporada'}),safe:String};
      }
      return original.apply(this,arguments);
    };
    delete require.cache[filename];
    ({handleRankingPage}=require(filename));
  } finally {Module._load=original;}
  try {
    const events=[];
    const interaction={customId:'ranking_page:1',message:{flags:{has:()=>false}},
      reply:async payload=>events.push(['reply',payload]),update:async payload=>events.push(['update',payload])};
    await handleRankingPage(interaction);
    assert.equal(events[0][0],'reply');
    assert.ok(events[0][1].flags & MessageFlags.Ephemeral);
    assert.ok(events[0][1].flags & MessageFlags.IsComponentsV2);
    assert.match(JSON.stringify(events[0][1].components),/2\/3/);
    await handleRankingPage({...interaction,customId:'ranking_page:2',message:{flags:{has:flag=>flag===MessageFlags.Ephemeral}}});
    assert.equal(events[1][0],'update');
    assert.match(JSON.stringify(events[1][1].components),/3\/3/);
    await handleRankingPage({...interaction,customId:'ranking_page:bad'});
    assert.equal(events[2][0],'reply');
    assert.equal(events[2][1].flags,MessageFlags.Ephemeral);
    assert.equal(events.length,3);
  } finally {delete require.cache[filename];}
});
