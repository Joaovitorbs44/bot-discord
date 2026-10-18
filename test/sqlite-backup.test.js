const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const Database=require("better-sqlite3");

test("SQLite backup restores a consistent homologation database without altering source",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"invi-six-backup-"));
 const source=path.join(root,"homologation.sqlite");
 const output=path.join(root,"backups");
 try{
  const db=new Database(source);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE players(id INTEGER PRIMARY KEY, nickname TEXT); INSERT INTO players VALUES(1,'test-player');");
  db.close();
  const before=fs.readFileSync(source);
  const run=spawnSync(process.execPath,[path.join(__dirname,"../scripts/backup-sqlite.js")],{
   env:{...process.env,DATABASE_PATH:source,SQLITE_BACKUP_DIR:output},encoding:"utf8"
  });
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout.trim());
  assert.equal(result.ok,true);
  assert.equal(result.tables,1);
  assert.ok(result.backup.startsWith(output));
  assert.deepEqual(fs.readFileSync(source),before);
  const restored=new Database(result.backup,{readonly:true});
  try{
   assert.equal(restored.pragma("integrity_check",{simple:true}),"ok");
   assert.deepEqual(restored.prepare("SELECT * FROM players").all(),[{id:1,nickname:"test-player"}]);
  }finally{restored.close();}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
