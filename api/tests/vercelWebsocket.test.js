const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const repoRoot = resolve(__dirname, "../..");
const read = (file) => readFileSync(resolve(repoRoot, file), "utf8");

test("Vercel exposes a dedicated Socket.IO HTTP server function", () => {
  const config = JSON.parse(read("api/vercel.json"));
  const socketEntry = read("api/api/socket-io.js");
  const appEntry = read("api/app.js");

  assert.equal(config.functions["api/socket-io.js"].maxDuration, 60);
  assert.match(socketEntry, /module\.exports = server/);
  assert.match(appEntry, /module\.exports = \{ app, server, vercelHandler \}/);
});

test("production client uses Vercel's websocket-only Socket.IO path", () => {
  const configSource = read("src/config/apiConfig.js");
  const clientSource = read("src/socket/socketClient.js");

  assert.match(configSource, /huy-locket-api-huy-locket\.vercel\.app\/api\/socket-io/);
  assert.match(clientSource, /transports:\s*\["websocket"\]/);
  assert.doesNotMatch(clientSource, /transports:\s*\["websocket",\s*"polling"\]/);
});
