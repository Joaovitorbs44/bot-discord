const test=require("node:test");
const assert=require("node:assert/strict");
const Database=require("better-sqlite3");
const Module=require("node:module");

test("two match results update only their own ten players once, with captain confirmation and dispute resolution",()=>{
 const db=new Database(":memory:");
 const originalLoad=Module._load;
 const resultsPath=require.resolve("../src/scripts/results");
 try{
  db.exec(`
   CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT,season_id INTEGER,status TEXT,winner_team TEXT,result_confirmed_by TEXT,result_confirmed_at TEXT,finished_at TEXT,captain_a_discord_id TEXT,captain_b_discord_id TEXT);
   CREATE TABLE players(id INTEGER PRIMARY KEY,discord_id TEXT UNIQUE,r6_nickname TEXT,r6_rank TEXT,points INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,matches_played INTEGER DEFAULT 0,updated_at TEXT);
   CREATE TABLE match_players(match_id INTEGER,discord_id TEXT,team TEXT);
   CREATE TABLE season_players(season_id INTEGER,player_id INTEGER,points INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,matches_played INTEGER DEFAULT 0,updated_at TEXT,UNIQUE(season_id,player_id));
  `);
  const insertPlayer=db.prepare("INSERT INTO players(id,discord_id,r6_nickname,r6_rank) VALUES(?,?,?,?)");
  const insertMatchPlayer=db.prepare("INSERT INTO match_players VALUES(?,?,?)");
  for(let match=1;match<=2;match++){
   db.prepare("INSERT INTO matches(id,match_code,season_id,status,captain_a_discord_id,captain_b_discord_id) VALUES(?,?,1,?,?,?)")
    .run(match,`#10000${match}`,match===1?"pending_confirmation":"disputed",`p${match}-0`,`p${match}-5`);
   for(let i=0;i<10;i++){
    const id=(match-1)*10+i+1,discord=`p${match}-${i}`;
    insertPlayer.run(id,discord,discord,"ouro");
    insertMatchPlayer.run(match,discord,i<5?"A":"B");
   }
  }
  Module._load=function(request,parent,isMain){
   if(parent?.filename===resultsPath){
    if(request==="../database/database")return db;
    if(request==="../config/config")return {matchmaking:{requiredPlayers:10,teamSize:5,winPoints:5,lossPoints:-3},discord:{}};
    if(request==="../services/seasonService")return {ensurePlayerInSeason:(playerId,seasonId)=>{
     db.prepare("INSERT OR IGNORE INTO season_players(season_id,player_id) VALUES(?,?)").run(seasonId,playerId);
    }};
   }
   return originalLoad.apply(this,arguments);
  };
  delete require.cache[resultsPath];
  const {applyMatchResult}=require(resultsPath);
  Module._load=originalLoad;
  const first=applyMatchResult({matchId:1,winnerTeam:"A",confirmedBy:"p1-5"});
  assert.equal(first.winnerTeam,"A");
  assert.equal(first.players.length,10);
  assert.throws(()=>applyMatchResult({matchId:1,winnerTeam:"B",confirmedBy:"p1-5"}),/RESULT_ALREADY_PROCESSED/);
  const second=applyMatchResult({matchId:2,winnerTeam:"B",confirmedBy:"staff",allowedStatus:"disputed"});
  assert.equal(second.winnerTeam,"B");
  assert.throws(()=>applyMatchResult({matchId:2,winnerTeam:"B",confirmedBy:"staff",allowedStatus:"disputed"}),/RESULT_ALREADY_PROCESSED/);
  const matches=db.prepare("SELECT id,status,winner_team,result_confirmed_by FROM matches ORDER BY id").all();
  assert.deepEqual(matches.map(m=>[m.status,m.winner_team,m.result_confirmed_by]),[
   ["finished","A","p1-5"],["finished","B","staff"]
  ]);
  const rows=db.prepare("SELECT discord_id,points,wins,losses,matches_played FROM players ORDER BY id").all();
  for(let i=0;i<20;i++){
   const winning=(i<5)||(i>=15);
   assert.equal(rows[i].points,winning?5:-3,rows[i].discord_id);
   assert.equal(rows[i].wins,winning?1:0);
   assert.equal(rows[i].losses,winning?0:1);
   assert.equal(rows[i].matches_played,1);
  }
  const season=db.prepare("SELECT SUM(points) AS points,SUM(wins) AS wins,SUM(losses) AS losses,SUM(matches_played) AS played FROM season_players").get();
  assert.deepEqual(season,{points:20,wins:10,losses:10,played:20});
 }finally{
  Module._load=originalLoad;
  delete require.cache[resultsPath];
  db.close();
 }
});
