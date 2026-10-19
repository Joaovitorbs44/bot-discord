const test=require('node:test');
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const Module=require('node:module');
function load(file,mocks){const original=Module._load;try{Module._load=function(request,parent){if(parent?.filename===file&&Object.hasOwn(mocks,request))return mocks[request];return original.apply(this,arguments);};delete require.cache[file];return require(file);}finally{Module._load=original;}}
test('situation reads queue position, active stages, pending result and unexpired penalty without creating sessions',()=>{
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE players(discord_id TEXT,access_active INTEGER,is_banned INTEGER);
 CREATE TABLE player_cooldowns(discord_id TEXT,reason TEXT,expires_at INTEGER);
 CREATE TABLE matches(id INTEGER,match_code TEXT,map TEXT,status TEXT);
 CREATE TABLE match_players(match_id INTEGER,discord_id TEXT);
 CREATE TABLE matchmaking_sessions(id INTEGER,guild_id TEXT,status TEXT,stage TEXT);
 CREATE TABLE matchmaking_session_players(id INTEGER,session_id INTEGER,discord_id TEXT,ready_confirmed INTEGER,joined_at INTEGER);
 INSERT INTO players VALUES('p',1,0);
 INSERT INTO player_cooldowns VALUES('p','Não confirmou',2000);
 INSERT INTO matchmaking_sessions VALUES(1,'g','active','queue');
 INSERT INTO matchmaking_session_players VALUES(1,1,'a',0,1),(2,1,'p',0,2);`);
 const file=require.resolve('../src/services/playerSituation'),old=process.env.MULTILOBBY_QUEUE_ENABLED;
 process.env.MULTILOBBY_QUEUE_ENABLED='false';
 const {snapshot}=load(file,{'../database/database':db});
 try{
  let s=snapshot('g','p',1000);assert.equal(s.position,2);assert.equal(s.total,2);assert.equal(s.penalty.expires_at,2000);
  assert.equal(snapshot('g','p',2000).penalty,null);
  assert.equal(snapshot('other','p',1000).session,null);
  db.prepare("UPDATE matchmaking_sessions SET stage='ready_check'").run();
  s=snapshot('g','p',1000);assert.equal(s.position,null);assert.equal(s.session.ready_confirmed,0);
  db.exec("INSERT INTO matches VALUES(1,'#1','Bank','pending_confirmation'); INSERT INTO match_players VALUES(1,'p');");
  assert.equal(snapshot('g','p',1000).match.status,'pending_confirmation');
  db.exec("UPDATE matches SET status='finished';");assert.equal(snapshot('g','p',1000).match,null);
  db.exec("CREATE TABLE matchmaking_waiting_players(guild_id TEXT,discord_id TEXT,joined_at INTEGER); INSERT INTO matchmaking_waiting_players VALUES('g','p',1);");
  process.env.MULTILOBBY_QUEUE_ENABLED='true';assert.equal(snapshot('g','p',1000).position,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matchmaking_sessions').get().n,1);
 }finally{delete require.cache[file];db.close();if(old===undefined)delete process.env.MULTILOBBY_QUEUE_ENABLED;else process.env.MULTILOBBY_QUEUE_ENABLED=old;}
});
test('situation commands and refresh stay private and link pending presence to its channel',async()=>{
 const file=require.resolve('../src/scripts/situation');
 const guild='100000000000000001',draft='100000000000000002',queue='100000000000000003';
 let state={player:{access_active:1,is_banned:0},penalty:null,match:null,session:{id:7,stage:'ready_check',ready_confirmed:0,state_json:'{}'},position:null};
 const {handle}=load(file,{'../config/config':{discord:{guildId:guild,draftChannelId:draft,queueChannelId:queue}},'../services/playerSituation':{snapshot:()=>state},'../services/competitiveStats':{safe:String}});
 try{
  const events=[];
  const i={guildId:guild,user:{id:'p'},inGuild:()=>true,isChatInputCommand:()=>true,commandName:'situacao',reply:async p=>events.push(['reply',p]),update:async p=>events.push(['update',p])};
  await handle(i);assert.equal(events[0][1].flags,64);
  let rendered=JSON.stringify(events[0][1]);assert.match(rendered,/Presença pendente/);assert.match(rendered,new RegExp(draft));
  state={...state,session:{...state.session,ready_confirmed:1}};
  await handle({...i,commandName:null,isChatInputCommand:()=>false,customId:'my_situation:refresh',message:{flags:{has:()=>true}}});
  assert.equal(events[1][0],'update');assert.match(JSON.stringify(events[1][1]),/Presença confirmada/);
  await handle({...i,guildId:'other'});assert.match(events[2][1].content,/servidor/);
 }finally{delete require.cache[file];}
});
