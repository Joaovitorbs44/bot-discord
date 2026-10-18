const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("production queue dependency graph loads with an isolated database", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-load-"));
  try {
    const env = { PATH: process.env.PATH, DATABASE_PATH: path.join(root, "test.sqlite") };
    for (const name of ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID", "ACCESS_CHANNEL_ID", "STAFF_CHANNEL_ID", "STAFF_ROLE_ID", "PLAYER_ROLE_ID", "QUEUE_CHANNEL_ID", "RANKING_CHANNEL_ID", "MAP_VETO_CHANNEL_ID", "DRAFT_CHANNEL_ID", "RESULTS_CHANNEL_ID", "LOG_CHANNEL_ID"]) env[name] = "test";
    const run = spawnSync(process.execPath, ["-e", 'require("./src/database/schema")(); require("./src/scripts/scoreboards"); require("./src/scripts/queue"); require("./src/services/multiLobbyQueue"); require("./src/services/matchmakingInteractionRouter")'], {
      cwd: path.resolve(__dirname, ".."), env, encoding: "utf8", timeout: 15000
    });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
