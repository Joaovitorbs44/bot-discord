const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("preview command and components use painel-staff independently of requests channel", async () => {
  const original = Module._load;
  const filename = require.resolve("../src/scripts/channelGuard");
  let enforceChannel;
  try {
    Module._load = function(request, parent) {
      if (parent?.filename === filename && request === "../config/config") {
        return { discord: { staffChannelId: "requests", draftChannelId: "pick" } };
      }
      return original.apply(this, arguments);
    };
    delete require.cache[filename];
    ({ enforceChannel } = require(filename));
  } finally { Module._load = original; }
  for (const customId of [null, "preview_select", "preview_action:fill", "preview_choice:ready"]) {
    for (const channelId of ["1557714957007593472", "requests"]) {
      const replies = [];
      const interaction = {
        commandName: "preview", customId, channelId,
        isChatInputCommand: () => customId === null,
        isButton: () => customId?.startsWith("preview_action:") || false,
        isStringSelectMenu: () => customId !== null,
        reply: async payload => replies.push(payload)
      };
      const denied = channelId === "requests";
      assert.equal(await enforceChannel(interaction), denied);
      assert.equal(replies.length, denied ? 1 : 0);
      if (denied) assert.match(replies[0].content, /1557714957007593472/);
    }
  }
  for (const customId of ["ready_confirm", "captain_vote"]) {
    const replies = [];
    const interaction = { customId, channelId: "pick", isChatInputCommand: () => false, isButton: () => true, reply: async payload => replies.push(payload) };
    assert.equal(await enforceChannel(interaction), false);
    assert.equal(await enforceChannel({ ...interaction, channelId: "queue" }), true);
    assert.match(replies[0].content, /<#pick>/);
  }
  assert.equal(await enforceChannel({ commandName: "solicitacoes", channelId: "requests", isChatInputCommand: () => true }), false);
});
