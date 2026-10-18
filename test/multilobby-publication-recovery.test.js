const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");
const Database=require("better-sqlite3");

test("recovers two unpublished matches and preserves result buttons without duplicate posts",async()=>{
 const db=new Database(":memory:");
 const originalLoad=Module._load;
 const matchPath=require.resolve("../src/scripts/match");
 try{
  db.exec(`
    CREATE TABLE seasons(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT,map TEXT,side_a TEXT,side_b TEXT,captain_a_discord_id TEXT,captain_b_discord_id TEXT,season_id INTEGER,status TEXT);
    CREATE TABLE matchmaking_sessions(id INTEGER PRIMARY KEY,status TEXT,match_id INTEGER,state_json TEXT,updated_at INTEGER);
  `);
  db.prepare("INSERT INTO seasons VALUES(1,'Temporada de testes')").run();
  const addMatch=db.prepare("INSERT INTO matches VALUES(?,?,?,?,?,?,?,?,?)");
  const addSession=db.prepare("INSERT INTO matchmaking_sessions(id,status,match_id,state_json) VALUES(?,'completed',?,?)");
  for(let lobby=1;lobby<=2;lobby++){
   const teamA=Array.from({length:5},(_,i)=>({discordId:`a${lobby}-${i}`,nickname:`A${i}`}));
   const teamB=Array.from({length:5},(_,i)=>({discordId:`b${lobby}-${i}`,nickname:`B${i}`}));
   addMatch.run(lobby,`#12345${lobby}`,"Bank","Ataque","Defesa",teamA[0].discordId,teamB[0].discordId,1,"playing");
   addSession.run(lobby,lobby,JSON.stringify({sideChoice:{
    captainA:{discordId:teamA[0].discordId},captainB:{discordId:teamB[0].discordId},teamA,teamB
   }}));
  }
  Module._load=function(request,parent,isMain){
   if(parent?.filename===matchPath){
    if(request==="../database/database")return db;
    if(request==="../config/config")return {discord:{resultsChannelId:"results"},matchmaking:{teamSize:5,requiredPlayers:10}};
    if(request==="../services/seasonService")return {refreshSeason:()=>({season:{id:1,name:"Temporada de testes"}})};
    if(request==="./queueState")return {};
   }
   return originalLoad.apply(this,arguments);
  };
  delete require.cache[matchPath];
  const {restoreMatchPublications}=require(matchPath);
  Module._load=originalLoad;
  const messages=new Map();
  const sent=[];
  const channel={
   id:"results",isTextBased:()=>true,
   messages:{fetch:async arg=>typeof arg==="string"
    ? (messages.has(arg)?messages.get(arg):Promise.reject(Object.assign(new Error("Unknown Message"),{code:10008})))
    : {find:predicate=>[...messages.values()].find(predicate)}},
   send:async payload=>{
    const id=`msg-${sent.length+1}`;
    const message={id,components:payload.components,author:{id:"bot"}};
    messages.set(id,message);
    sent.push(payload);
    return message;
   }
  };
  const client={user:{id:"bot"},channels:{fetch:async()=>channel}};
  await restoreMatchPublications(client);
  assert.equal(sent.length,2);
  assert.equal(messages.size,2);
  for(let i=1;i<=2;i++){
   const state=JSON.parse(db.prepare("SELECT state_json FROM matchmaking_sessions WHERE id=?").get(i).state_json);
   assert.equal(state.resultMessageId,`msg-${3-i}`);
   assert.equal(state.resultChannelId,"results");
   const button=sent[2-i].components[1].components[0].toJSON();
   assert.equal(button.custom_id,`result_report:#12345${i}`);
  }
  await restoreMatchPublications(client);
  assert.equal(sent.length,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM matches").get().n,2);
 }finally{
  Module._load=originalLoad;
  delete require.cache[matchPath];
  db.close();
 }
});
