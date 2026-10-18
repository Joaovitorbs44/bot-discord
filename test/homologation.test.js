const test = require("node:test");
const assert = require("node:assert/strict");
const { authorized, command } = require("../src/scripts/homologation");

test("homologation requires the authorized guild, channel and staff role", () => {
  const config = { discord: { guildId: "guild", staffRoleId: "staff" } };
  const interaction = {
    inGuild: () => true, guildId: "guild", channelId: "1557714957007593472",
    memberPermissions: { has: () => false },
    member: { roles: { cache: { has: role => role === "staff" } } }
  };
  assert.equal(authorized(interaction, config), true);
  assert.equal(authorized({ ...interaction, channelId: "public" }, config), false);
  assert.equal(authorized({ ...interaction, guildId: "other" }, config), false);
  assert.equal(authorized({ ...interaction, inGuild: () => false }, config), false);
  assert.equal(Boolean(authorized({ ...interaction, member: null }, config)), false);
  assert.equal(authorized({ ...interaction, member: null, memberPermissions: { has: () => true } }, config), true);
  assert.equal(command.toJSON().dm_permission, false);
});
