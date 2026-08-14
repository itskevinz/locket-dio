const test = require("node:test");
const assert = require("node:assert/strict");

const {
  presentSlotWorkerProbe,
  presentWebProbe,
} = require("../src/modules/slotMonitor/systemStatus");

test("healthy Web stays OK when its commit differs from the API", () => {
  const result = presentWebProbe(
    { ok: true, latencyMs: 90, commit: "f1abf7214e152b3f" },
    "cce8e6a7b27d4728",
  );

  assert.equal(result.status, "OK");
  assert.equal(result.matchesApi, false);
  assert.match(result.detail, /Web\/API triển khai độc lập/);
  assert.doesNotMatch(result.detail, /KHÁC commit API/);
});

test("healthy Web reports when it shares the API commit", () => {
  const result = presentWebProbe(
    { ok: true, latencyMs: 120, commit: "f1abf721" },
    "f1abf7214e152b3f",
  );

  assert.equal(result.status, "OK");
  assert.equal(result.matchesApi, true);
  assert.match(result.detail, /cùng phiên bản API/);
});

test("Web becomes an error only when its health probe fails", () => {
  const result = presentWebProbe(
    { ok: false, latencyMs: 7000, commit: "", error: "HTTP 503" },
    "cce8e6a7b27d4728",
  );

  assert.equal(result.status, "ERROR");
  assert.match(result.detail, /HTTP 503/);
});

test("Render worker is OK only when health and worker states are running", () => {
  const result = presentSlotWorkerProbe({
    ok: true,
    latencyMs: 75,
    data: { status: "healthy", worker: "running", uptimeSeconds: 1234 },
  });

  assert.equal(result.status, "OK");
  assert.match(result.detail, /Render worker đang chạy/);
  assert.match(result.detail, /75ms/);
});

test("Render worker reports an invalid JSON state as an error", () => {
  const result = presentSlotWorkerProbe({
    ok: true,
    latencyMs: 75,
    data: { status: "healthy", worker: "stopped" },
  });

  assert.equal(result.status, "ERROR");
  assert.match(result.detail, /worker=stopped/);
});

test("Render worker reports transport failures as an error", () => {
  const result = presentSlotWorkerProbe({
    ok: false,
    latencyMs: 7000,
    data: null,
    error: "HTTP 503",
  });

  assert.equal(result.status, "ERROR");
  assert.match(result.detail, /HTTP 503/);
});
