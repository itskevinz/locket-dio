const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "huy-locket-stats-test-"));
const originalCwd = process.cwd();
process.chdir(testRoot);
delete process.env.VERCEL;

const statsStore = require("../src/utils/cache/localUploadStats");

test("upload stats preserve the local-disk fallback", async (t) => {
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  assert.equal((await statsStore.getUserStats("owner-one")).total_uploads, 0);

  await statsStore.incrementUserStats({
    uid: "owner-one",
    mediaType: "image",
    sizeInBytes: 2048,
  });
  const incremented = await statsStore.incrementUserStats({
    uid: "owner-one",
    mediaType: "video",
    sizeInBytes: 4096,
  });
  assert.equal(incremented.image_uploaded, 1);
  assert.equal(incremented.video_uploaded, 1);
  assert.equal(incremented.total_storage_used_bytes, 6144);

  const synced = await statsStore.setUserStats("owner-one", {
    image_uploaded: 8,
    video_uploaded: 3,
    total_storage_used_bytes: 1024,
    error_count: 2,
  });
  assert.equal(synced.total_uploads, 11);
  assert.equal((await statsStore.getUserStats("owner-one")).error_count, 2);
});
