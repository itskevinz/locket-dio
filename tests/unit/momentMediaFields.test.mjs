import test from "node:test";
import assert from "node:assert/strict";

import {
  getMomentImageCandidates,
  mergeMomentMediaFields,
} from "../../src/utils/moment/momentMediaFields.js";

test("fresh camelCase media replaces an expired snake_case cache entry", () => {
  const merged = mergeMomentMediaFields(
    {
      image_url: "https://old.example/expired.webp",
      thumbnail_url: "https://old.example/expired-thumb.webp",
    },
    {
      imageUrl: "https://fresh.example/image.webp",
      thumbnailUrl: "https://fresh.example/thumb.webp",
    },
  );

  assert.equal(merged.image_url, "https://fresh.example/image.webp");
  assert.equal(merged.imageUrl, "https://fresh.example/image.webp");
  assert.equal(merged.thumbnail_url, "https://fresh.example/thumb.webp");
  assert.equal(merged.thumbnailUrl, "https://fresh.example/thumb.webp");
});

test("gallery candidates retain explicit CDN aliases and host fallbacks", () => {
  const firebase =
    "https://firebasestorage.googleapis.com/v0/b/demo/o/a.webp?alt=media&token=x";
  const explicitCdn =
    "https://cdn.locketcamera.com/v0/b/demo/o/other.webp?alt=media&token=y";
  const candidates = getMomentImageCandidates({
    thumbnail_url: firebase,
    thumbnailCdnUrl: explicitCdn,
  });

  assert.equal(candidates[0], firebase);
  assert.ok(candidates.includes(explicitCdn));
  assert.ok(
    candidates.includes(
      firebase.replace(
        "https://firebasestorage.googleapis.com",
        "https://cdn.locketcamera.com",
      ),
    ),
  );
});
