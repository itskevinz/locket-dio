const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateVercelCharges,
  currentMonthRange,
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

test("aggregates only FOCUS cost totals from Vercel NDJSON", () => {
  const result = aggregateVercelCharges([
    JSON.stringify({ BilledCost: 1.25, EffectiveCost: 1, BillingCurrency: "USD", secret: "ignored" }),
    JSON.stringify({ BilledCost: 0.75, EffectiveCost: 0.5, BillingCurrency: "USD" }),
  ].join("\n"));
  assert.deepEqual(result, { billedCost: 2, effectiveCost: 1.5, currency: "USD", rows: 2 });
});
