const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const sharp = require("sharp");
const {
  processImageBuffer,
} = require("../src/utils/process/processImageBuffer");
const tempMedia = require("../src/modules/storage/tempMediaStore");

test("image processing keeps native square resolution when no cap is requested", async () => {
  const input = await sharp({
    create: {
      width: 3000,
      height: 2200,
      channels: 3,
      background: { r: 36, g: 112, b: 198 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();

  const output = await processImageBuffer({
    imageBuffer: input,
    maxSizeMB: 32,
    resolution: null,
  });

  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 2200);
  assert.equal(metadata.height, 2200);
});

test("8192 safety ceiling does not downscale normal high-resolution camera photos", async () => {
  const input = await sharp({
    create: {
      width: 4096,
      height: 3072,
      channels: 3,
      background: { r: 210, g: 90, b: 70 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();

  const output = await processImageBuffer({
    imageBuffer: input,
    maxSizeMB: 32,
    resolution: 8192,
  });

  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 3072);
  assert.equal(metadata.height, 3072);
});

test("temporary media transport leaves headroom below the 25 MB raw endpoint", () => {
  assert.equal(tempMedia.MAX_BYTES, 24 * 1024 * 1024);
  assert.ok(tempMedia.MAX_BYTES < 25 * 1024 * 1024);
});

test("detailed phone photos are encoded below the final Storage budget", async () => {
  const side = 1536;
  const noisyPixels = crypto.randomBytes(side * side * 3);
  const input = await sharp(noisyPixels, {
    raw: { width: side, height: side, channels: 3 },
  })
    .jpeg({ quality: 96 })
    .toBuffer();

  const maxSizeMB = 4;
  const output = await processImageBuffer({
    imageBuffer: input,
    maxSizeMB,
    resolution: 8192,
  });

  assert.ok(output.length <= maxSizeMB * 1024 * 1024);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
});
