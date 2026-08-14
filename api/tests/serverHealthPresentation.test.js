const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeSlotWorkerHealth } = require("../src/services/userActivityStore");

test("marks the Render worker online only for healthy/running payloads", () => {
  const result = normalizeSlotWorkerHealth(
    {
      status: "healthy",
      worker: "running",
      service: "huy-locket-slot-worker",
      uptimeSeconds: 321,
      startedAt: "2026-08-14T01:48:25.290Z",
    },
    { url: "https://example.onrender.com/health", latencyMs: 42 }
  );

  assert.equal(result.healthy, true);
  assert.equal(result.status, "ONLINE");
  assert.equal(result.state, "running");
  assert.equal(result.uptimeSeconds, 321);
  assert.equal(result.latencyMs, 42);
  assert.equal(result.error, null);
});

test("does not present an incomplete worker payload as healthy", () => {
  const result = normalizeSlotWorkerHealth(
    { status: "healthy", worker: "stopped" },
    { url: "https://example.onrender.com/health", latencyMs: 20 }
  );

  assert.equal(result.healthy, false);
  assert.equal(result.status, "ERROR");
  assert.equal(result.state, "stopped");
  assert.match(result.error, /healthy\/running/);
});
