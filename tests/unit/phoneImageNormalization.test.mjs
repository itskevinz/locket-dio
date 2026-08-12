import test from "node:test";
import assert from "node:assert/strict";

import { MAX_IMAGE_UPLOAD_MB } from "../../src/config/uploadLimits.js";
import {
  classifyPhoneMedia,
  detectPhoneImageFormat,
  normalizePhoneImage,
  parseJpegExifOrientation,
} from "../../src/utils/imageUtils/normalizePhoneImage.js";

function namedBlob(parts, name, type = "") {
  const blob = new Blob(
    parts.map((part) => (Array.isArray(part) ? new Uint8Array(part) : part)),
    { type },
  );
  Object.defineProperty(blob, "name", { value: name });
  Object.defineProperty(blob, "lastModified", { value: 1 });
  return blob;
}

function jpegWithOrientation(orientation, littleEndian = true) {
  const tiff = littleEndian
    ? [
        0x49, 0x49, 0x2a, 0x00,
        0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
        orientation, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]
    : [
        0x4d, 0x4d, 0x00, 0x2a,
        0x00, 0x00, 0x00, 0x08,
        0x00, 0x01,
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
        0x00, orientation, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const segmentLength = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1,
    (segmentLength >> 8) & 0xff,
    segmentLength & 0xff,
    ...payload,
    0xff, 0xd9,
  ]);
}

test("classifies phone images and videos even when the picker omits MIME", () => {
  assert.equal(classifyPhoneMedia({ name: "IMG_1234.HEIC", type: "" }), "image");
  assert.equal(classifyPhoneMedia({ name: "camera.AVIF", type: "" }), "image");
  assert.equal(classifyPhoneMedia({ name: "clip.MOV", type: "" }), "video");
  assert.equal(classifyPhoneMedia({ name: "unsafe.svg", type: "image/svg+xml" }), null);
});

test("sniffs JPEG, PNG, WebP and HEIC/AVIF container signatures", async () => {
  assert.equal(
    await detectPhoneImageFormat(namedBlob([[0xff, 0xd8, 0xff, 0xd9]], "x.bin")),
    "jpeg",
  );
  assert.equal(
    await detectPhoneImageFormat(
      namedBlob([[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], "x.bin"),
    ),
    "png",
  );
  assert.equal(
    await detectPhoneImageFormat(
      namedBlob([new TextEncoder().encode("RIFF0000WEBP")], "x.bin"),
    ),
    "webp",
  );
  assert.equal(
    await detectPhoneImageFormat(
      namedBlob([new TextEncoder().encode("0000ftypheic0000")], "x.bin"),
    ),
    "heic",
  );
  assert.equal(
    await detectPhoneImageFormat(
      namedBlob([new TextEncoder().encode("0000ftypavif0000")], "x.bin"),
    ),
    "avif",
  );
});

test("reads all valid JPEG EXIF orientation values without endian assumptions", () => {
  assert.equal(parseJpegExifOrientation(jpegWithOrientation(6, true)), 6);
  assert.equal(parseJpegExifOrientation(jpegWithOrientation(8, false)), 8);
  assert.equal(parseJpegExifOrientation(jpegWithOrientation(0, true)), 1);
  assert.equal(parseJpegExifOrientation(new Uint8Array([1, 2, 3])), 1);
});

test("rejects source images over the shared 10 MB limit before decoding", async () => {
  const oversized = namedBlob(
    [new Uint8Array(MAX_IMAGE_UPLOAD_MB * 1024 * 1024 + 1)],
    "large.jpg",
    "image/jpeg",
  );
  await assert.rejects(
    normalizePhoneImage(oversized),
    (error) => error?.code === "IMAGE_TOO_LARGE" && /10 MB/.test(error.message),
  );
});
