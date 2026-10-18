const test=require("node:test");
const assert=require("node:assert/strict");
const Database=require("better-sqlite3");
const Module=require("node:module");

test("Discord result controls reject unauthorized captains and staff without mutating results",async()=>{
 const db=new Database(":memory:");
 const originalLoad=Module._load;
 const path=require.resolve("../src/scripts/results");
 try{
  db.exec(`CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT,status TEXT,
   map TEXT,captain_a_discord_id TEXT,captain_b_discord_id TEXT,result_submitted_by TEXT,winner_team TEXT);
  INSERT INTO matches VALUES(1,'#ABC','playing','Bank','captainA','captainB',NULL,NULL);
  INSERT INTO matches VALUES(2,'#DEF','pending_confirmation','Bank','captainA','captainB','captainA','A');
  INSERT INTO matches VALUES(3,'#GHI','disputed','Bank','captainA','captainB','captainA','A');`);
  Module._load=function(request,parent,isMain){
   if(parent?.filename===path){
    if(request==="../database/database")return db;
    if(request==="../config/config")return {matchmaking:{winPoints:5,lossPoints:-3},discord:{staffRoleId:"staff"}};
    if(request==="../services/seasonService")return {ensurePlayerInSeason:()=>{}};
   }
   return originalLoad.apply(this,arguments);
  };
  delete require.cache[path];
  const {handleResultInteraction}=require(path);
  Module._load=originalLoad;
  async function press(customId,userId,staff=false){
   const replies=[];
   const interaction={
    customId,user:{id:userId},inGuild:()=>true,
    member:{roles:{cache:{has:()=>staff}}},
    memberPermissions:{has:()=>false},
    reply:async payload=>{replies.push(payload);return payload;},
    update:async()=>{throw Error("Unauthorized interaction attempted update");}
   };
   await handleResultInteraction(interaction);
   assert.equal(replies.length,1,customId);
   return replies[0].content;
  }
  assert.match(await press("result_report:#ABC","spectator"),/Somente os capitães/);
  assert.match(await press("result_winner:#ABC:A","spectator"),/Somente os capitães/);
  assert.match(await press("result_confirm:#DEF","captainA"),/Somente o outro capitão/);
  assert.match(await press("result_dispute:#DEF","spectator"),/Somente o outro capitão/);
  assert.match(await press("staff_result:#GHI:B","spectator"),/não possui permissão/);
  assert.match(await press("staff_cancel:#GHI","spectator"),/não possui permissão/);
  assert.deepEqual(db.prepare("SELECT status,winner_team FROM matches ORDER BY id").all(),[
   {status:"playing",winner_team:null},
   {status:"pending_confirmation",winner_team:"A"},
   {status:"disputed",winner_team:"A"}
  ]);
 }finally{
  Module._load=originalLoad;
  delete require.cache[path];
  db.close();
 }
});
