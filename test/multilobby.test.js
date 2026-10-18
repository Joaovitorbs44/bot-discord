const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const Module = require("node:module");

const db = new Database(":memory:");
db.exec(`
 CREATE TABLE matchmaking_sessions (
   id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
   channel_id TEXT, stage TEXT NOT NULL, status TEXT NOT NULL,
   state_json TEXT NOT NULL DEFAULT '{}', deadline_at INTEGER,
   updated_at INTEGER, captain_a_discord_id TEXT, captain_b_discord_id TEXT,
   match_id INTEGER, current_turn_discord_id TEXT
 );
 CREATE TABLE matchmaking_session_players (
   id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, discord_id TEXT NOT NULL,
   ready_confirmed INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL DEFAULT 0,
   team TEXT, is_captain INTEGER NOT NULL DEFAULT 0,
   UNIQUE(session_id,discord_id)
 );
 CREATE TABLE matchmaking_waiting_players (
   guild_id TEXT NOT NULL, discord_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
   PRIMARY KEY(guild_id,discord_id)
 );
 CREATE TABLE matches(id INTEGER PRIMARY KEY, status TEXT);
 CREATE TABLE match_players(match_id INTEGER,discord_id TEXT);
`);
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "../database/database" &&
      parent?.filename?.includes("/src/services/")) return db;
  return originalLoad.apply(this, arguments);
};
const waiting = require("../src/services/waitingQueue");
const sessions = require("../src/services/matchmakingSessions");
const ready = require("../src/services/readyCheckSessions");
Module._load = originalLoad;

function firstPlayerInSession(id) { return db.prepare("SELECT discord_id FROM matchmaking_session_players WHERE session_id=? ORDER BY id LIMIT 1").get(id).discord_id; }

test("20 players form two isolated lobbies while waiting queue remains usable", () => {
  for (let i=1;i<=20;i++) assert.equal(waiting.enqueue("guild", "p"+i), true);
  const a = waiting.reserveIntoSession("guild", "channel", 10);
  const b = waiting.reserveIntoSession("guild", "channel", 10);
  assert.ok(a?.sessionId && b?.sessionId);
  assert.notEqual(a.sessionId,b.sessionId);
  assert.equal(new Set([...a.players,...b.players]).size,20);
  assert.equal(waiting.listWaiting("guild").length,0);
  assert.equal(waiting.enqueue("guild","p21"),true);
  assert.equal(waiting.enqueue("guild","p1"),false);
  assert.equal(sessions.getActiveSessions("guild").length,2);
});
test("ready confirmations remain isolated and idempotent", () => {
  const [a,b] = sessions.getActiveSessions("guild");
  assert.ok(ready.setDeadline(a.id,60));
  assert.ok(ready.setDeadline(b.id,60));
  const firstMember=ready.snapshot(a.id).waiting[0];
  assert.equal(ready.confirm(a.id,firstMember,"guild").ok,true);
  assert.equal(ready.confirm(a.id,firstMember,"guild").reason,"already_confirmed");
  assert.equal(ready.confirm(b.id,firstMember,"guild").reason,"not_member");
  assert.equal(ready.snapshot(a.id).confirmed.length,1);
  assert.equal(ready.snapshot(b.id).confirmed.length,0);
  assert.equal(ready.finishIfReady(a.id,10),null);
});
test("stage transitions and component IDs are session-scoped", () => {
  const [a,b] = sessions.getActiveSessions("guild");
  assert.equal(sessions.advance(a.id,"ready_check","captain_vote")?.stage,"captain_vote");
  assert.equal(sessions.getSession(b.id).stage,"ready_check");
  assert.throws(() => sessions.advance(a.id,"ready_check","draft"),/INVALID_STAGE_TRANSITION/);
  const id=sessions.componentId("captain_vote",a.id,"vote");
  assert.deepEqual(sessions.parseComponentId(id),{stage:"captain_vote",sessionId:a.id,action:"vote"});
  assert.equal(sessions.authorize({customId:id,guildId:"guild",user:{id:firstPlayerInSession(a.id)}})?.session.id,a.id);
  assert.equal(sessions.authorize({customId:id,guildId:"guild",user:{id:firstPlayerInSession(b.id)}}),null);
  assert.equal(sessions.authorize({customId:id,guildId:"other",user:{id:firstPlayerInSession(a.id)}}),null);
});
test("duplicate session handoff does not steal waiting players", () => {
  assert.equal(waiting.reserveIntoSession("guild","channel",10),null);
  assert.equal(waiting.listWaiting("guild").length,1);
});
test.after(() => { sessions.clearAllTimers(); db.close(); });
