const test=require('node:test');
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const Module=require('node:module');
function fixture() {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT,status TEXT,map TEXT,season_id INTEGER,winner_team TEXT);
    CREATE TABLE players(discord_id TEXT PRIMARY KEY,r6_nickname TEXT);
    CREATE TABLE match_players(id INTEGER PRIMARY KEY,match_id INTEGER,discord_id TEXT,team TEXT);`);
  for(let p=0;p<10;p++)db.prepare('INSERT INTO players VALUES(?,?)').run('p'+p,'nick'+p);
  for(const [id,status,map,season,winner] of [[1,'finished','Bank',1,'A'],[2,'finished','Bank',1,'B'],[3,'cancelled','Bank',1,'A'],[4,'finished','Chalet',2,'A'],[5,'finished','Chalet',1,'A'],[6,'playing','Bank',1,null]]) {
    db.prepare('INSERT INTO matches VALUES(?,?,?,?,?,?)').run(id,'#'+id,status,map,season,winner);
    for(let p=0;p<10;p++)db.prepare('INSERT INTO match_players(match_id,discord_id,team) VALUES(?,?,?)').run(id,'p'+p,p<5?'A':'B');
  }
  const paths=['../src/services/scoreboardStore','../src/services/communityFeatures'].map(p=>require.resolve(p));
  const original=Module._load;
  let scoreboard,community;
  try {
    Module._load=function(request,parent){if(paths.includes(parent?.filename)&&request==='../database/database')return db;return original.apply(this,arguments);};
    for(const p of paths)delete require.cache[p];
    scoreboard=require(paths[0]);community=require(paths[1]);
  }finally{Module._load=original;}
  scoreboard.initialize();community.initialize();community.initialize();
  function approved(id,k,d) {
    const report=scoreboard.submit({matchId:id,hash:'image'+id,path:'/private/'+id,submitter:'p0',rows:Array.from({length:10},(_,p)=>({discordId:'p'+p,kills:p===0?k:0,deaths:p===0?d:0}))});
    return scoreboard.approve(report.id,'staff');
  }
  return {db,scoreboard,community,approved,close:()=>{for(const p of paths)delete require.cache[p];db.close();}};
}
test('map statistics count confirmed results separately from approved K/D and isolate seasons',()=>{
  const f=fixture();
  try {
    f.approved(1,10,2);f.approved(4,99,0);
    assert.deepEqual(f.community.maps('p0',1),[
      {map:'Bank',matches:2,wins:1,losses:1,kd_matches:1,kills:10,deaths:2,kd:'5.00'},
      {map:'Chalet',matches:1,wins:1,losses:0,kd_matches:0,kills:0,deaths:0,kd:'—'}
    ]);
    assert.equal(f.community.maps('p0',2)[0].kd,'∞');
    assert.deepEqual(f.community.maps('outsider',1),[]);
    const r=f.approved(5,0,0);assert.equal(f.community.maps('p0',1)[1].kd,'0.00');
    assert.equal(r.status,'approved');
  }finally{f.close();}
});
test('approved correction replaces stats atomically, preserves results, audits the actor and rejects stale or duplicate edits',()=>{
  const f=fixture();
  try {
    const report=f.approved(1,10,2),before=f.db.prepare('SELECT * FROM matches WHERE id=1').get();
    f.scoreboard.amend(report.id,'p0',12,4,'staff2','Conferência do print',10,2);
    assert.deepEqual(f.scoreboard.totals('p0',1),{kills:12,deaths:4,matches:1,kd:'3.00'});
    assert.equal(f.community.maps('p0',1)[0].kills,12);
    assert.equal(JSON.parse(f.scoreboard.get(report.id).rows_json)[0].kills,12);
    assert.deepEqual(f.db.prepare('SELECT * FROM matches WHERE id=1').get(),before);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM player_match_stats WHERE match_id=1').get().n,10);
    const audit=f.scoreboard.corrections(report.id)[0];
    assert.deepEqual([audit.staff_id,audit.old_kills,audit.old_deaths,audit.new_kills,audit.new_deaths],['staff2',10,2,12,4]);
    assert.throws(()=>f.scoreboard.amend(report.id,'p0',20,2,'staff','Outra conferência',10,2),/mudou/);
    assert.throws(()=>f.scoreboard.amend(report.id,'p0',12,4,'staff','Outra conferência',12,4),/já estão/);
    assert.throws(()=>f.scoreboard.amend(report.id,'outsider',12,4,'staff','Outra conferência',12,4),/não pertence/);
    assert.throws(()=>f.scoreboard.amend(report.id,'p0',100,4,'staff','Outra conferência',12,4),/inteiros/);
    assert.throws(()=>f.scoreboard.amend(report.id,'p0',13,4,'staff','',12,4),/motivo/);
    // An audit failure rolls both the stats and report JSON back.
    f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON scoreboard_corrections BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    assert.throws(()=>f.scoreboard.amend(report.id,'p0',13,4,'staff','Conferência adicional',12,4),/audit unavailable/);
    assert.equal(f.scoreboard.totals('p0',1).kills,12);
    assert.equal(JSON.parse(f.scoreboard.get(report.id).rows_json)[0].kills,12);
    assert.equal(f.scoreboard.corrections(report.id).length,1);
    f.db.prepare("UPDATE matches SET status='cancelled' WHERE id=1").run();
    assert.throws(()=>f.scoreboard.amend(report.id,'p0',13,4,'staff','Conferência adicional',12,4),/finalizada/);
  }finally{f.close();}
});
test('complaints require match participation, reject unrelated targets and duplicates, and preserve staff resolution',()=>{
  const f=fixture();
  try {
    assert.throws(()=>f.community.complain({matchId:1,reporterId:'outsider',reason:'Conduta durante a partida'}),/participou/);
    assert.throws(()=>f.community.complain({matchId:1,reporterId:'p0',reportedId:'outsider',reason:'Conduta durante a partida'}),/não participou/);
    const report=f.community.complain({matchId:1,reporterId:'p0',reportedId:'p1',reason:'Conduta durante a partida'});
    assert.equal(report.status,'open');assert.equal(report.match_code,'#1');
    assert.throws(()=>f.community.complain({matchId:1,reporterId:'p0',reason:'Segundo envio da denúncia'}),/já está/);
    assert.throws(()=>f.community.resolve(report.id,'staff',''),/conclusão/);
    const closed=f.community.resolve(report.id,'staff','Analisado com os participantes');
    assert.equal(closed.reviewed_by,'staff');assert.equal(closed.status,'closed');
    assert.ok(closed.reviewed_at);assert.equal(closed.reason,'Conduta durante a partida');
    assert.throws(()=>f.community.resolve(report.id,'other','Nova decisão'),/encerrada/);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM match_complaints').get().n,1);
  }finally{f.close();}
});
