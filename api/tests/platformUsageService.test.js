const test = require("node:test");
const assert = require("node:assert/strict");

const {
  currentMonthRange,
  estimateContinuousInstanceHours,
  estimateFreeInstanceHours,
  readFreeHoursBaseline,
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

test("continues from the official Render Billing baseline during its month", () => {
  const estimate = estimateFreeInstanceHours({
    period: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-14T12:26:00.000Z",
    },
    createdAt: "2026-08-14T00:27:00.000Z",
    suspended: "not_suspended",
    baseline: {
      month: "2026-08",
      usedHours: 274.73,
      measuredAt: "2026-08-14T11:26:00.000Z",
    },
  });
  assert.equal(estimate.usedSeconds, Math.round(275.73 * 3600));
  assert.equal(estimate.source, "render-billing-baseline");
  assert.deepEqual(estimate.baseline, {
    month: "2026-08",
    usedHours: 274.73,
    measuredAt: "2026-08-14T11:26:00.000Z",
  });
  assert.equal(estimate.resetAt, "2026-09-01T00:00:00.000Z");
});

test("does not carry an old Billing baseline into a new month", () => {
  const estimate = estimateFreeInstanceHours({
    period: {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-01T02:00:00.000Z",
    },
    createdAt: "2026-08-14T00:27:00.000Z",
    suspended: "not_suspended",
    baseline: {
      month: "2026-08",
      usedHours: 274.73,
      measuredAt: "2026-08-14T11:26:00.000Z",
    },
  });
  assert.equal(estimate.usedSeconds, 2 * 60 * 60);
  assert.equal(estimate.source, "continuous-runtime-estimate");
});

test("accepts an environment override for a future official Billing sync", () => {
  assert.deepEqual(readFreeHoursBaseline({
    RENDER_FREE_HOURS_BASELINE_MONTH: "2026-09",
    RENDER_FREE_HOURS_USED_BASELINE: "18.5",
    RENDER_FREE_HOURS_BASELINE_AT: "2026-09-01T18:30:00+07:00",
  }), {
    month: "2026-09",
    usedHours: 18.5,
    measuredAt: "2026-09-01T11:30:00.000Z",
  });
});
