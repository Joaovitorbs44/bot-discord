// Safe SQLite backup using SQLite's online backup API.
// DATABASE_PATH selects the persistent source; SQLITE_BACKUP_DIR selects output.
const fs=require("node:fs");
const path=require("node:path");
const Database=require("better-sqlite3");
async function main(){
 const source=path.resolve(process.env.DATABASE_PATH||path.join(__dirname,"../data/database.sqlite"));
 if(!fs.existsSync(source))throw new Error("SOURCE_DATABASE_NOT_FOUND: "+source);
 const outputDirectory=path.resolve(process.env.SQLITE_BACKUP_DIR||path.join(__dirname,"../backups"));
 fs.mkdirSync(outputDirectory,{recursive:true});
 const stamp=new Date().toISOString().replace(/[:.]/g,"-");
 const target=path.join(outputDirectory,`database-${stamp}.sqlite`);
 if(path.resolve(target)===source)throw new Error("BACKUP_PATH_EQUALS_SOURCE");
 const db=new Database(source,{readonly:true,fileMustExist:true});
 try{
  const sourceCheck=db.pragma("quick_check",{simple:true});
  if(sourceCheck!=="ok")throw new Error("SOURCE_INTEGRITY_CHECK_FAILED: "+sourceCheck);
  await db.backup(target);
  const backup=new Database(target,{readonly:true,fileMustExist:true});
  try{
   const check=backup.pragma("integrity_check",{simple:true});
   if(check!=="ok")throw new Error("BACKUP_INTEGRITY_CHECK_FAILED: "+check);
   const tables=backup.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count;
   console.log(JSON.stringify({ok:true,backup:target,bytes:fs.statSync(target).size,tables}));
  }finally{backup.close();}
 }finally{db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
