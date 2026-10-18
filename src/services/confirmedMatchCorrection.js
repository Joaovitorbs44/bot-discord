// Historical correction explicitly confirmed by the server owner on 2026-10-18.
// #298604 was played on Fortress. WhoShotYa621 = koringa621;
// Saafewga = ysousa. No participant, result or score correction is authorized.
const ACTION = "confirmed_map_correction_298604_20261018";
function apply(db) {
  return db.transaction(() => {
    const match = db.prepare("SELECT * FROM matches WHERE match_code IN ('#298604','298604')").get();
    if (!match) return { status: "not_found" };
    if (db.prepare("SELECT 1 FROM staff_actions WHERE action_type=? AND match_id=?").get(ACTION,match.id)) {
      return { status: "already_applied", map: match.map };
    }
    if (match.map === "Fortress") return { status: "already_correct", map: match.map };
    if (match.map !== "Kafe Dostoyevsky" || match.status !== "finished" || match.winner_team !== "B") {
      return { status: "precondition_failed", map: match.map };
    }
    const roster = db.prepare("SELECT p.r6_nickname,mp.discord_id FROM match_players mp JOIN players p ON p.discord_id=mp.discord_id WHERE mp.match_id=?").all(match.id);
    const normal = value => String(value).replace(/[^a-z0-9]/gi,"").toLowerCase();
    const names = new Set(roster.map(player=>normal(player.r6_nickname)));
    const captain = roster.find(player=>player.discord_id===match.captain_b_discord_id);
    if (roster.length !== 10 || !names.has("whoshotya621") || !names.has("saafewga") || normal(captain?.r6_nickname) !== "yhackzz7") {
      return { status: "roster_mismatch", map: match.map };
    }
    const updated = db.prepare("UPDATE matches SET map='Fortress' WHERE id=? AND map='Kafe Dostoyevsky'").run(match.id);
    if (updated.changes !== 1) throw new Error("CONFIRMED_MAP_CORRECTION_FAILED");
    const after = db.prepare("SELECT * FROM matches WHERE id=?").get(match.id);
    if (JSON.stringify({...match,map:"Fortress"}) !== JSON.stringify(after)) throw new Error("MATCH_FIELDS_CHANGED_UNEXPECTEDLY");
    db.prepare("INSERT INTO staff_actions(staff_discord_id,action_type,match_id,reason,details_json) VALUES(?,?,?,?,?)")
      .run("system:user-confirmed",ACTION,match.id,"Mapa Fortaleza confirmado pelo dono do servidor na conversa de suporte.",JSON.stringify({before:match.map,after:after.map,matchCode:match.match_code,confirmation:"2026-10-18",pointsChanged:false,playersChanged:false}));
    return { status: "corrected", map: after.map };
  })();
}
module.exports = { apply };
