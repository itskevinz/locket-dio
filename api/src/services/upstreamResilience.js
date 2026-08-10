const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_HTTP_STATUS = new Set([502, 503, 504]);
const SAFE_READ_POST_PREFIX = /^(get|list|search|fetch|query|check|lookup|preview|status|health)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestPath(config = {}) {
  const raw = String(config.url || "");
  try {
    return new URL(raw, "https://huy-locket.invalid").pathname;
  } catch {
    return raw.split("?")[0] || "/";
  }
}

function isSafeReadRequest(config = {}) {
  const method = String(config.method || "get").toLowerCase();
  if (["get", "head", "options"].includes(method)) return true;
  if (method !== "post") return false;

  const pathname = requestPath(config);
  const lastSegment = pathname.split("/").filter(Boolean).pop() || "";
  return SAFE_READ_POST_PREFIX.test(lastSegment);
}

function isTransientUpstreamError(error) {
  if (!error) return false;
  if (TRANSIENT_NETWORK_CODES.has(String(error.code || ""))) return true;

  const status = Number(error?.response?.status || error?.status || 0);
  if (TRANSIENT_HTTP_STATUS.has(status)) return true;

  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("socket hang up") ||
    message.includes("connection was closed") ||
    message.includes("network error") ||
    message.includes("upstream timeout")
  );
}

class CircuitBreaker {
  constructor({
    name = "upstream",
    failureThreshold = 4,
    openMs = 12_000,
    now = () => Date.now(),
  } = {}) {
    this.name = name;
    this.failureThreshold = Math.max(1, Number(failureThreshold) || 4);
    this.openMs = Math.max(1_000, Number(openMs) || 12_000);
    this.now = now;
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openUntil = 0;
    this.probeInFlight = false;
    this.lastFailureAt = 0;
  }

  canRequest() {
    const now = this.now();

    if (this.state === "open") {
      if (now < this.openUntil) {
        return {
          allowed: false,
          state: this.state,
          retryAfterMs: Math.max(0, this.openUntil - now),
        };
      }
      this.state = "half_open";
      this.probeInFlight = false;
    }

    if (this.state === "half_open") {
      if (this.probeInFlight) {
        return {
          allowed: false,
          state: this.state,
          retryAfterMs: 1_000,
        };
      }
      this.probeInFlight = true;
    }

    return { allowed: true, state: this.state, retryAfterMs: 0 };
  }

  recordSuccess() {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openUntil = 0;
    this.probeInFlight = false;
  }

  recordFailure() {
    const now = this.now();
    this.lastFailureAt = now;
    this.probeInFlight = false;

    if (this.state === "half_open") {
      this.state = "open";
      this.consecutiveFailures = this.failureThreshold;
      this.openUntil = now + this.openMs;
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
      this.openUntil = now + this.openMs;
    }
  }

  snapshot() {
    const now = this.now();
    return {
      name: this.name,
      state: this.state,
      consecutive_failures: this.consecutiveFailures,
      retry_after_ms:
        this.state === "open" ? Math.max(0, this.openUntil - now) : 0,
      last_failure_at:
        this.lastFailureAt > 0
          ? new Date(this.lastFailureAt).toISOString()
          : null,
    };
  }
}

function createCircuitOpenError(name, retryAfterMs) {
  const error = new Error(
    `${name} tạm thời không ổn định. Vui lòng thử lại sau.`,
  );
  error.code = "UPSTREAM_CIRCUIT_OPEN";
  error.status = 503;
  error.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
  return error;
}

function attachAxiosResilience(
  instance,
  {
    name = "upstream",
    failureThreshold = 4,
    openMs = 12_000,
    maxRetries = 2,
    retryDelaysMs = [350, 900],
  } = {},
) {
  const breaker = new CircuitBreaker({ name, failureThreshold, openMs });
  const retries = Math.max(0, Number(maxRetries) || 0);
  const delays = Array.isArray(retryDelaysMs) && retryDelaysMs.length
    ? retryDelaysMs.map((value) => Math.max(0, Number(value) || 0))
    : [350, 900];

  instance.interceptors.request.use((config) => {
    if (config?.meta?.skipResilience) return config;

    const safeRead = isSafeReadRequest(config);
    config.__huySafeRead = safeRead;
    if (!safeRead) return config;

    const gate = breaker.canRequest();
    if (gate.allowed) return config;

    const error = createCircuitOpenError(name, gate.retryAfterMs);
    error.config = config;
    return Promise.reject(error);
  });

  instance.interceptors.response.use(
    (response) => {
      if (response?.config?.__huySafeRead) breaker.recordSuccess();
      return response;
    },
    async (error) => {
      const config = error?.config;
      if (!config || config?.meta?.skipResilience || !config.__huySafeRead) {
        return Promise.reject(error);
      }

      if (error.code === "UPSTREAM_CIRCUIT_OPEN") {
        return Promise.reject(error);
      }

      const transient = isTransientUpstreamError(error);
      if (transient) breaker.recordFailure();
      else if (error.response) breaker.recordSuccess();

      const retryCount = Number(config.__huyRetryCount || 0);
      if (!transient || retryCount >= retries) {
        return Promise.reject(error);
      }

      const delay = delays[Math.min(retryCount, delays.length - 1)] || 0;
      if (delay > 0) await sleep(delay);

      return instance.request({
        ...config,
        __huyRetryCount: retryCount + 1,
        headers: { ...(config.headers || {}) },
      });
    },
  );

  return {
    breaker,
    snapshot: () => breaker.snapshot(),
  };
}

module.exports = {
  CircuitBreaker,
  attachAxiosResilience,
  isSafeReadRequest,
  isTransientUpstreamError,
};
