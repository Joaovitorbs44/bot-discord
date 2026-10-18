const test=require("node:test"),assert=require("node:assert/strict"),Database=require("better-sqlite3");
const {apply}=require("../src/services/confirmedMatchCorrection");
function database(){
 const db=new Database(":memory:");
 db.exec(`CREATE TABLE matches(id INTEGER PRIMARY KEY,match_code TEXT,map TEXT,status TEXT,winner_team TEXT,captain_b_discord_id TEXT,season_id INTEGER);
 CREATE TABLE players(discord_id TEXT,r6_nickname TEXT,points INTEGER);
 CREATE TABLE match_players(match_id INTEGER,discord_id TEXT,team TEXT);
 CREATE TABLE staff_actions(staff_discord_id TEXT,action_type TEXT,match_id INTEGER,reason TEXT,details_json TEXT);`);
 db.prepare("INSERT INTO matches VALUES(1,'#298604','Kafe Dostoyevsky','finished','B','p0',1)").run();
 db.prepare("INSERT INTO matches VALUES(2,'#159256','Fortress','finished','A','p0',1)").run();
 const names=["yHacKzz7.","WhoShotYa621","Saafewga",...Array.from({length:7},(_,i)=>`other${i}`)];
 for(let n=0;n<10;n++){
  db.prepare("INSERT INTO players VALUES(?,?,?)").run(`p${n}`,names[n],n*5);
  db.prepare("INSERT INTO match_players VALUES(1,?,?)").run(`p${n}`,n<5?"A":"B");
 }
 return db;
}
test("confirmed correction changes only the target map once and preserves roster and points",()=>{
 const db=database();
 try{
  const before=db.prepare("SELECT * FROM matches ORDER BY id").all(),players=db.prepare("SELECT * FROM players").all(),roster=db.prepare("SELECT * FROM match_players").all();
  assert.deepEqual(apply(db),{status:"corrected",map:"Fortress"});
  assert.deepEqual(db.prepare("SELECT * FROM matches ORDER BY id").all(),[{...before[0],map:"Fortress"},before[1]]);
  assert.deepEqual(db.prepare("SELECT * FROM players").all(),players);
  assert.deepEqual(db.prepare("SELECT * FROM match_players").all(),roster);
  assert.equal(apply(db).status,"already_applied");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM staff_actions").get().n,1);
 }finally{db.close();}
});
test("correction refuses an unrelated roster or result",()=>{
 const db=database();
 try{
  db.prepare("UPDATE players SET r6_nickname='different' WHERE discord_id='p0'").run();
  assert.equal(apply(db).status,"roster_mismatch");
  assert.equal(db.prepare("SELECT map FROM matches WHERE id=1").get().map,"Kafe Dostoyevsky");
  db.prepare("UPDATE matches SET winner_team='A' WHERE id=1").run();
  assert.equal(apply(db).status,"precondition_failed");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM staff_actions").get().n,0);
 }finally{db.close();}
});
