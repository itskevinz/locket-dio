const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sniffRollcallMediaType,
} = require("../src/utils/rollcallMediaType");

test("detects image bytes when CDN declares octet-stream", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]);

  assert.equal(sniffRollcallMediaType(jpeg, "application/octet-stream"), "image/jpeg");
  assert.equal(sniffRollcallMediaType(png, "binary/octet-stream"), "image/png");
});

test("detects MP4 and WebM Rollcall clips", () => {
  const mp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypmp42", "ascii"),
  ]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]);

  assert.equal(sniffRollcallMediaType(mp4, "application/octet-stream"), "video/mp4");
  assert.equal(sniffRollcallMediaType(webm, "application/octet-stream"), "video/webm");
});

test("rejects HTML and JSON disguised as media", () => {
  assert.equal(sniffRollcallMediaType(Buffer.from("<html>denied</html>"), "text/html"), "");
  assert.equal(sniffRollcallMediaType(Buffer.from('{"error":true}'), "application/json"), "");
});
