const db=require('../database/database');
function snapshot(guildId,discordId,now=Date.now()) {
  const player=db.prepare('SELECT access_active,is_banned FROM players WHERE discord_id=?').get(discordId);
  const penalty=db.prepare('SELECT reason,expires_at FROM player_cooldowns WHERE discord_id=? AND expires_at>?').get(discordId,now)||null;
  const match=db.prepare("SELECT m.* FROM matches m JOIN match_players mp ON mp.match_id=m.id WHERE mp.discord_id=? AND m.status IN ('playing','pending_confirmation','disputed') ORDER BY m.id DESC LIMIT 1").get(discordId)||null;
  const session=db.prepare("SELECT s.*,sp.ready_confirmed FROM matchmaking_sessions s JOIN matchmaking_session_players sp ON sp.session_id=s.id WHERE s.guild_id=? AND s.status='active' AND sp.discord_id=? ORDER BY CASE WHEN s.stage='queue' THEN 1 ELSE 0 END,s.id DESC LIMIT 1").get(guildId,discordId)||null;
  let position=null,total=0;
  if(process.env.MULTILOBBY_QUEUE_ENABLED==='true' && db.prepare("SELECT 1 FROM sqlite_master WHERE name='matchmaking_waiting_players' AND type='table'").get()) {
    const rows=db.prepare('SELECT discord_id FROM matchmaking_waiting_players WHERE guild_id=? ORDER BY joined_at,discord_id').all(guildId);
    const index=rows.findIndex(row=>row.discord_id===discordId);if(index>=0){position=index+1;total=rows.length;}
  } else if(session?.stage==='queue') {
    const rows=db.prepare('SELECT discord_id FROM matchmaking_session_players WHERE session_id=? ORDER BY joined_at,id').all(session.id);
    position=rows.findIndex(row=>row.discord_id===discordId)+1;total=rows.length;
  }
  let reservePosition=null;
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='lobby_reserves' AND type='table'").get()){
    const rows=db.prepare("SELECT discord_id FROM lobby_reserves WHERE guild_id=? ORDER BY joined_at,discord_id").all(guildId);
    const index=rows.findIndex(row=>row.discord_id===discordId);if(index>=0)reservePosition=index+1;
  }
  return {player,penalty,match,session,position,total,reservePosition};
}
module.exports={snapshot};
