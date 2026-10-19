const test=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3'),Module=require('node:module');
function load(path,mocks){const file=require.resolve(path),old=Module._load;try{Module._load=function(r,p){if(p?.filename===file&&Object.hasOwn(mocks,r))return mocks[r];return old.apply(this,arguments);};delete require.cache[file];return require(file);}finally{Module._load=old;}}
function fixture(){
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');
 db.exec(`CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT,status TEXT,winner_team TEXT,result_confirmed_by TEXT,result_confirmed_at TEXT,finished_at TEXT);
 CREATE TABLE players(discord_id TEXT PRIMARY KEY,access_active INTEGER,is_banned INTEGER,r6_nickname TEXT);
 CREATE TABLE player_cooldowns(discord_id TEXT PRIMARY KEY,reason TEXT,expires_at INTEGER);
 CREATE TABLE match_players(match_id INTEGER,discord_id TEXT);
 CREATE TABLE player_match_stats(match_id INTEGER,discord_id TEXT,kills INTEGER,deaths INTEGER);
 CREATE TABLE matchmaking_sessions(id INTEGER PRIMARY KEY,guild_id TEXT,status TEXT,stage TEXT,deadline_at INTEGER,updated_at INTEGER,match_id INTEGER,captain_a_discord_id TEXT,captain_b_discord_id TEXT);
 CREATE TABLE matchmaking_session_players(id INTEGER PRIMARY KEY,session_id INTEGER,discord_id TEXT,team TEXT,ready_confirmed INTEGER DEFAULT 0,joined_at INTEGER DEFAULT 0,UNIQUE(session_id,discord_id));
 CREATE TABLE matchmaking_actions(id INTEGER PRIMARY KEY,session_id INTEGER,action_type TEXT,details_json TEXT);
 INSERT INTO matchmaking_sessions VALUES(1,'100000000000000001','active','ready_check',1,0,NULL,'p0','p5');
 INSERT INTO matches(id,match_code,status) VALUES(1,'#1','playing');`);
 for(let n=0;n<14;n++){
  db.prepare('INSERT INTO players VALUES(?,1,0,?)').run('p'+n,'nick'+n);
  if(n<10){db.prepare('INSERT INTO matchmaking_session_players(session_id,discord_id,team,ready_confirmed,joined_at) VALUES(1,?,?,?,?)').run('p'+n,n<5?'A':'B',n<9?1:0,n);db.prepare('INSERT INTO match_players VALUES(1,?)').run('p'+n);}
 }
 // A pre-match roster is not yet in a real match for reserve eligibility.
 db.prepare("UPDATE matches SET status='finished' WHERE id=1").run();
 const store=load('../src/services/lobbyExtrasStore',{'../database/database':db});store.initialize();store.initialize();
 return {db,store,close:()=>db.close()};
}
test('reserve handoff preserves nine confirmations, requires fresh acceptance, revalidates candidates and is atomic',()=>{
 const f=fixture();try{
  assert.throws(()=>f.store.joinReserve('100000000000000001','p0'),/saia da fila/);
  assert.equal(f.store.joinReserve('100000000000000001','p10'),1);
  assert.equal(f.store.joinReserve('100000000000000001','p10'),1);
  f.store.joinReserve('100000000000000001','p11');
  f.db.prepare('INSERT INTO player_cooldowns VALUES(?,?,?)').run('p10','penalty',Date.now()+60000);
  assert.throws(()=>f.store.replaceAbsent(1,60,()=>{throw Error('penalty failed');}),/penalty failed/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM matchmaking_session_players').get().n,10);
  let penalized=0;const result=f.store.replaceAbsent(1,60,()=>penalized++);
  assert.deepEqual(result.called,['p11']);assert.deepEqual(result.removed,['p9']);assert.equal(penalized,1);
  assert.equal(f.db.prepare('SELECT SUM(ready_confirmed) n FROM matchmaking_session_players').get().n,9);
  assert.equal(f.db.prepare("SELECT ready_confirmed FROM matchmaking_session_players WHERE discord_id='p11'").get().ready_confirmed,0);
  assert.equal(f.store.replaceAbsent(1,60),null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM matchmaking_actions').get().n,1);
  // An expired next round without eligible reserves leaves the roster untouched for the existing fallback.
  f.db.prepare('UPDATE matchmaking_sessions SET deadline_at=1').run();assert.equal(f.store.replaceAbsent(1,60),null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM matchmaking_session_players').get().n,10);
 }finally{f.close();}
});
test('cancel request requires a participant, is pending until staff decides, and cannot race a finished result',()=>{
 const f=fixture();try{
  f.db.prepare("UPDATE matches SET status='playing' WHERE id=1").run();
  assert.throws(()=>f.store.requestCancel(1,'outsider','Jogador desconectado'),/participar/);
  const r=f.store.requestCancel(1,'p0','Jogador desconectado');
  assert.equal(f.db.prepare('SELECT status FROM matches').get().status,'playing');
  assert.throws(()=>f.store.requestCancel(1,'p1','Pedido repetido aqui'),/aguardando/);
  f.db.prepare("UPDATE matches SET status='finished',winner_team='A'").run();
  assert.throws(()=>f.store.decide(r.id,'staff',true,'Conferido pela staff'),/resultado mudou/i);
  assert.equal(f.store.cancellation(r.id).status,'pending');
  f.store.decide(r.id,'staff',false,'Resultado confirmado');
  assert.equal(f.store.cancellation(r.id).status,'rejected');
  assert.throws(()=>f.store.decide(r.id,'staff',true,'Conferido pela staff'),/decidido/);
  f.db.prepare("UPDATE matches SET status='playing',winner_team=NULL").run();
  f.db.prepare("UPDATE matchmaking_sessions SET match_id=1,stage='playing',status='completed'").run();
  const r2=f.store.requestCancel(1,'p0','Partida sem jogadores');
  f.store.decide(r2.id,'staff2',true,'Cancelado após conferir');
  assert.equal(f.db.prepare('SELECT status FROM matches').get().status,'cancelled');
  assert.equal(f.db.prepare('SELECT status FROM matchmaking_sessions').get().status,'cancelled');
  assert.equal(f.store.cancellation(r2.id).reviewed_by,'staff2');
 }finally{f.close();}
});
test('fixed voice rooms move connected teammates, never create or delete channels, and prevent two lobbies sharing the pair',async()=>{
 const f=fixture();const {ChannelType}=require('discord.js');
 try{
  f.db.prepare("UPDATE matchmaking_sessions SET stage='map_veto'").run();
  const moves=[],channels=new Map();let allowed=false;
  const members=new Map(Array.from({length:10},(_,n)=>['p'+n,{voice:{channelId:n%2?'current':null,setChannel:async c=>moves.push(['p'+n,c.id])}}]));
  const guild={id:'100000000000000001',members:{fetchMe:async()=>({}),fetch:async id=>members.get(id)},channels:{fetch:async id=>channels.get(id),create:async()=>{throw Error('must never create');}}};
  for(const id of ['1555960315835842600','1555960732234027170'])channels.set(id,{id,guildId:guild.id,type:ChannelType.GuildVoice,permissionsFor:()=>({has:()=>allowed}),delete:async()=>{throw Error('must never delete');}});
  const client={guilds:{fetch:async()=>guild}};
  const voice=load('../src/services/teamVoice',{'../database/database':f.db,'../config/config':{discord:{guildId:guild.id}}});
  await assert.rejects(voice.ensure(client,1),/Mover membros/);assert.equal(moves.length,0);
  allowed=true;
  const result=await voice.ensure(client,1);assert.equal(moves.length,5);
  assert.equal(result[0].channelId,'1555960315835842600');assert.equal(result[1].channelId,'1555960732234027170');
  assert.deepEqual(moves.map(([id,room])=>[id,room]),[['p1','1555960315835842600'],['p3','1555960315835842600'],['p5','1555960732234027170'],['p7','1555960732234027170'],['p9','1555960732234027170']]);
  for(const m of members.values())m.voice.channelId=null;
  await voice.ensure(client,1);assert.equal(moves.length,5);
  f.db.exec("INSERT INTO matchmaking_sessions VALUES(2,'100000000000000001','active','map_veto',NULL,0,NULL,'p0','p5'); INSERT INTO matchmaking_session_players(session_id,discord_id,team,ready_confirmed,joined_at) SELECT 2,discord_id,team,ready_confirmed,joined_at FROM matchmaking_session_players WHERE session_id=1;");
  await assert.rejects(voice.ensure(client,2),/outro lobby/);assert.equal(moves.length,5);
  f.db.prepare("UPDATE matchmaking_sessions SET match_id=1,status='completed',stage='playing' WHERE id=1").run();
  await voice.cleanup(client);assert.equal(channels.size,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM lobby_voice_channels').get().n,0);
  await voice.ensure(client,2,false);assert.equal(moves.length,5);assert.equal(channels.size,2);
 }finally{f.close();}
});
test('staff cancellation controls reject players before exposing requests or decisions',async()=>{
 let reads=0,decisions=0,modal;
 const module=load('../src/scripts/lobbyExtras',{
  '../database/database':{},'../config/config':{discord:{guildId:'guild'}},
  '../services/lobbyExtrasStore':{cancellation:()=>{reads++;return {id:1,status:'pending'};},cancellations:()=>[],decide:()=>{decisions++;}},
  './scoreboards':{staffAccess:i=>i.staff===true},'../services/competitiveStats':{safe:String}
 });
 const responses=[];
 const i={customId:'cancelreq:approve:1',inGuild:()=>true,guildId:'guild',user:{id:'p'},isButton:()=>true,isModalSubmit:()=>false,isChatInputCommand:()=>false,reply:async p=>responses.push(p),showModal:async m=>{modal=m.toJSON();}};
 await module.handle(i);assert.equal(reads,0);assert.equal(decisions,0);assert.match(responses[0].content,/exclusiva/);assert.equal(responses[0].flags,64);
 await module.handle({...i,staff:true});assert.equal(reads,1);assert.equal(modal.custom_id,'cancelreq:confirm:1');assert.equal(modal.components[0].components[0].required,true);
 await module.handle({...i,staff:true,guildId:'other'});assert.equal(reads,1);assert.equal(decisions,0);
 for(const command of module.commands)assert.ok(command.toJSON().name);
});
