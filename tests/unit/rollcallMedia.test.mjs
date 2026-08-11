import test from "node:test";
import assert from "node:assert/strict";

const sourceUrl = new URL("../../src/utils/rollcallUrlFields.js", import.meta.url);
const source = await import(sourceUrl);

test("finds Rollcall URLs inside new nested media variants", () => {
  const item = {
    payload: {
      mediaAsset: {
        original: { uri: "https://cdn.locketcamera.com/new/photo.webp?sig=1" },
        preview: { stringValue: "https://cdn.locketcamera.com/new/thumb.webp?sig=2" },
      },
    },
  };

  assert.equal(
    source.collectNestedRollcallUrls(item, "main")[0],
    "https://cdn.locketcamera.com/new/photo.webp?sig=1",
  );
  assert.equal(
    source.collectNestedRollcallUrls(item, "thumbnail")[0],
    "https://cdn.locketcamera.com/new/thumb.webp?sig=2",
  );
});

test("does not mistake nested user avatars for Rollcall media", () => {
  const item = {
    user: { profile: { avatar_url: "https://cdn.locketcamera.com/avatar.jpg" } },
  };

  assert.deepEqual(
    source.collectNestedRollcallUrls(item, "main"),
    [],
  );
});
