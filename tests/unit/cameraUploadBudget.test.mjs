import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_INLINE_TARGET_BYTES,
  cameraJpegEncodingPlan,
} from "../../src/utils/device/capturePhoto.js";

test("camera images target the reliable inline upload route", () => {
  const storageInlineLimit = 4.5 * 1024 * 1024;
  assert.ok(CAMERA_INLINE_TARGET_BYTES < storageInlineLimit);
  assert.ok(CAMERA_INLINE_TARGET_BYTES >= 4 * 1024 * 1024);
});

test("large mobile frames retain a high-quality first attempt and have bounded fallbacks", () => {
  const plan = cameraJpegEncodingPlan(4096);

  assert.deepEqual(plan[0], { side: 4096, quality: 0.96 });
  assert.ok(plan.some((attempt) => attempt.side === 2560));
  assert.ok(plan.some((attempt) => attempt.side === 2048));
  assert.deepEqual(plan.at(-1), { side: 1600, quality: 0.72 });
});

test("normal desktop frames are never upscaled", () => {
  const plan = cameraJpegEncodingPlan(1280);
  assert.ok(plan.every((attempt) => attempt.side === 1280));
  assert.deepEqual(plan[0], { side: 1280, quality: 0.96 });
});
