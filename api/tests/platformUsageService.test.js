const test = require("node:test");
const assert = require("node:assert/strict");

const {
  currentMonthRange,
  estimateContinuousInstanceHours,
  summarizeMetric,
} = require("../src/services/platformUsageService");

test("creates an exact UTC range for the current billing month", () => {
  const range = currentMonthRange(new Date("2026-08-14T02:00:00.000Z"));
  assert.deepEqual(range, {
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-14T02:00:00.000Z",
  });
});

test("summarizes Render metric series without exposing raw payloads", () => {
  const series = [{
    unit: "bytes",
    values: [
      { timestamp: "2026-08-14T01:00:00Z", value: 100 },
      { timestamp: "2026-08-14T02:00:00Z", value: 250 },
    ],
  }];
  assert.deepEqual(summarizeMetric(series, "sum"), { value: 350, unit: "bytes", samples: 2 });
  assert.deepEqual(summarizeMetric(series), { value: 250, unit: "bytes", timestamp: "2026-08-14T02:00:00Z" });
});

test("estimates continuous free instance time from service creation within the month", () => {
  assert.deepEqual(estimateContinuousInstanceHours({
    period: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-14T02:00:00.000Z",
    },
    createdAt: "2026-08-14T00:30:00.000Z",
  }), {
    usedSeconds: 5400,
    startedAt: "2026-08-14T00:30:00.000Z",
    measuredAt: "2026-08-14T02:00:00.000Z",
    source: "continuous-runtime-estimate",
  });
});

test("resets the continuous estimate at the start of a new month", () => {
  const estimate = estimateContinuousInstanceHours({
    period: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T06:00:00.000Z",
    },
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  assert.equal(estimate.usedSeconds, 30 * 60 * 60);
  assert.equal(estimate.startedAt, "2026-08-01T00:00:00.000Z");
});
