import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeStableMomentOrder } from "../../src/utils/moment/stableMomentOrder.js";

const merge = (current, fresh) => ({ ...(current || {}), ...(fresh || {}) });
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const gallerySource = fs.readFileSync(
  path.join(
    projectRoot,
    "src/pages/LocketCameraBeta/BottomHomeScreen/Views/GridMoments/MomentsGallery.jsx",
  ),
  "utf8",
);
const storeSource = fs.readFileSync(
  path.join(projectRoot, "src/stores/MomentStores/index.js"),
  "utf8",
);

test("a soft refresh updates fields without reordering existing moments", () => {
  const existing = [
    { id: "a", value: "cached-a" },
    { id: "b", value: "cached-b" },
    { id: "c", value: "cached-c" },
  ];
  const refreshed = [
    { id: "c", value: "fresh-c" },
    { id: "a", value: "fresh-a" },
    { id: "b", value: "fresh-b" },
  ];

  const result = mergeStableMomentOrder(existing, refreshed, merge);

  assert.deepEqual(result.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(result.map((item) => item.value), [
    "fresh-a",
    "fresh-b",
    "fresh-c",
  ]);
});

test("only genuinely new moments are prepended", () => {
  const result = mergeStableMomentOrder(
    [{ id: "a" }, { id: "b" }],
    [{ id: "new-2" }, { id: "new-1" }, { id: "a", refreshed: true }],
    merge,
  );

  assert.deepEqual(result.map((item) => item.id), [
    "new-2",
    "new-1",
    "a",
    "b",
  ]);
  assert.equal(result[2].refreshed, true);
});

test("older pagination appends without moving the visible list", () => {
  const result = mergeStableMomentOrder(
    [{ id: "a" }, { id: "b" }],
    [{ id: "b", refreshed: true }, { id: "old-1" }, { id: "old-2" }],
    merge,
    { newItemsAt: "end" },
  );

  assert.deepEqual(result.map((item) => item.id), [
    "a",
    "b",
    "old-1",
    "old-2",
  ]);
  assert.equal(result[1].refreshed, true);
});

test("history grid restores a moment-id anchor after refresh or detail view", () => {
  assert.match(gallerySource, /data-history-moment-id/);
  assert.match(gallerySource, /restoreScrollAnchor/);
  assert.match(gallerySource, /detailWasOpenRef/);
});

test("soft moment refresh keeps the expanded visible count", () => {
  assert.match(
    storeSource,
    /visibleCount:\s*bucket\.moments\.length[\s\S]*Math\.max\(bucket\.visibleCount, initialVisible\)/,
  );
});
