const RENDER_API_BASE = "https://api.render.com/v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedUsage = null;
let cachedAt = 0;

function currentMonthRange(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: now.toISOString() };
}

function metricValues(series) {
  return (Array.isArray(series) ? series : []).flatMap((item) =>
    (Array.isArray(item?.values) ? item.values : []).map((point) => ({
      timestamp: point?.timestamp || null,
      value: Number(point?.value),
      unit: point?.unit || item?.unit || null,
    }))
  ).filter((point) => Number.isFinite(point.value));
}

function summarizeMetric(series, mode = "latest") {
  const values = metricValues(series);
  if (!values.length) return null;
  if (mode === "sum") {
    return {
      value: values.reduce((total, point) => total + point.value, 0),
      unit: values.find((point) => point.unit)?.unit || null,
      samples: values.length,
    };
  }
  const latest = values.reduce((best, point) => {
    if (!best) return point;
    return String(point.timestamp || "") > String(best.timestamp || "") ? point : best;
  }, null);
  return latest ? { value: latest.value, unit: latest.unit, timestamp: latest.timestamp } : null;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function apiRequest(url, token, { accept = "application/json" } = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, accept },
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function renderUsage(period) {
  const token = String(process.env.RENDER_API_KEY || "").trim();
  const serviceId = String(process.env.RENDER_SERVICE_ID || "srv-d9v61rp5efls73altkr0").trim();
  const result = {
    configured: Boolean(token),
    serviceId,
    billingUrl: "https://dashboard.render.com/billing",
    limits: {
      freeInstanceHours: { included: 750, used: null, source: "dashboard-only" },
      pipelineMinutes: { included: 500, used: null, source: "dashboard-only" },
    },
    service: null,
    metrics: { bandwidthMonth: null, cpuLatest: null, memoryLatest: null },
    error: null,
  };

  if (!token) {
    result.error = "Chưa cấu hình RENDER_API_KEY trên Vercel API.";
    return result;
  }

  const monthQuery = new URLSearchParams({
    startTime: period.from,
    endTime: period.to,
    resource: serviceId,
  });
  const recentStart = new Date(Math.max(Date.parse(period.to) - 15 * 60 * 1000, Date.parse(period.from))).toISOString();
  const recentQuery = new URLSearchParams({
    startTime: recentStart,
    endTime: period.to,
    resolutionSeconds: "60",
    resource: serviceId,
  });

  const calls = await Promise.allSettled([
    apiRequest(`${RENDER_API_BASE}/services/${encodeURIComponent(serviceId)}`, token),
    apiRequest(`${RENDER_API_BASE}/metrics/bandwidth?${monthQuery}`, token),
    apiRequest(`${RENDER_API_BASE}/metrics/cpu?${recentQuery}`, token),
    apiRequest(`${RENDER_API_BASE}/metrics/memory?${recentQuery}`, token),
  ]);

  if (calls[0].status === "fulfilled") {
    const payload = parseJson(calls[0].value, {});
    const service = payload?.service || payload;
    result.service = {
      name: service?.name || "huy-locket-slot-worker",
      plan: service?.serviceDetails?.plan || service?.plan || null,
      region: service?.serviceDetails?.region || service?.region || null,
      suspended: service?.suspended || "not_suspended",
      autoDeploy: service?.autoDeploy ?? null,
    };
  }
  if (calls[1].status === "fulfilled") {
    result.metrics.bandwidthMonth = summarizeMetric(parseJson(calls[1].value, []), "sum");
  }
  if (calls[2].status === "fulfilled") {
    result.metrics.cpuLatest = summarizeMetric(parseJson(calls[2].value, []));
  }
  if (calls[3].status === "fulfilled") {
    result.metrics.memoryLatest = summarizeMetric(parseJson(calls[3].value, []));
  }

  const failures = calls.filter((call) => call.status === "rejected");
  if (failures.length) {
    const status = failures[0].reason?.status;
    result.error = status === 401 || status === 403
      ? "Render API key không hợp lệ hoặc chưa có quyền đọc service."
      : `${failures.length}/4 metric Render chưa đọc được.`;
  }
  return result;
}

async function getPlatformUsageStats({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedUsage && now - cachedAt < CACHE_TTL_MS) return cachedUsage;
  const period = currentMonthRange(new Date(now));
  const render = await renderUsage(period);
  cachedUsage = { period, render, measuredAt: Date.now() };
  cachedAt = now;
  return cachedUsage;
}

module.exports = {
  currentMonthRange,
  getPlatformUsageStats,
  summarizeMetric,
};
