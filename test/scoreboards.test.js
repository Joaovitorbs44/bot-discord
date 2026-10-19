const test=require("node:test");
const assert=require("node:assert/strict");
const Database=require("better-sqlite3");
const Module=require("node:module");
const {matchRows,similarity,lines}=require("../src/services/scoreboardOcr");

test("OCR leaves ambiguous names and incomplete numeric rows for manual review",()=>{
 const roster=[{discord_id:"a",r6_nickname:"player1"},{discord_id:"b",r6_nickname:"player2"}];
 assert.deepEqual(matchRows([{text:"player",y:10}],[{text:"12 3",y:10}],roster),[{discordId:"a",kills:null,deaths:null},{discordId:"b",kills:null,deaths:null}]);
 assert.deepEqual(matchRows([{text:"player1",y:10},{text:"player2",y:40}],[{text:"12 3",y:10},{text:"4",y:40}],roster),[{discordId:"a",kills:12,deaths:3},{discordId:"b",kills:null,deaths:null}]);
 assert.equal(similarity("neto.Pinadeira","neto Pinadeira"),1);
 assert.deepEqual(lines("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t3\t30\t10\t12\t90\t12"),[{text:"12",y:12}]);
});

test("approval is atomic, unique per match and computes season K/D from approved totals",()=>{
 const db=new Database(":memory:");
 db.pragma("foreign_keys=ON");
 db.exec(`CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT,status TEXT,map TEXT,season_id INTEGER);
 CREATE TABLE players(discord_id TEXT PRIMARY KEY,r6_nickname TEXT);
 CREATE TABLE match_players(id INTEGER PRIMARY KEY,match_id INTEGER,discord_id TEXT,team TEXT);`);
 for(let p=0;p<10;p++)db.prepare("INSERT INTO players VALUES(?,?)").run(`p${p}`,`nick${p}`);
 for(let m=1;m<=4;m++){
  db.prepare("INSERT INTO matches VALUES(?,?,'finished','Bank',?)").run(m,`#${m}`,m===4?2:1);
  for(let p=0;p<10;p++)db.prepare("INSERT INTO match_players(match_id,discord_id,team) VALUES(?,?,?)").run(m,`p${p}`,p<5?"A":"B");
 }
 const filename=require.resolve("../src/services/scoreboardStore"),original=Module._load;
 let store;
 try {
  Module._load=function(request,parent){if(parent?.filename===filename&&request==="../database/database")return db;return original.apply(this,arguments);};
  delete require.cache[filename];store=require(filename);
 }finally{Module._load=original;}
 try{
  store.initialize();store.initialize();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM matches").get().n,4);
  const submit=(m,k,d)=>store.submit({matchId:m,hash:`hash${m}`,path:`/private/${m}.png`,submitter:"captain",rows:Array.from({length:10},(_,p)=>({discordId:`p${p}`,kills:p===0?k:0,deaths:p===0?d:0}))});
  const one=submit(1,null,null);
  assert.throws(()=>store.approve(one.id,"staff"),/Revise/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_match_stats").get().n,0);
  assert.throws(()=>store.correct(one.id,"p0",-1,0),/inteiros/);
  assert.throws(()=>store.correct(one.id,"outsider",1,0),/não pertence/);
  store.correct(one.id,"p0",10,3);
  assert.equal(store.totals("p0",1).matches,0);
  store.approve(one.id,"staff");
  assert.throws(()=>store.approve(one.id,"staff"),/revisado/);
  assert.throws(()=>submit(1,99,0),/aprovado/);
  for(const [m,k,d]of[[2,11,5],[3,11,7],[4,20,0]])store.approve(submit(m,k,d).id,"staff");
  assert.deepEqual(store.totals("p0",1),{kills:32,deaths:15,matches:3,kd:"2.13"});
  assert.deepEqual(store.totals("p0",2),{kills:20,deaths:0,matches:1,kd:"∞"});
  assert.equal(store.totals("p0").kills,52);
  db.prepare("UPDATE matches SET status='cancelled' WHERE id=4").run();
  assert.equal(store.totals("p0").kills,32);
  assert.equal(store.totals("outsider").kd,"—");
  db.prepare("INSERT INTO matches VALUES(5,'#5','playing','Bank',1)").run();
  for(let p=0;p<10;p++)db.prepare("INSERT INTO match_players(match_id,discord_id,team) VALUES(5,?,?)").run(`p${p}`,p<5?"A":"B");
  assert.throws(()=>store.submit({matchId:5,hash:"hash1",path:"/private/1.png",submitter:"captain",rows:[]}),/outra partida/);
  const pending=submit(5,1,1);
  assert.throws(()=>store.approve(pending.id,"staff"),/resultado oficial/);
  store.reject(pending.id,"staff");
  assert.equal(store.get(pending.id).status,"rejected");
  assert.equal(submit(5,2,2).status,"pending");
 }finally{delete require.cache[filename];db.close();}
});

test("staff approval archives evidence, deletes source only after commit and keeps history private",async()=>{
 const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"scoreboard-flow-"));
 const archive=path.join(root,"scoreboards","a".repeat(64)+".png");
 fs.mkdirSync(path.dirname(archive));fs.writeFileSync(archive,"test evidence");
 const filename=require.resolve("../src/scripts/scoreboards"),original=Module._load,events=[];
 const report={id:1,match_id:1,match_code:"#1",map:"Bank",status:"pending",image_path:archive,source_channel_id:"results",source_message_id:"source",rows_json:JSON.stringify(Array.from({length:10},(_,n)=>({discordId:`p${n}`,kills:n,deaths:1})))};
 let handlers;
 try {
  Module._load=function(request,parent){
   if(parent?.filename===filename){
    if(request==="../database/database")return {name:path.join(root,"test.sqlite")};
    if(request==="../config/config")return {discord:{guildId:"guild",staffRoleId:"staff"}};
    if(request==="../services/scoreboardStore")return {
     get:()=>report,forMatch:()=>report,match:()=>({id:1,created_at:"2026-10-18 01:30:00"}),corrections:()=>[],
     roster:()=>Array.from({length:10},(_,n)=>({discord_id:`p${n}`,r6_nickname:`nick${n}`,team:n<5?"A":"B"})),
     approve:()=>{events.push("commit");report.status="approved";return report;}
    };
    if(request==="../services/competitiveStats")return {safe:value=>String(value)};
   }
   return original.apply(this,arguments);
  };
  delete require.cache[filename];handlers=require(filename);
 }finally{Module._load=original;}
 try{
  let response;
  const interaction={customId:"kd:approve:1",guildId:"guild",channelId:"1557714957007593472",inGuild:()=>true,
   user:{id:"reviewer"},memberPermissions:{has:()=>false},member:{roles:{cache:{has:role=>role==="staff"}}},
   isButton:()=>true,isStringSelectMenu:()=>false,isModalSubmit:()=>false,
   client:{channels:{fetch:async()=>({messages:{fetch:async()=>({delete:async()=>events.push("delete")})}})}},
   deferUpdate:async()=>events.push("ack"),editReply:async payload=>{response=payload;},reply:async payload=>{response=payload;}
  };
  await handlers.handle({...interaction,guildId:"other"});
  assert.deepEqual(events,[]);assert.match(response.content,/exclusiva/);
  await handlers.handle({...interaction,member:{roles:{cache:{has:()=>false}}}});
  assert.deepEqual(events,[]);
  await handlers.handle({...interaction,channelId:"public"});
  assert.deepEqual(events,["commit","ack","delete"]);
  assert.deepEqual(response.attachments,[]);assert.deepEqual(response.components,[]);
  assert.equal(fs.readFileSync(archive,"utf8"),"test evidence");
  let flags;
  await handlers.history({...interaction,options:{getString:()=>"#1"},deferReply:async payload=>{flags=payload.flags;},editReply:async payload=>{response=payload;}});
  assert.equal(flags,64);assert.equal(response.files.length,1);
  const panel=response.embeds[0].toJSON();
  assert.equal(panel.fields.length,2);
  assert.ok(panel.fields.every(field=>field.inline===false));
  assert.match(panel.fields[0].value,/nick0/);
  assert.match(panel.fields[1].value,/nick5/);
  assert.match(panel.description,/K\/D aprovado/);
  assert.match(panel.description,/17\/10\/2026 às 22:30 \(Brasília\)/);
  assert.ok(panel.fields[0].value.startsWith("\u200b\n"));
  assert.doesNotMatch(panel.description,/Confira|exigem revisão|OCR/);
  assert.match(panel.footer.text,/acumulado da temporada/);
  assert.equal(response.components.length,1);
  let modal;
  await handlers.handle({...interaction,customId:"kd:choose:1",values:["p0"],isButton:()=>false,isStringSelectMenu:()=>true,showModal:async value=>{modal=value.toJSON();}});
  assert.equal(modal.custom_id,"kd:amend:1:p0:0:1");
  assert.equal(modal.components.length,3);
  assert.equal(modal.components[2].components[0].custom_id,"reason");
  modal=null;
  await handlers.handle({...interaction,customId:"kd:choose:1",values:["p0"],member:{roles:{cache:{has:()=>false}}},isButton:()=>false,isStringSelectMenu:()=>true,showModal:async value=>{modal=value;}});
  assert.equal(modal,null);
  fs.rmSync(archive);
  report.status="pending";events.length=0;
  await handlers.handle({...interaction,channelId:"public"});
  assert.deepEqual(events,[]);
 }finally{delete require.cache[filename];fs.rmSync(root,{recursive:true,force:true});}
});
