const db = require('../database/database');
function initialize() {
  db.exec(`CREATE TABLE IF NOT EXISTS match_complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL REFERENCES matches(id),
    reporter_id TEXT NOT NULL, reported_id TEXT, reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
    reviewed_by TEXT, resolution TEXT, reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(match_id,reporter_id)
  );`);
}
function maps(discordId, seasonId) {
  return db.prepare(`SELECT m.map,COUNT(*) AS matches,
    SUM(CASE WHEN mp.team=m.winner_team THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN mp.team<>m.winner_team THEN 1 ELSE 0 END) AS losses,
    COUNT(CASE WHEN r.status='approved' AND s.discord_id IS NOT NULL THEN 1 END) AS kd_matches,
    COALESCE(SUM(CASE WHEN r.status='approved' THEN s.kills ELSE 0 END),0) AS kills,
    COALESCE(SUM(CASE WHEN r.status='approved' THEN s.deaths ELSE 0 END),0) AS deaths
    FROM match_players mp JOIN matches m ON m.id=mp.match_id
    LEFT JOIN player_match_stats s ON s.match_id=m.id AND s.discord_id=mp.discord_id
    LEFT JOIN scoreboard_reports r ON r.match_id=m.id
    WHERE mp.discord_id=? AND m.season_id=? AND m.status='finished' AND m.winner_team IN ('A','B')
    GROUP BY m.map ORDER BY matches DESC,m.map`).all(discordId,seasonId).map(row=>({...row,
      kd:!row.kd_matches?'—':row.deaths?(row.kills/row.deaths).toFixed(2):row.kills?'∞':'0.00'}));
}
function complain({matchId,reporterId,reportedId=null,reason}) {
  reason=String(reason||'').trim();
  if(reason.length<10||reason.length>1000)throw new Error('Explique o motivo usando de 10 a 1.000 caracteres.');
  return db.transaction(()=>{
    if(!db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND discord_id=?').get(matchId,reporterId))throw new Error('Você só pode denunciar uma partida da qual participou.');
    if(reportedId&&!db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND discord_id=?').get(matchId,reportedId))throw new Error('O jogador denunciado não participou desta partida.');
    if(reportedId===reporterId)throw new Error('Selecione outro jogador.');
    if(db.prepare('SELECT id FROM match_complaints WHERE match_id=? AND reporter_id=?').get(matchId,reporterId))throw new Error('Sua denúncia desta partida já está registrada. A staff irá analisá-la.');
    const result=db.prepare('INSERT INTO match_complaints(match_id,reporter_id,reported_id,reason) VALUES(?,?,?,?)').run(matchId,reporterId,reportedId,reason);
    return complaint(result.lastInsertRowid);
  })();
}
function complaint(id) {return db.prepare('SELECT c.*,m.match_code,m.map FROM match_complaints c JOIN matches m ON m.id=c.match_id WHERE c.id=?').get(id);}
function complaints() {return db.prepare("SELECT c.id,c.status,m.match_code FROM match_complaints c JOIN matches m ON m.id=c.match_id ORDER BY CASE WHEN c.status='open' THEN 0 ELSE 1 END,c.id DESC LIMIT 10").all();}
function resolve(id,staffId,resolution) {
  resolution=String(resolution||'').trim();
  if(resolution.length<5||resolution.length>1000)throw new Error('Informe uma conclusão de 5 a 1.000 caracteres.');
  const result=db.prepare("UPDATE match_complaints SET status='closed',reviewed_by=?,resolution=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='open'").run(staffId,resolution,id);
  if(result.changes!==1)throw new Error('Denúncia não encontrada ou já encerrada.');
  return complaint(id);
}
module.exports={initialize,maps,complain,complaint,complaints,resolve};
