function captainTeam(captain, db, button = false) {
  const id = typeof captain === "string" ? captain : captain?.discordId || captain?.discord_id;
  let name = typeof captain === "object" ? captain?.nickname || captain?.r6_nickname : null;
  if (!name && id && db) {
    try { name = db.prepare("SELECT r6_nickname FROM players WHERE discord_id=?").get(id)?.r6_nickname; } catch {}
  }
  // Preview IDs are display names; Discord snowflakes are never used as names.
  if (!name && typeof captain === "string" && !/^\d{17,20}$/.test(captain)) name = captain;
  name = String(name || "capitão").replace(/[\r\n\t]/g," ").replace(/@/g,"@\u200b").trim().slice(0,40);
  const plain = `Time ${name}`;
  return button ? plain : plain.replace(/\\/g,"\\\\").replace(/([*_~`|])/g,"\\$1");
}
function matchTeam(db, match, team, button = false) {
  if (!match || !["A","B"].includes(team)) return "Não definido";
  return captainTeam({discordId:team==="A"?match.captain_a_discord_id:match.captain_b_discord_id},db,button);
}
module.exports={captainTeam,matchTeam};
