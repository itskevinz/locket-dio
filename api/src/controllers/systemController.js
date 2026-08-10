const axios = require("axios");
const { firebase, locketServices } = require("../config/app.config");
const { isFirebaseConfigured } = require("../libs/instanceFirebase");
const { getLocketCircuitState } = require("../libs/instanceLocket");

const DEEP_HEALTH_CACHE_MS = 15_000;
const DEPENDENCY_TIMEOUT_MS = 3_000;
let deepHealthCache = null;

const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
};

const healthController = (req, res) => {
  const uptime = Math.floor(process.uptime());
  const mem = process.memoryUsage();

  return res.status(200).json({
    success: true,
    status: "healthy",
    service: "huy-locket-api",
    name: "Huy Locket API",
    uptime_seconds: uptime,
    uptime_human: formatUptime(uptime),
    timestamp: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    server_time: new Date().toLocaleString("vi-VN", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    version: process.env.npm_package_version || "1.0.0",
    redis_configured: Boolean(process.env.REDIS_URL),
    weather_provider: process.env.WEATHER_API_KEY
      ? "weatherapi"
      : "open-meteo-fallback",
    memory_mb: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
  });
};

function sanitizeDatabaseUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    url.searchParams.delete("channel_binding");
    if (!url.searchParams.get("sslmode")) {
      url.searchParams.set("sslmode", "require");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} timeout`);
        error.code = "HEALTHCHECK_TIMEOUT";
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    }),
  ]);
}

function normalizeCheckError(error) {
  const httpStatus = Number(error?.response?.status || error?.status || 0);
  return {
    status: "unhealthy",
    reachable: false,
    code: String(error?.code || "UPSTREAM_ERROR").slice(0, 64),
    http_status: httpStatus || null,
  };
}

async function timedCheck(name, fn) {
  const startedAt = Date.now();
  try {
    const result = (await fn()) || {};
    return {
      name,
      status: result.status || "healthy",
      latency_ms: Date.now() - startedAt,
      ...result,
    };
  } catch (error) {
    return {
      name,
      latency_ms: Date.now() - startedAt,
      ...normalizeCheckError(error),
    };
  }
}

async function probeReachability(url, label) {
  const response = await axios.get(url, {
    timeout: DEPENDENCY_TIMEOUT_MS,
    maxRedirects: 0,
    validateStatus: () => true,
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "HuyLocketDeepHealth/1.0",
    },
  });

  const httpStatus = Number(response.status || 0);
  if (!httpStatus || httpStatus >= 500) {
    const error = new Error(`${label} unavailable`);
    error.status = httpStatus || 503;
    error.code = "UPSTREAM_HTTP_ERROR";
    throw error;
  }

  return {
    reachable: true,
    http_status: httpStatus,
    status: httpStatus === 429 ? "degraded" : "healthy",
  };
}

async function checkLocket() {
  const probe = await probeReachability(locketServices.mainApi, "Locket");
  const circuit = getLocketCircuitState?.() || null;
  if (circuit && circuit.state !== "closed" && probe.status === "healthy") {
    probe.status = "degraded";
  }
  return {
    ...probe,
    circuit,
  };
}

async function checkFirebase() {
  if (!isFirebaseConfigured) {
    return {
      status: "unhealthy",
      reachable: false,
      configured: false,
      code: "FIREBASE_NOT_CONFIGURED",
    };
  }

  const baseUrl =
    firebase.apiBase?.auth ||
    process.env.FIREBASE_AUTH_API_BASE ||
    "https://www.googleapis.com/identitytoolkit/v3/relyingparty";
  const probe = await probeReachability(baseUrl, "Firebase");
  return {
    ...probe,
    configured: true,
  };
}

async function checkDatabase() {
  const rawUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";
  const databaseUrl = sanitizeDatabaseUrl(rawUrl);
  if (!databaseUrl) {
    return {
      status: "degraded",
      reachable: false,
      configured: false,
      code: "DATABASE_NOT_CONFIGURED",
    };
  }

  const { neon } = require("@neondatabase/serverless");
  const sql = neon(databaseUrl);
  const rows = await withTimeout(
    sql`SELECT 1 AS ok`,
    DEPENDENCY_TIMEOUT_MS,
    "Neon",
  );

  return {
    status: rows?.[0]?.ok === 1 ? "healthy" : "degraded",
    reachable: true,
    configured: true,
  };
}

async function checkDrive() {
  const webBase = String(
    process.env.HUY_LOCKET_WEB_URL ||
      process.env.PUBLIC_WEB_URL ||
      "https://huy-locket-production.up.railway.app",
  ).replace(/\/$/, "");

  const response = await axios.get(`${webBase}/api/drive-status`, {
    timeout: DEPENDENCY_TIMEOUT_MS,
    validateStatus: () => true,
    headers: {
      Accept: "application/json",
      "User-Agent": "HuyLocketDeepHealth/1.0",
    },
  });

  if (response.status >= 500 || !response.status) {
    const error = new Error("Drive status endpoint unavailable");
    error.status = response.status || 503;
    error.code = "DRIVE_STATUS_UNAVAILABLE";
    throw error;
  }

  const configured = Boolean(response.data?.configured || response.data?.enabled);
  return {
    status: configured ? "healthy" : "degraded",
    reachable: true,
    configured,
    http_status: response.status,
  };
}

async function buildDeepHealth() {
  const mem = process.memoryUsage();
  const [locket, firebaseCheck, database, drive] = await Promise.all([
    timedCheck("locket", checkLocket),
    timedCheck("firebase", checkFirebase),
    timedCheck("database", checkDatabase),
    timedCheck("google_drive", checkDrive),
  ]);

  const checks = {
    process: {
      name: "process",
      status: "healthy",
      reachable: true,
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      },
    },
    locket,
    firebase: firebaseCheck,
    database,
    google_drive: drive,
  };

  const criticalUnhealthy = [locket, firebaseCheck].some(
    (check) => check.status === "unhealthy",
  );
  const anyDegraded = Object.values(checks).some(
    (check) => check.status !== "healthy",
  );

  const status = criticalUnhealthy
    ? "unhealthy"
    : anyDegraded
      ? "degraded"
      : "healthy";

  return {
    statusCode: criticalUnhealthy ? 503 : 200,
    body: {
      success: !criticalUnhealthy,
      status,
      service: "huy-locket-api",
      timestamp: new Date().toISOString(),
      cached_for_ms: DEEP_HEALTH_CACHE_MS,
      checks,
    },
  };
}

const deepHealthController = async (_req, res) => {
  const now = Date.now();
  if (
    deepHealthCache &&
    now - deepHealthCache.createdAt < DEEP_HEALTH_CACHE_MS
  ) {
    return res
      .status(deepHealthCache.statusCode)
      .json({ ...deepHealthCache.body, cache: "hit" });
  }

  const result = await buildDeepHealth();
  deepHealthCache = {
    ...result,
    createdAt: Date.now(),
  };

  return res.status(result.statusCode).json({ ...result.body, cache: "miss" });
};

module.exports = {
  healthController,
  deepHealthController,
};
