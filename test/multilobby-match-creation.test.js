const test=require("node:test");
const assert=require("node:assert/strict");
const Database=require("better-sqlite3");
const Module=require("node:module");

test("two concurrent sessions create exactly two matches, survive repeated creation and publish once",async()=>{
 const db=new Database(":memory:");
 try{
  db.exec(`
   CREATE TABLE matchmaking_sessions(id INTEGER PRIMARY KEY,guild_id TEXT,stage TEXT,status TEXT,state_json TEXT,match_id INTEGER,updated_at INTEGER,deadline_at INTEGER,current_turn_discord_id TEXT,captain_a_discord_id TEXT,captain_b_discord_id TEXT);
   CREATE TABLE matchmaking_session_players(id INTEGER PRIMARY KEY,session_id INTEGER,discord_id TEXT,team TEXT,is_captain INTEGER,joined_at INTEGER);
   CREATE TABLE players(discord_id TEXT PRIMARY KEY,r6_nickname TEXT);
   CREATE TABLE seasons(id INTEGER PRIMARY KEY,name TEXT);
   CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT UNIQUE,season_id INTEGER,map TEXT,captain_a_discord_id TEXT,captain_b_discord_id TEXT,side_a TEXT,side_b TEXT,status TEXT);
   CREATE TABLE match_players(match_id INTEGER,discord_id TEXT,team TEXT,is_captain INTEGER,UNIQUE(match_id,discord_id));
  `);
  db.prepare("INSERT INTO seasons(id,name) VALUES(1,'Season 1')").run();
  const insertSession=db.prepare("INSERT INTO matchmaking_sessions(id,guild_id,stage,status,state_json,captain_a_discord_id,captain_b_discord_id) VALUES(?,'guild','side_choice','active',?,?,?)");
  const insertPlayer=db.prepare("INSERT INTO matchmaking_session_players(session_id,discord_id,team,is_captain,joined_at) VALUES(?,?,?,?,?)");
  for(let lobby=1;lobby<=2;lobby++){
   const players=Array.from({length:10},(_,i)=>`l${lobby}p${i}`);
   insertSession.run(lobby,JSON.stringify({selectedMap:"Bank",sideA:lobby===1?"Ataque":"Defesa",sideB:lobby===1?"Defesa":"Ataque"}),players[0],players[5]);
   players.forEach((id,i)=>insertPlayer.run(lobby,id,i<5?"A":"B",Number(i===0||i===5),i));
  }
  let sequence=0;
  const published=[];
  const originalLoad=Module._load;
  const path=require.resolve("../src/services/matchCreationSessions");
  delete require.cache[path];
  Module._load=function(request,parent,isMain){
   if(parent?.filename===path){
    if(request==="../database/database")return db;
    if(request==="./seasonService")return {refreshSeason:()=>({season:{id:1,name:"Season 1"}})};
    if(request==="../scripts/match")return {
     generateMatchCode:()=>`#${String(++sequence).padStart(6,"0")}`,
     validateMatchData:data=>{
      assert.equal(data.teamA.length,5);
      assert.equal(data.teamB.length,5);
      assert.notEqual(data.captainA.discordId,data.captainB.discordId);
     },
     publishMatch:async(client,result,data,season,id)=>published.push({id,matchId:result.matchId,season:season.id})
    };
   }
   if(request==="../database/database"&&parent?.filename?.includes("/src/services/"))return db;
   return originalLoad.apply(this,arguments);
  };
  let creator;
  try{creator=require(path);}finally{Module._load=originalLoad;}
  const a=creator.create(1),b=creator.create(2);
  assert.notEqual(a.matchId,b.matchId);
  assert.equal(a.alreadyCreated,false);
  assert.equal(b.alreadyCreated,false);
  assert.equal(creator.create(1).matchId,a.matchId);
  assert.equal(creator.create(2).alreadyCreated,true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM matches").get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM match_players").get().n,20);
  assert.deepEqual(db.prepare("SELECT match_id FROM matchmaking_sessions ORDER BY id").all().map(x=>x.match_id),[a.matchId,b.matchId]);
  await creator.createAndPublish({},1);
  await creator.createAndPublish({},2);
  assert.deepEqual(published.map(x=>x.id),[1,2]);
  assert.deepEqual(published.map(x=>x.season),[1,1]);
 }finally{db.close();}
});
