// Explicit, reversible migration of the legacy one-active-session index.
// Run only during a maintenance window with the bot stopped.
const db=require("../database/database");
const waiting=require("./waitingQueue");
const INDEX="idx_matchmaking_one_active_guild";
function inspect(){
 const active=db.prepare("SELECT id,guild_id,stage,status FROM matchmaking_sessions WHERE status='active' ORDER BY id").all();
 const legacyIndex=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(INDEX));
 return {active,legacyIndex};
}
function migrate(){
 if(process.env.MULTILOBBY_MIGRATION_CONFIRM!=="YES")
  throw new Error("MIGRATION_CONFIRMATION_REQUIRED");
 return db.transaction(()=>{
  const before=inspect();
  if(before.active.length)
   throw new Error("ACTIVE_SESSIONS_PRESENT: finish or cancel all legacy sessions before migration");
  waiting.ensureTables();
  db.exec("DROP INDEX IF EXISTS idx_matchmaking_one_active_guild");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_matchmaking_active_guild_stage
    ON matchmaking_sessions(guild_id,stage) WHERE status='active'`);
  const after=inspect();
  if(after.legacyIndex)throw new Error("MIGRATION_VERIFICATION_FAILED");
  return {before,after};
 })();
}
function rollback(){
 if(process.env.MULTILOBBY_MIGRATION_CONFIRM!=="YES")
  throw new Error("MIGRATION_CONFIRMATION_REQUIRED");
 return db.transaction(()=>{
  const before=inspect();
  const grouped=db.prepare(`SELECT guild_id,COUNT(*) AS n FROM matchmaking_sessions
    WHERE status='active' GROUP BY guild_id HAVING COUNT(*)>1`).all();
  if(grouped.length)throw new Error("MULTIPLE_ACTIVE_SESSIONS: cannot restore legacy unique index");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_matchmaking_one_active_guild
    ON matchmaking_sessions(guild_id) WHERE status='active'`);
  db.exec("DROP INDEX IF EXISTS idx_matchmaking_active_guild_stage");
  return {before,after:inspect()};
 })();
}
if(require.main===module){
 try{
  const operation=process.argv[2];
  if(!["inspect","migrate","rollback"].includes(operation))throw new Error("Use inspect, migrate or rollback");
  const result=operation==="inspect"?inspect():operation==="migrate"?migrate():rollback();
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
 }catch(error){
  console.error("[MULTILOBBY MIGRATION]",error.message);
  process.exitCode=1;
 }
}
module.exports={inspect,migrate,rollback};
