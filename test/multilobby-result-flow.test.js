const test=require("node:test");
const assert=require("node:assert/strict");
const Database=require("better-sqlite3");
const Module=require("node:module");

test("Discord captain confirmation, dispute, staff decision and duplicate clicks",async()=>{
 const db=new Database(":memory:");
 const originalLoad=Module._load;
 const path=require.resolve("../src/scripts/results");
 try{
  db.exec(`
   CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT UNIQUE,season_id INTEGER,status TEXT,map TEXT,
    captain_a_discord_id TEXT,captain_b_discord_id TEXT,result_submitted_by TEXT,result_submitted_at TEXT,
    winner_team TEXT,result_confirmed_by TEXT,result_confirmed_at TEXT,finished_at TEXT);
   CREATE TABLE players(id INTEGER PRIMARY KEY,discord_id TEXT UNIQUE,r6_nickname TEXT,r6_rank TEXT,
    points INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,matches_played INTEGER DEFAULT 0,updated_at TEXT);
   CREATE TABLE match_players(match_id INTEGER,discord_id TEXT,team TEXT);
   CREATE TABLE season_players(season_id INTEGER,player_id INTEGER,points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,matches_played INTEGER DEFAULT 0,updated_at TEXT,UNIQUE(season_id,player_id));
   CREATE TABLE staff_actions(staff_discord_id TEXT,action_type TEXT,match_id INTEGER,reason TEXT,details_json TEXT,created_at INTEGER);
  `);
  for(let m=1;m<=2;m++){
   db.prepare("INSERT INTO matches(id,match_code,season_id,status,map,captain_a_discord_id,captain_b_discord_id) VALUES(?,?,1,'playing','Bank',?,?)")
    .run(m,`#TEST${m}`,`p${m}-0`,`p${m}-5`);
   for(let i=0;i<10;i++){
    const id=(m-1)*10+i+1,discord=`p${m}-${i}`;
    db.prepare("INSERT INTO players(id,discord_id,r6_nickname,r6_rank) VALUES(?,?,?,'Gold')").run(id,discord,discord);
    db.prepare("INSERT INTO match_players VALUES(?,?,?)").run(m,discord,i<5?"A":"B");
   }
  }
  Module._load=function(request,parent,isMain){
   if(parent?.filename===path){
    if(request==="../database/database")return db;
    if(request==="../config/config")return {matchmaking:{requiredPlayers:10,teamSize:5,winPoints:5,lossPoints:-3},discord:{staffRoleId:"staff",staffChannelId:"staff-channel"}};
    if(request==="../services/seasonService")return {ensurePlayerInSeason:(id,season)=>{
     db.prepare("INSERT OR IGNORE INTO season_players(season_id,player_id) VALUES(?,?)").run(season,id);
    }};
   }
   return originalLoad.apply(this,arguments);
  };
  delete require.cache[path];
  const {handleResultInteraction}=require(path);
  Module._load=originalLoad;
  const publicMessages=[];
  const staffMessages=[];
  const channel={send:async payload=>{publicMessages.push(payload);return payload;}};
  const staffChannel={isTextBased:()=>true,send:async payload=>{staffMessages.push(payload);return payload;}};
  const client={channels:{fetch:async id=>id==="staff-channel"?staffChannel:null}};
  async function press(customId,userId,staff=false){
   const actions=[];
   const interaction={
    customId,user:{id:userId},channel,client,inGuild:()=>true,
    member:{roles:{cache:{has:id=>staff&&id==="staff"}}},
    memberPermissions:{has:()=>false},
    reply:async payload=>{actions.push({kind:"reply",payload});return payload;},
    update:async payload=>{actions.push({kind:"update",payload});return payload;},
    followUp:async payload=>{actions.push({kind:"followUp",payload});return payload;}
   };
   await handleResultInteraction(interaction);
   return actions;
  }
  const report = (await press("result_report:#TEST1","p1-0"))[0];
  assert.equal(report.kind,"reply");
  const labels=JSON.stringify(report.payload);
  assert.match(labels,/Time p1-0 venceu/);
  assert.match(labels,/Time p1-5 venceu/);
  assert.match(labels,/result_winner:#TEST1:A/);
  assert.match(labels,/result_winner:#TEST1:B/);
  assert.doesNotMatch(labels,/Time A venceu|Time B venceu/);
  assert.equal((await press("result_winner:#TEST1:A","p1-0"))[0].kind,"update");
  assert.equal(publicMessages.length,1);
  assert.equal(db.prepare("SELECT status FROM matches WHERE id=1").get().status,"pending_confirmation");
  assert.equal((await press("result_confirm:#TEST1","p1-5"))[0].kind,"update");
  assert.equal(db.prepare("SELECT status FROM matches WHERE id=1").get().status,"finished");
  assert.match((await press("result_confirm:#TEST1","p1-5"))[0].payload.content,/finalizada/);
  assert.equal((await press("result_winner:#TEST2:B","p2-0"))[0].kind,"update");
  assert.equal((await press("result_dispute:#TEST2","p2-5"))[0].kind,"update");
  assert.equal(db.prepare("SELECT status FROM matches WHERE id=2").get().status,"disputed");
  assert.equal(staffMessages.length,1);
  assert.equal((await press("staff_result:#TEST2:B","moderator",true))[0].kind,"update");
  assert.equal(db.prepare("SELECT status FROM matches WHERE id=2").get().status,"finished");
  assert.match((await press("staff_result:#TEST2:B","moderator",true))[0].payload.content,/finalizada/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM staff_actions").get().n,1);
  const players=db.prepare("SELECT points,wins,losses,matches_played FROM players ORDER BY id").all();
  players.forEach((p,i)=>{
   const winner=i<5||i>=15;
   assert.deepEqual(p,{points:winner?5:-3,wins:winner?1:0,losses:winner?0:1,matches_played:1});
  });
  assert.equal(db.prepare("SELECT SUM(matches_played) AS n FROM season_players").get().n,20);
 }finally{
  Module._load=originalLoad;
  delete require.cache[path];
  db.close();
 }
});

