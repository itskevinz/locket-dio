const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const apiRoot = resolve(__dirname, "..");
const read = (file) => readFileSync(resolve(apiRoot, file), "utf8");

test("Vercel music metadata uses Neon and audio uses configured Google Drive", () => {
  const service = read("src/modules/music/services/musicLibrary.service.js");
  const database = read("src/modules/music/store/musicDatabase.js");
  const drive = read("src/modules/vercelDrive.js");

  assert.match(service, /musicDatabase\.isAvailable\(\)/);
  assert.match(service, /audioUrl: `gdrive:\$\{saved\.id\}`/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS huy_locket_music_tracks/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS huy_locket_moment_music/);
  assert.match(drive, /mediaType === "audio"/);
});

test("Google Drive audio URLs are served through the backend", () => {
  const { toPublicTrack } = require("../src/modules/music/services/musicLibrary.service");
  const row = toPublicTrack(
    { id: "track", audioUrl: "gdrive:drive_file_123", isPublic: true },
    "https://api.example.test",
  );

  assert.equal(
    row.audioUrl,
    "https://api.example.test/api/music/audio/drive/drive_file_123",
  );
});
