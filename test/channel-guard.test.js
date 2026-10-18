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
        return { discord: { guildId: "guild", staffRoleId: "staff", staffChannelId: "requests", draftChannelId: "pick", queueChannelId: "queue", rankingChannelId: "table", resultsChannelId: "results" } };
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
  const command = (name, channelId, staff = false) => ({
    commandName: name, channelId, guildId: "guild", inGuild: () => true,
    isChatInputCommand: () => true,
    member: { roles: { cache: { has: role => staff && role === "staff" } } },
    reply: async () => {},
    guild: { channels: { cache: { find: predicate => {
      const channel = { id: "moderation", name: "✏️｜alterar-resultados" };
      return predicate(channel) ? channel : null;
    } } } }
  });
  for (const [name, target] of Object.entries({
    "limpar-fila": "queue", "remover-fila": "queue", "remover-timeout": "queue",
    ranking: "table", perfil: "table", temporada: "table", temporadas: "table",
    historico: "results", partida: "results", pontos: "moderation", solicitacoes: "requests"
  })) {
    assert.equal(await enforceChannel(command(name, target, true)), false, name);
    assert.equal(await enforceChannel(command(name, "general", true)), true, name);
    assert.equal(await enforceChannel(command(name, "1557714957007593472", true)), false, name);
    assert.equal(await enforceChannel(command(name, "1557714957007593472", false)), true, name);
  }
  for (const customId of ["clear_queue_confirm", "clear_queue_cancel"]) {
    const component = { ...command("", "queue", true), customId, isChatInputCommand: () => false, isButton: () => true };
    assert.equal(await enforceChannel(component), false);
    assert.equal(await enforceChannel({ ...component, channelId: "1557714957007593472" }), false);
    assert.equal(await enforceChannel({ ...component, channelId: "general" }), true);
  }

});
