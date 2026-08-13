const store = require("./store");
const { getEncryptionKey } = require("./crypto");
const { getPublicConfig } = require("./service");
const { getProviderConfig } = require("./notifiers");

function item(id, label, status, detail, meta = {}) {
  return { id, label, status, detail, ...meta };
}

function cleanUrl(value, fallback) {
  return String(value || fallback || "").trim().replace(/\/+$/, "");
}

function short(value) {
  return String(value || "").trim().slice(0, 8);
}

function presentWebProbe(probe, apiCommit) {
  if (!probe?.ok) {
    return {
      status: "ERROR",
      detail: `Không đọc được version.json: ${probe?.error || "Không kết nối được"}`,
      matchesApi: false,
    };
  }

  const webCommit = String(probe.commit || "").trim();
  const normalizedApiCommit = String(apiCommit || "").trim();
  const hasComparableCommits = Boolean(normalizedApiCommit && webCommit);
  const matchesApi = Boolean(
    hasComparableCommits && normalizedApiCommit.startsWith(webCommit.slice(0, 8)),
  );
  // Frontend và API có thể được Railway/Vercel bỏ qua hoặc triển khai độc lập.
  // Commit khác nhau là metadata phiên bản, không phải lỗi sức khỏe dịch vụ.
  let deploymentNote = "";
  if (hasComparableCommits) {
    deploymentNote = matchesApi
      ? " • cùng phiên bản API"
      : " • Web/API triển khai độc lập";
  }

  return {
    status: "OK",
    detail: `Phản hồi ${probe.latencyMs}ms • commit ${short(webCommit) || "không rõ"}${deploymentNote}.`,
    matchesApi,
  };
}

async function probeVersion(baseUrl) {
  if (!baseUrl) return { ok: false, latencyMs: null, commit: "", error: "URL chưa cấu hình" };
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/version.json?_=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(7000),
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { ok: false, latencyMs, commit: "", error: `HTTP ${response.status}` };
    }
    const data = await response.json().catch(() => ({}));
    const commit = String(
      data?.commitHash || data?.commit || data?.gitCommit || data?.sha || "",
    ).trim();
    return {
      ok: true,
      latencyMs,
      commit,
      version: String(data?.version || data?.buildId || "").trim(),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      commit: "",
      error: String(error?.message || "Không kết nối được").slice(0, 180),
    };
  }
}

async function getSystemStatus() {
  let databaseOk = false;
  let databaseError = "";
  try {
    await store.getConfigValue("slot-system-status-probe");
    databaseOk = true;
  } catch (error) {
    databaseError = String(error?.message || "Database unavailable").slice(0, 220);
  }

  let slotConfig = null;
  let slotError = "";
  try {
    slotConfig = await getPublicConfig();
  } catch (error) {
    slotError = String(error?.message || "Slot monitor unavailable").slice(0, 220);
  }

  const providers = getProviderConfig();
  const slotReady = Boolean(slotConfig?.enabled && databaseOk && getEncryptionKey());
  const pollSeconds = Math.round(Number(slotConfig?.pollIntervalMs || 0) / 1000);
  const uptimeSeconds = Math.max(0, Math.floor(process.uptime()));
  const apiCommit = String(
    process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      "",
  ).slice(0, 40);

  const vercelUrl = cleanUrl(
    process.env.PUBLIC_WEB_URL,
    "https://duchi.vercel.app",
  );
  const railwayWebUrl = cleanUrl(
    process.env.RAILWAY_WEB_PUBLIC_URL || process.env.RAILWAY_WEB_URL,
    "https://huy-locket-production.up.railway.app",
  );

  const [vercelProbe, railwayWebProbe] = await Promise.all([
    probeVersion(vercelUrl),
    probeVersion(railwayWebUrl),
  ]);

  const vercelWebStatus = presentWebProbe(vercelProbe, apiCommit);
  const railwayWebStatus = presentWebProbe(railwayWebProbe, apiCommit);

  const services = [
    item(
      "api",
      "Railway API",
      "OK",
      `Backend đang phản hồi • uptime ${uptimeSeconds.toLocaleString("vi-VN")} giây • commit ${short(apiCommit) || "không rõ"}.`,
      { uptimeSeconds, commit: apiCommit },
    ),
    item(
      "vercel-web",
      "Vercel Web",
      vercelWebStatus.status,
      vercelWebStatus.detail,
      { latencyMs: vercelProbe.latencyMs, commit: vercelProbe.commit, url: vercelUrl },
    ),
    item(
      "railway-web",
      "Railway Web",
      railwayWebStatus.status,
      railwayWebStatus.detail,
      { latencyMs: railwayWebProbe.latencyMs, commit: railwayWebProbe.commit, url: railwayWebUrl },
    ),
    item(
      "database",
      "Database",
      databaseOk ? "OK" : "ERROR",
      databaseOk ? "Neon database đang truy cập được." : databaseError,
    ),
    item(
      "slot-worker",
      "Canh Slot worker",
      slotReady ? "OK" : "ERROR",
      slotReady
        ? `Worker được cấu hình trên process API • chu kỳ ${pollSeconds || 45} giây.`
        : slotError || "Worker chưa đủ cấu hình database/encryption.",
      { pollIntervalMs: Number(slotConfig?.pollIntervalMs) || 0 },
    ),
    item(
      "auth",
      "Locket / Firebase Auth",
      "OK",
      "Yêu cầu System Status đã đi qua verifyIdToken thành công.",
    ),
    item(
      "telegram",
      "Telegram",
      providers?.telegram?.configured ? "OK" : "WARNING",
      providers?.telegram?.configured
        ? "Telegram Bot đã được cấu hình trên backend."
        : "Telegram Bot chưa được cấu hình.",
    ),
    item(
      "gmail",
      "Gmail relay",
      providers?.email?.configured ? "OK" : "WARNING",
      providers?.email?.configured
        ? "Google Apps Script Gmail relay đã được cấu hình."
        : "Gmail relay chưa được cấu hình.",
    ),
  ];

  const errors = services.filter((service) => service.status === "ERROR").length;
  const warnings = services.filter((service) => service.status === "WARNING").length;

  return {
    overall: errors > 0 ? "ERROR" : warnings > 0 ? "WARNING" : "OK",
    checkedAt: Date.now(),
    version: apiCommit,
    commitSync: {
      api: apiCommit,
      vercel: vercelProbe.commit,
      railwayWeb: railwayWebProbe.commit,
      vercelMatchesApi: vercelWebStatus.matchesApi,
      railwayWebMatchesApi: railwayWebStatus.matchesApi,
    },
    services,
  };
}

module.exports = { getSystemStatus, presentWebProbe };
