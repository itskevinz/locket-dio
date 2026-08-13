const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const repoRoot = resolve(__dirname, "../..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

test("heuristic WAF detections never create permanent IP bans", () => {
  const source = read("api/src/middlewares/antiBot.js");

  assert.doesNotMatch(source, /addIpBlacklist/);
  assert.doesNotMatch(source, /AUTO-BANNING IP/);
  assert.doesNotMatch(source, /BANNED_FOREVER/);
  assert.match(source, /Permanent bans remain an\s+\/\/ explicit admin action/);
});

test("startup retires legacy automatic bans but preserves admin bans", () => {
  const source = read("api/src/services/userActivityStore.js");

  assert.match(source, /DELETE FROM ip_blacklist\s+WHERE blocked_by = 'SYSTEM_WAF_v2'/);
  assert.match(source, /SELECT ip_address FROM ip_blacklist/);
});

test("Drive OAuth POST sends JSON and the current identity token", () => {
  const source = read("src/pages/Public/Settings/GoogleDriveBackup.jsx");

  assert.match(source, /fetch\("\/api\/drive-oauth-start"/);
  assert.match(source, /"Content-Type": "application\/json"/);
  assert.match(source, /Authorization: `Bearer \$\{getStoredIdToken\(\)\}`/);
});
