const DEFAULT_NORMAL_INTERVAL_MS = 30_000;
const FAST_INTERVAL_MS = 10_000;
// 1s polling was too aggressive when Locket returned partial celeb snapshots.
// Keep auto-request responsive without hammering upstream or flooding Railway logs.
const AUTO_REQUEST_INTERVAL_MS = 5_000;
const FAST_WINDOW_MS = 3 * 60 * 1000;
const MIN_WORKER_DELAY_MS = 1_000;
const MAX_JITTER_MS = 1_500;
const RATE_LIMIT_BACKOFF_STEPS_MS = [60_000, 120_000];

function clampNormalIntervalMs(value, fallback = DEFAULT_NORMAL_INTERVAL_MS) {
  const parsed = Number(value);
  const resolved = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.min(3 * 60 * 1000, Math.max(2_000, resolved));
}

function hasSnapshotChanged(watches = [], snapshot = {}) {
  const friendCount = Number(snapshot.friendCount) || 0;
  const maxFriends = Number(snapshot.maxFriends) || 0;
  return watches.some((watch) => (
    (Number(watch?.friend_count) || 0) !== friendCount ||
    (Number(watch?.max_friends) || 0) !== maxFriends
  ));
}

function pollIntervalForState({
  fastUntil = 0,
  now = Date.now(),
  normalIntervalMs = DEFAULT_NORMAL_INTERVAL_MS,
} = {}) {
  return Number(fastUntil) > Number(now)
    ? FAST_INTERVAL_MS
    : clampNormalIntervalMs(normalIntervalMs);
}

function rateLimitBackoffMs(level = 1) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const index = Math.min(safeLevel - 1, RATE_LIMIT_BACKOFF_STEPS_MS.length - 1);
  return RATE_LIMIT_BACKOFF_STEPS_MS[index];
}

function jitteredIntervalMs(baseMs, random = Math.random) {
  const safeBase = Math.max(MIN_WORKER_DELAY_MS, Number(baseMs) || DEFAULT_NORMAL_INTERVAL_MS);
  const jitterRange = Math.min(
    MAX_JITTER_MS,
    Math.max(150, Math.floor(safeBase * 0.08)),
  );
  const sample = Math.min(1, Math.max(0, Number(random()) || 0));
  const jitter = Math.floor((sample * 2 - 1) * jitterRange);
  return Math.max(MIN_WORKER_DELAY_MS, Math.round(safeBase + jitter));
}

module.exports = {
  DEFAULT_NORMAL_INTERVAL_MS,
  FAST_INTERVAL_MS,
  AUTO_REQUEST_INTERVAL_MS,
  FAST_WINDOW_MS,
  MIN_WORKER_DELAY_MS,
  MAX_JITTER_MS,
  clampNormalIntervalMs,
  hasSnapshotChanged,
  pollIntervalForState,
  rateLimitBackoffMs,
  jitteredIntervalMs,
};
