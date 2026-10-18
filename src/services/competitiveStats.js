const db = require("../database/database");
function activeSeason(){return db.prepare("SELECT id,name FROM seasons WHERE status='active' ORDER BY id DESC LIMIT 1").get()||null;}
function getPlayer(id){return db.prepare("SELECT * FROM players WHERE discord_id=?").get(id);}
function leaderboard(seasonId,limit=10){if(!seasonId)return [];return db.prepare("SELECT p.id,p.discord_id,p.r6_nickname,p.r6_rank,sp.points,sp.wins,sp.losses,sp.matches_played FROM season_players sp JOIN players p ON p.id=sp.player_id WHERE sp.season_id=? AND p.is_banned=0 ORDER BY sp.points DESC,sp.wins DESC,sp.matches_played ASC,p.id ASC LIMIT ?").all(seasonId,limit);}
function seasonStats(id,seasonId){return seasonId?db.prepare("SELECT points,wins,losses,matches_played FROM season_players WHERE player_id=? AND season_id=?").get(id,seasonId)||{points:0,wins:0,losses:0,matches_played:0}:{points:0,wins:0,losses:0,matches_played:0};}
function position(id,seasonId){const i=leaderboard(seasonId,100000).findIndex(p=>p.id===id);return i<0?null:i+1;}
function matches(id,limit=10,seasonId=null){const sql="SELECT m.captain_a_discord_id,m.captain_b_discord_id,m.match_code,m.map,m.status,m.winner_team,m.created_at,mp.team,mp.is_captain FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.discord_id=?"+(seasonId?" AND m.season_id=?":"")+" ORDER BY m.id DESC LIMIT ?";return db.prepare(sql).all(...(seasonId?[id,seasonId,limit]:[id,limit]));}
function winRate(w,m){return m?(100*w/m).toFixed(1):"0.0";}
function streak(id,seasonId){const rows=matches(id,100,seasonId).filter(m=>m.status==="finished"&&m.winner_team);if(!rows.length)return "—";const won=rows[0].team===rows[0].winner_team;let n=0;for(const m of rows){if((m.team===m.winner_team)!==won)break;n++;}return (won?"V":"D")+n;}
function safe(v,max=100){return String(v??"—").replace(/\\/g,"\\\\").replace(/([*_~\x60|])/g,"\\$1").replace(/@/g,"@\u200b").slice(0,max);}
module.exports={activeSeason,getPlayer,leaderboard,seasonStats,position,matches,winRate,streak,safe};
