const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { cleanup } = require("../src/services/panelLifecycle");

test("cleanup deletes only recorded bot panels and tolerates already removed messages", async () => {
  const removed = [];
  const messages = {
    old: { id: "old", author: { id: "bot" }, delete: async () => removed.push("old") },
    user: { id: "user", author: { id: "human" }, delete: async () => removed.push("user") }
  };
  const client = { user: { id: "bot" }, channels: { fetch: async () => ({ messages: { fetch: async id => {
    if (!messages[id]) throw Object.assign(new Error("Unknown Message"), { code: 10008 });
    return messages[id];
  } } }) } };
  await cleanup(client, { ready: { channelId: "pick", messageId: "old" }, other: { channelId: "pick", messageId: "user" }, missing: { channelId: "pick", messageId: "gone" } }, ["ready", "other", "missing"]);
  assert.deepEqual(removed, ["old"]);
});

test("draft publication keeps previous panel on failure and removes it after successful handoff", async () => {
  const filename = require.resolve("../src/services/draftPanels");
  const original = Module._load;
  const state = { captainVotePanel: { channelId: "pick", messageId: "vote" } };
  const session = { id: 1, stage: "draft", status: "active", captain_a_discord_id: "a", captain_b_discord_id: "b" };
  let publish;
  try {
    Module._load = function(request, parent) {
      if (parent?.filename === filename) {
        if (request === "./matchmakingSessions") return {
          getSession: () => session, parseState: () => state,
          componentId: () => "draft:1", updateState: (id, stage, patch) => Object.assign(state, patch)
        };
        if (request === "./draftSessions") return { snapshot: () => ({ session, roster: [{ discord_id: "a", team: "A" }, { discord_id: "b", team: "B" }], picks: 0, turn: "A" }) };
        if (request === "../config/config") return { discord: { draftChannelId: "pick" } };
      }
      return original.apply(this, arguments);
    };
    delete require.cache[filename];
    ({ publish } = require(filename));
  } finally { Module._load = original; }
  const events = [];
  let fail = true;
  const channel = { id: "pick", isTextBased: () => true,
    messages: { fetch: async id => ({ id, author: { id: "bot" }, delete: async () => events.push(`delete:${id}`), edit: async () => events.push("edit") }) },
    send: async () => { if (fail) throw new Error("No send permission"); events.push("send"); return { id: "draft" }; }
  };
  const client = { user: { id: "bot" }, channels: { fetch: async () => channel } };
  await assert.rejects(publish(client, 1), /No send permission/);
  assert.deepEqual(events, []);
  fail = false;
  await publish(client, 1);
  assert.deepEqual(events, ["send", "delete:vote"]);
  assert.equal(state.draftPanel.messageId, "draft");
  delete require.cache[filename];
});

test("ready-check first publication goes directly to pick-players and includes player notifications", async () => {
  const filename = require.resolve("../src/services/readyCheckPanels");
  const original = Module._load;
  const session = { id: 1, stage: "ready_check", status: "active", channel_id: "queue" };
  const snapshot = { sessionId: 1, stage: "ready_check", status: "active", deadline: Date.now() + 60000, total: 10, confirmed: [], waiting: ["one", "two"] };
  let publish;
  try {
    Module._load = function(request, parent) {
      if (parent?.filename === filename) {
        if (request === "./matchmakingSessions") return { getSession: () => session, parseState: () => ({}), updateState: () => {}, componentId: () => "ready:1" };
        if (request === "./readyCheckSessions") return { snapshot: () => snapshot };
        if (request === "../config/config") return { discord: { draftChannelId: "pick", queueChannelId: "queue" } };
      }
      return original.apply(this, arguments);
    };
    delete require.cache[filename];
    ({ publish } = require(filename));
  } finally { Module._load = original; }
  let sent;
  const client = { channels: { fetch: async id => {
    assert.equal(id, "pick");
    return { id, isTextBased: () => true, send: async payload => { sent = payload; return { id: "ready" }; } };
  } } };
  await publish(client, 1);
  assert.deepEqual(sent.allowedMentions.users, ["one", "two"]);
  assert.match(JSON.stringify(sent.components), /Partida encontrada/);
  delete require.cache[filename];
});
