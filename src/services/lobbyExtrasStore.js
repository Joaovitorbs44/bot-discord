const db=require('../database/database');
function initialize(){db.exec(`
 CREATE TABLE IF NOT EXISTS lobby_reserves(guild_id TEXT NOT NULL,discord_id TEXT NOT NULL,joined_at INTEGER NOT NULL,PRIMARY KEY(guild_id,discord_id));
 CREATE TABLE IF NOT EXISTS match_cancel_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,match_id INTEGER NOT NULL REFERENCES matches(id),requested_by TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),reviewed_by TEXT,review_note TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_cancel_request_pending ON match_cancel_requests(match_id) WHERE status='pending';
 CREATE TABLE IF NOT EXISTS lobby_voice_channels(session_id INTEGER NOT NULL REFERENCES matchmaking_sessions(id),team TEXT NOT NULL,channel_id TEXT NOT NULL,PRIMARY KEY(session_id,team));
`);}
function eligible(guild,id,now=Date.now()){
 const p=db.prepare('SELECT access_active,is_banned FROM players WHERE discord_id=?').get(id);
 if(!p||p.access_active!==1||p.is_banned)return false;
 if(db.prepare('SELECT 1 FROM player_cooldowns WHERE discord_id=? AND expires_at>?').get(id,now))return false;
 if(db.prepare("SELECT 1 FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.discord_id=? AND m.status IN ('playing','pending_confirmation','disputed')").get(id))return false;
 if(db.prepare("SELECT 1 FROM matchmaking_session_players sp JOIN matchmaking_sessions s ON s.id=sp.session_id WHERE sp.discord_id=? AND s.guild_id=? AND s.status='active'").get(id,guild))return false;
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='matchmaking_waiting_players' AND type='table'").get()&&db.prepare('SELECT 1 FROM matchmaking_waiting_players WHERE guild_id=? AND discord_id=?').get(guild,id))return false;
 return true;
}
function joinReserve(guild,id){return db.transaction(()=>{
 if(!eligible(guild,id))throw new Error('Para entrar na reserva, tenha acesso ativo, sem penalidade, e saia da fila ou partida atual.');
 db.prepare('INSERT OR IGNORE INTO lobby_reserves VALUES(?,?,?)').run(guild,id,Date.now());
 return reserves(guild).findIndex(p=>p.discord_id===id)+1;
})();}
function reserves(guild){return db.prepare('SELECT * FROM lobby_reserves WHERE guild_id=? ORDER BY joined_at,discord_id').all(guild);}
function leaveReserve(guild,id){return db.prepare('DELETE FROM lobby_reserves WHERE guild_id=? AND discord_id=?').run(guild,id).changes===1;}
function replaceAbsent(sessionId,seconds,onAbsent=()=>{}){return db.transaction(()=>{
 const s=db.prepare("SELECT * FROM matchmaking_sessions WHERE id=? AND status='active' AND stage='ready_check'").get(sessionId);
 if(!s||!s.deadline_at||s.deadline_at>Date.now())return null;
 const roster=db.prepare('SELECT * FROM matchmaking_session_players WHERE session_id=? ORDER BY joined_at,id').all(sessionId);
 if(roster.length!==10)return null;
 const absent=roster.filter(p=>!p.ready_confirmed);if(!absent.length)return null;
 const candidates=reserves(s.guild_id).filter(p=>eligible(s.guild_id,p.discord_id)).slice(0,absent.length);
 if(candidates.length!==absent.length)return null;
 for(const p of absent){onAbsent(p.discord_id);db.prepare('DELETE FROM matchmaking_session_players WHERE session_id=? AND discord_id=?').run(sessionId,p.discord_id);}
 for(const p of candidates){leaveReserve(s.guild_id,p.discord_id);db.prepare('INSERT INTO matchmaking_session_players(session_id,discord_id,ready_confirmed) VALUES(?,?,0)').run(sessionId,p.discord_id);}
 const deadline=Date.now()+seconds*1000;
 db.prepare('UPDATE matchmaking_sessions SET deadline_at=?,updated_at=? WHERE id=?').run(deadline,Date.now(),sessionId);
 db.prepare("INSERT INTO matchmaking_actions(session_id,action_type,details_json) VALUES(?,'reserve_replacement',?)").run(sessionId,JSON.stringify({removed:absent.map(p=>p.discord_id),called:candidates.map(p=>p.discord_id)}));
 return {deadline,called:candidates.map(p=>p.discord_id),removed:absent.map(p=>p.discord_id)};
})();}
function requestCancel(matchId,userId,reason){reason=String(reason||'').trim();if(reason.length<10||reason.length>500)throw new Error('Informe um motivo de 10 a 500 caracteres.');return db.transaction(()=>{
 const m=db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
 if(!m||!['playing','pending_confirmation','disputed'].includes(m.status))throw new Error('Somente partidas em andamento ou com resultado pendente podem ser canceladas por este pedido.');
 if(!db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND discord_id=?').get(matchId,userId))throw new Error('Você precisa participar desta partida.');
 if(db.prepare("SELECT 1 FROM match_cancel_requests WHERE match_id=? AND status='pending'").get(matchId))throw new Error('Esta partida já possui um pedido aguardando a staff.');
 const r=db.prepare('INSERT INTO match_cancel_requests(match_id,requested_by,reason) VALUES(?,?,?)').run(matchId,userId,reason);return cancellation(r.lastInsertRowid);
})();}
function cancellation(id){return db.prepare('SELECT r.*,m.match_code,m.status AS match_status FROM match_cancel_requests r JOIN matches m ON m.id=r.match_id WHERE r.id=?').get(id);}
function cancellations(){return db.prepare("SELECT r.id,r.status,m.match_code FROM match_cancel_requests r JOIN matches m ON m.id=r.match_id ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.id DESC LIMIT 10").all();}
function decide(id,staffId,approve,note){note=String(note||'').trim();if(note.length<5||note.length>300)throw new Error('Registre a justificativa da decisão (5 a 300 caracteres).');return db.transaction(()=>{
 const r=cancellation(id);if(!r||r.status!=='pending')throw new Error('Este pedido já foi decidido ou não existe.');
 if(approve){
  if(db.prepare('SELECT 1 FROM player_match_stats WHERE match_id=?').get(r.match_id))throw new Error('Há estatísticas registradas; o cancelamento exige revisão específica da staff.');
  const changed=db.prepare("UPDATE matches SET status='cancelled',winner_team=NULL,result_confirmed_by=?,result_confirmed_at=CURRENT_TIMESTAMP,finished_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('playing','pending_confirmation','disputed')").run(staffId,r.match_id);
  if(changed.changes!==1)throw new Error('O resultado mudou ou a partida já terminou. Pedido não aprovado.');
  db.prepare("UPDATE matchmaking_sessions SET status='cancelled',stage='cancelled',deadline_at=NULL,updated_at=? WHERE match_id=?").run(Date.now(),r.match_id);
 }
 db.prepare("UPDATE match_cancel_requests SET status=?,reviewed_by=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(approve?'approved':'rejected',staffId,note,id);
 return cancellation(id);
})();}
module.exports={initialize,eligible,joinReserve,leaveReserve,reserves,replaceAbsent,requestCancel,cancellation,cancellations,decide};
