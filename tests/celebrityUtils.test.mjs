import assert from "node:assert/strict";
import test from "node:test";

import {
  categorizeCelebrityUsers,
  groupCelebrityRecords,
  mapWithConcurrency,
  mapWithConcurrencySettled,
  mergeCelebrityWithUser,
  normalizeCelebrityRecords,
} from "../src/pages/Auth/LocketDioTools/tools/CelebrityTool/celebrityUtils.js";

const records = normalizeCelebrityRecords([
  {
    id: 1,
    uid: "vn-1",
    username: "verified_vn",
    displayName: "Verified VN",
    locketUrl: "https://locket.cam/verified_vn",
    countryCode: "vn",
  },
  {
    id: 2,
    uid: "us-1",
    username: "verified_us",
    displayName: "Verified US",
    locketUrl: "https://locket.cam/verified_us",
    countryCode: "US",
  },
]);

test("normalizes and groups the persistent catalog by real country data", () => {
  const grouped = groupCelebrityRecords(records);
  assert.deepEqual(Object.keys(grouped), ["VN", "US"]);
  assert.equal(grouped.VN[0].uid, "vn-1");
});

test("rejects duplicate persistent UIDs instead of hiding bad data", () => {
  assert.throws(
    () => normalizeCelebrityRecords([records[0], records[0]]),
    /DUPLICATE_CELEBRITY_UID/,
  );
});

test("merges live friendship data without changing catalog identity", () => {
  const merged = mergeCelebrityWithUser(records[0], {
    uid: "wrong",
    username: "live_name",
    friendship_status: "friends",
  });
  assert.equal(merged.uid, "vn-1");
  assert.equal(merged.username, "live_name");
  assert.equal(merged.country_code, "VN");
});

test("quick-filter counters only use known live slot data", () => {
  const users = [
    { friendship_status: "friends", celebrity_data: { friend_count: 2, max_friends: 5 } },
    { friendship_status: "follower-waitlist", celebrity_data: { friend_count: 5, max_friends: 5 } },
    { friendship_status: "outgoing-follow-request" },
  ];
  const categorized = categorizeCelebrityUsers(users);
  assert.equal(categorized.friends.length, 1);
  assert.equal(categorized.waitlist.length, 1);
  assert.equal(categorized.waitaccept.length, 1);
  assert.equal(categorized.hasSlot.length, 1);
  assert.equal(categorized.noSlot.length, 1);
});

test("detail hydration honors its concurrency cap", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return item * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test("detail hydration keeps available Celebrity profiles", async () => {
  const results = await mapWithConcurrencySettled([1, 2, 3], 2, async (item) => {
    if (item === 2) throw new Error("profile unavailable");
    return item * 10;
  });

  assert.deepEqual(
    results.map((result) =>
      result.status === "fulfilled" ? result.value : result.status,
    ),
    [10, "rejected", 30],
  );
});
