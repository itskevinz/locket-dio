import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

test("slot push client subscribes through service worker and authenticated backend", () => {
  const source = read("src/features/SlotMonitor/slotPushService.js");
  assert.match(source, /navigator\.serviceWorker\.ready/);
  assert.match(source, /pushManager\.subscribe/);
  assert.match(source, /api\/slot-monitor\/enable/);
  assert.match(source, /refreshToken/);
});

test("slot monitor syncs watches to backend and exposes a 24\/7 sidebar entry", () => {
  const provider = read("src/features/SlotMonitor/SlotMonitorProvider.jsx");
  const sidebar = read("src/components/Sidebar/index.jsx");
  assert.match(provider, /syncSlotWatch/);
  assert.match(provider, /enableBackgroundPush/);
  assert.match(sidebar, /\/friends\?slot=1/);
  assert.match(sidebar, /Canh Slot/);
  assert.match(sidebar, /24\/7/);
});

test("service worker handles push and notification clicks", () => {
  const sw = read("src/sw.js");
  assert.match(sw, /addEventListener\(["']push["']/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /addEventListener\(["']notificationclick["']/);
  assert.match(sw, /openWindow/);
});

test("backend mounts persistent slot monitor and relationship workers", () => {
  const app = read("api/app.js");
  const routes = read("api/src/routes/index.js");
  const slotIndex = read("api/src/modules/slotMonitor/index.js");
  assert.match(app, /startSlotMonitorWorker/);
  assert.match(routes, /slot-monitor/);
  assert.match(slotIndex, /startRelationshipWorker/);
});

test("auto Celeb request is opt-in and wired to the real Locket follow request", () => {
  const worker = read("api/src/modules/slotMonitor/service.js");
  const requestService = read("api/src/services/LocketFriend/RequestServices.js");
  const store = read("api/src/modules/slotMonitor/store.js");
  const ui = read("src/features/SlotMonitor/SlotWatchInline.jsx");

  assert.match(store, /auto_request_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(worker, /appCheckServices\.getOrCreateAppCheckToken/);
  assert.match(worker, /requestServices\.SendAddCelebrity/);
  assert.match(requestService, /instanceLocketV2\.post\("sendFollowRequest"/);
  assert.match(requestService, /intent:\s*"add-friend"/);
  assert.match(worker, /status:\s*"SENT"/);
  assert.match(worker, /status:\s*"FAILED"/);
  assert.match(ui, /Tự gửi request Celeb khi có slot/);
});

test("SENT means request is pending, not a completed watch", () => {
  const store = read("api/src/modules/slotMonitor/store.js");
  const relationshipWorker = read(
    "api/src/modules/slotMonitor/relationshipWorker.js",
  );

  assert.doesNotMatch(
    store,
    /COALESCE\(w?\.?last_auto_request_status,\s*''\)\s*<>\s*'SENT'/,
  );
  assert.match(relationshipWorker, /last_auto_request_status[\s\S]*===\s*"SENT"/);
  assert.match(relationshipWorker, /isPendingRelationship/);
  assert.match(relationshipWorker, /status:\s*"FRIENDS"/);
  assert.match(relationshipWorker, /setWatchEnabled\(userUid, watch\.celeb_uid, false\)/);
});

test("false historical SENT is reset and waitlist is not send success", () => {
  const relationshipWorker = read(
    "api/src/modules/slotMonitor/relationshipWorker.js",
  );
  const relationshipPolicy = read(
    "api/src/services/LocketFriend/relationshipPolicy.js",
  );

  assert.match(relationshipWorker, /REQUEST_NOT_PENDING/);
  assert.match(relationshipWorker, /status:\s*"FAILED"/);
  assert.doesNotMatch(
    relationshipPolicy,
    /CELEBRITY_CONFIRMED_RELATIONSHIPS[\s\S]*"follower-waitlist"/,
  );
});

test("local slot state stops polling at FRIENDS without deleting the card", () => {
  const core = read("src/features/SlotMonitor/slotMonitorCore.js");
  const provider = read("src/features/SlotMonitor/SlotMonitorProvider.jsx");
  assert.match(core, /FRIENDS:\s*"FRIENDS"/);
  assert.match(core, /snapshot\?\.isFriend/);
  assert.match(core, /status:\s*SLOT_STATUS\.FRIENDS/);
  assert.doesNotMatch(provider, /removeSlotWatch\(latest\.uid\)/);
});
