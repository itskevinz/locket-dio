const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  processImageBuffer,
} = require("../src/utils/process/processImageBuffer");
const tempMedia = require("../src/modules/storage/tempMediaStore");

test("image processing keeps smaller native square images without upscaling", async () => {
  const input = await sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 36, g: 112, b: 198 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();

  const output = await processImageBuffer({
    imageBuffer: input,
    maxSizeMB: 2.5,
    resolution: 2048,
  });

  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
  assert.ok(output.length <= 2.5 * 1024 * 1024);
});

test("4K phone sources are accepted and normalized to a safe Locket object", async () => {
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
    maxSizeMB: 2.5,
    resolution: 2048,
  });

  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 2048);
  assert.equal(metadata.height, 2048);
  assert.ok(output.length <= 2.5 * 1024 * 1024);
});

test("dark noisy close-up style images cannot exceed the Firebase output budget", async () => {
  const width = 2200;
  const height = 2200;
  const raw = Buffer.allocUnsafe(width * height * 3);

  // Deterministic high-frequency sensor-like noise. This is intentionally hard
  // for lossless WebP and protects against the intermittent close-up 403.
  let state = 0x12345678;
  for (let i = 0; i < raw.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    raw[i] = 12 + ((state >>> 24) % 70);
  }

  const input = await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 98, chromaSubsampling: "4:4:4" })
    .toBuffer();
  assert.ok(input.length <= 10 * 1024 * 1024);
  const output = await processImageBuffer({
    imageBuffer: input,
    maxSizeMB: 2.5,
    resolution: 2048,
  });

  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(metadata.width <= 2048);
  assert.ok(metadata.height <= 2048);
  assert.ok(output.length <= 2.5 * 1024 * 1024);
});

test("temporary media transport leaves headroom below the 25 MB raw endpoint", () => {
  assert.equal(tempMedia.MAX_BYTES, 24 * 1024 * 1024);
  assert.ok(tempMedia.MAX_BYTES < 25 * 1024 * 1024);
});
