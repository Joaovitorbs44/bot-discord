const db = require("../database/database");
function initialize() {
  db.exec(`CREATE TABLE IF NOT EXISTS scoreboard_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL UNIQUE REFERENCES matches(id),
    image_hash TEXT NOT NULL UNIQUE, image_path TEXT NOT NULL,
    submitted_by TEXT NOT NULL, source_channel_id TEXT, source_message_id TEXT,
    rows_json TEXT NOT NULL, ocr_note TEXT, status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','approved','rejected')),
    reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS player_match_stats (
    match_id INTEGER NOT NULL REFERENCES matches(id), discord_id TEXT NOT NULL,
    kills INTEGER NOT NULL CHECK(kills BETWEEN 0 AND 99),
    deaths INTEGER NOT NULL CHECK(deaths BETWEEN 0 AND 99),
    PRIMARY KEY(match_id,discord_id)
  );
  CREATE TABLE IF NOT EXISTS scoreboard_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL REFERENCES scoreboard_reports(id),
    discord_id TEXT NOT NULL, old_kills INTEGER NOT NULL, old_deaths INTEGER NOT NULL,
    new_kills INTEGER NOT NULL, new_deaths INTEGER NOT NULL, staff_id TEXT NOT NULL,
    reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
}
function match(code) {
  return db.prepare("SELECT * FROM matches WHERE match_code=?").get(String(code).trim());
}
function roster(matchId) {
  return db.prepare("SELECT mp.discord_id,mp.team,p.r6_nickname FROM match_players mp JOIN players p ON p.discord_id=mp.discord_id WHERE mp.match_id=? ORDER BY mp.team,mp.id").all(matchId);
}
function get(id) { return db.prepare("SELECT r.*,m.match_code,m.map,m.status AS match_status FROM scoreboard_reports r JOIN matches m ON m.id=r.match_id WHERE r.id=?").get(id); }
function forMatch(id) { return db.prepare("SELECT * FROM scoreboard_reports WHERE match_id=?").get(id); }
function submit(data) {
  return db.transaction(()=>{
    const existing=forMatch(data.matchId);
    if(existing?.status==='approved') throw new Error("Esta partida já possui K/D aprovado.");
    if(existing?.status==='pending') throw new Error("Esta partida já possui um placar aguardando revisão.");
    const duplicate=db.prepare("SELECT id FROM scoreboard_reports WHERE image_hash=? AND match_id<>?").get(data.hash,data.matchId);
    if(duplicate) throw new Error("Esta imagem já foi vinculada a outra partida.");
    if(existing) {
      db.prepare("UPDATE scoreboard_reports SET image_hash=?,image_path=?,submitted_by=?,source_channel_id=?,source_message_id=?,rows_json=?,ocr_note=?,status='pending',reviewed_by=NULL,reviewed_at=NULL WHERE id=?")
        .run(data.hash,data.path,data.submitter,data.channelId||null,data.messageId||null,JSON.stringify(data.rows),data.note||null,existing.id);
      return get(existing.id);
    }
    const result=db.prepare("INSERT INTO scoreboard_reports(match_id,image_hash,image_path,submitted_by,source_channel_id,source_message_id,rows_json,ocr_note) VALUES(?,?,?,?,?,?,?,?)")
      .run(data.matchId,data.hash,data.path,data.submitter,data.channelId||null,data.messageId||null,JSON.stringify(data.rows),data.note||null);
    return get(result.lastInsertRowid);
  })();
}
function correct(id,discordId,kills,deaths) {
  if(!Number.isInteger(kills)||!Number.isInteger(deaths)||kills<0||deaths<0||kills>99||deaths>99) throw new Error("Kills e mortes devem ser inteiros entre 0 e 99.");
  return db.transaction(()=>{
    const report=get(id);
    if(report?.status!=="pending")throw new Error("Este placar não está mais pendente.");
    const rows=JSON.parse(report.rows_json);
    const row=rows.find(r=>r.discordId===discordId);
    if(!row)throw new Error("Jogador não pertence à partida.");
    row.kills=kills;row.deaths=deaths;
    db.prepare("UPDATE scoreboard_reports SET rows_json=? WHERE id=? AND status='pending'").run(JSON.stringify(rows),id);
    return get(id);
  })();
}
function approve(id,staffId) {
  return db.transaction(()=>{
    const report=get(id);
    if(report?.status!=="pending")throw new Error("Este placar já foi revisado.");
    if(report.match_status!=="finished")throw new Error("Confirme primeiro o resultado oficial da partida.");
    const players=roster(report.match_id),rows=JSON.parse(report.rows_json);
    if(players.length!==10||rows.length!==10||new Set(rows.map(r=>r.discordId)).size!==10)throw new Error("O placar precisa conter os 10 jogadores da partida.");
    for(const row of rows) {
      if(!players.some(p=>p.discord_id===row.discordId)||!Number.isInteger(row.kills)||!Number.isInteger(row.deaths)||row.kills<0||row.deaths<0||row.kills>99||row.deaths>99)throw new Error("Revise kills e mortes de todos os jogadores antes de aprovar.");
      db.prepare("INSERT INTO player_match_stats(match_id,discord_id,kills,deaths) VALUES(?,?,?,?)").run(report.match_id,row.discordId,row.kills,row.deaths);
    }
    db.prepare("UPDATE scoreboard_reports SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(staffId,id);
    return get(id);
  })();
}
function reject(id,staffId) {
  const result=db.prepare("UPDATE scoreboard_reports SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(staffId,id);
  if(result.changes!==1)throw new Error("Este placar já foi revisado.");
  return get(id);
}
function totals(discordId,seasonId=null) {
  const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_match_stats'").get();
  if(!exists)return {kills:0,deaths:0,matches:0,kd:"—"};
  const row=db.prepare(`SELECT COALESCE(SUM(s.kills),0) AS kills,COALESCE(SUM(s.deaths),0) AS deaths,COUNT(*) AS matches
    FROM player_match_stats s JOIN matches m ON m.id=s.match_id JOIN scoreboard_reports r ON r.match_id=m.id
    WHERE s.discord_id=? AND m.status='finished' AND r.status='approved' ${seasonId?"AND m.season_id=?":""}`)
    .get(...(seasonId?[discordId,seasonId]:[discordId]));
  return {...row,kd:row.matches?(row.deaths?(row.kills/row.deaths).toFixed(2):(row.kills?"∞":"0.00")):"—"};
}
function corrections(reportId) {
  return db.prepare("SELECT * FROM scoreboard_corrections WHERE report_id=? ORDER BY id DESC LIMIT 5").all(reportId);
}
function amend(id,discordId,kills,deaths,staffId,reason,expectedKills,expectedDeaths) {
  if(!Number.isInteger(kills)||!Number.isInteger(deaths)||kills<0||deaths<0||kills>99||deaths>99)throw new Error("Use inteiros de 0 a 99.");
  reason=String(reason||"").trim();
  if(!staffId||reason.length<5||reason.length>300)throw new Error("Informe um motivo de 5 a 300 caracteres.");
  return db.transaction(()=>{
    const report=get(id);
    if(report?.status!=="approved"||report.match_status!=="finished")throw new Error("A correção exige um placar aprovado e uma partida finalizada.");
    if(!roster(report.match_id).some(p=>p.discord_id===discordId))throw new Error("Jogador não pertence à partida.");
    const old=db.prepare("SELECT kills,deaths FROM player_match_stats WHERE match_id=? AND discord_id=?").get(report.match_id,discordId);
    if(!old||old.kills!==expectedKills||old.deaths!==expectedDeaths)throw new Error("Este K/D mudou. Abra /partidas novamente antes de corrigir.");
    const rows=JSON.parse(report.rows_json),row=rows.find(r=>r.discordId===discordId);
    if(!row||row.kills!==old.kills||row.deaths!==old.deaths)throw new Error("Placar inconsistente; nenhuma alteração aplicada.");
    if(kills===old.kills&&deaths===old.deaths)throw new Error("Os valores informados já estão registrados.");
    db.prepare("UPDATE player_match_stats SET kills=?,deaths=? WHERE match_id=? AND discord_id=?").run(kills,deaths,report.match_id,discordId);
    row.kills=kills;row.deaths=deaths;
    db.prepare("UPDATE scoreboard_reports SET rows_json=? WHERE id=?").run(JSON.stringify(rows),id);
    db.prepare("INSERT INTO scoreboard_corrections(report_id,discord_id,old_kills,old_deaths,new_kills,new_deaths,staff_id,reason) VALUES(?,?,?,?,?,?,?,?)")
      .run(id,discordId,old.kills,old.deaths,kills,deaths,staffId,reason);
    return get(id);
  })();
}
function recent() {
  return db.prepare("SELECT r.id,r.status,m.match_code,m.map FROM scoreboard_reports r JOIN matches m ON m.id=r.match_id ORDER BY r.id DESC LIMIT 10").all();
}
module.exports={initialize,match,roster,get,forMatch,submit,correct,approve,reject,totals,recent,amend,corrections};
