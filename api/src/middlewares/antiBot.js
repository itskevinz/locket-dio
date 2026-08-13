/**
 * ═══════════════════════════════════════════════════════════════════
 *  🛡️ HUY LOCKET FORTRESS WAF — Tường Lửa Cấp Quân Sự v2.0
 * ═══════════════════════════════════════════════════════════════════
 * 7 TẦNG BẢO VỆ:
 *   [1] IP Blacklist Database + In-Memory Cache
 *   [2] Cloud Provider IP Range Block (AWS, GCP, Azure, DigitalOcean, Oracle)
 *   [3] Bot User-Agent Keyword Detection
 *   [4] Headless Browser Fingerprinting (phát hiện trình duyệt ảo)
 *   [5] Browser Integrity Check (kiểm tra tính toàn vẹn header trình duyệt)
 *   [6] WAF SQLi/XSS/Path Traversal Detection
 *   [7] DDoS Rate Limiter + Per-Endpoint Shield
 *
 * Dấu hiệu bot bị chặn theo request và ghi log; chỉ admin mới có thể cấm IP vĩnh viễn.
 */
const rateLimit = require("express-rate-limit");
const { isIpBlacklisted, recordSecurityThreat } = require("../services/userActivityStore");
const { extractBestPublicIp } = require("../services/userActivityContext");

// ═══════════════════════════════════════════════════════════════════
// [TẦNG 3] Bot User-Agent Keywords — mở rộng toàn diện
// ═══════════════════════════════════════════════════════════════════
const BLOCKED_UA_KEYWORDS = [
  // HTTP clients & scripting libraries
  "curl/", "wget/", "python-requests", "python-urllib", "scrapy", "aiohttp",
  "httpx", "libcurl", "go-http-client", "java/", "perl/", "ruby/", "urllib",
  "libwww", "httpie", "node-fetch", "axios/", "got/", "undici/", "node/",
  "deno/", "bun/",
  // SEO/Marketing bots
  "ahrefsbot", "mj12bot", "dotbot", "petalbot", "semrushbot", "bytespider",
  "baiduspider", "yandexbot", "sogou", "exabot", "majestic", "blexbot",
  "linkfluence", "dataforseo", "serpstat",
  // Headless browsers & automation tools
  "headlesschrome", "phantomjs", "selenium", "puppeteer", "playwright",
  "webdriver", "chromedriver", "geckodriver", "nightmarejs",
  // API testing tools
  "postmanruntime", "insomnia/", "paw/", "thunder client",
  // Misc bots & crawlers
  "zgrab", "masscan", "nmap", "sqlmap", "nikto", "dirbuster", "gobuster",
  "wpscan", "nuclei", "jaeles", "burpsuite", "owasp", "acunetix",
  "nessus", "openvas", "qualys", "metasploit",
  "facebookexternalhit", "twitterbot", "linkedinbot", "slackbot",
  "telegrambot", "discordbot", "whatsapp",
];

// ═══════════════════════════════════════════════════════════════════
// [TẦNG 2] Cloud Provider IP Ranges — Chặn server farm & VPS
// Không ai dùng trình duyệt thật từ AWS/GCP/Azure để truy cập web app
// ═══════════════════════════════════════════════════════════════════
const CLOUD_IP_RANGES = [
  // AWS — các dải IP phổ biến nhất (US regions, nơi bot thường chạy)
  { start: "3.0.0.0",     end: "3.255.255.255",   provider: "AWS" },
  { start: "13.0.0.0",    end: "13.255.255.255",   provider: "AWS" },
  { start: "15.0.0.0",    end: "15.255.255.255",   provider: "AWS" },
  { start: "18.0.0.0",    end: "18.255.255.255",   provider: "AWS" },
  { start: "34.192.0.0",  end: "34.255.255.255",   provider: "AWS" },
  { start: "35.160.0.0",  end: "35.191.255.255",   provider: "AWS" },
  { start: "44.192.0.0",  end: "44.255.255.255",   provider: "AWS" },
  { start: "46.137.0.0",  end: "46.137.255.255",   provider: "AWS" },
  { start: "50.16.0.0",   end: "50.19.255.255",    provider: "AWS" },
  { start: "52.0.0.0",    end: "52.255.255.255",   provider: "AWS" },
  { start: "54.0.0.0",    end: "54.255.255.255",   provider: "AWS" },
  { start: "63.32.0.0",   end: "63.35.255.255",    provider: "AWS" },
  { start: "64.252.0.0",  end: "64.252.255.255",   provider: "AWS" },
  { start: "99.77.0.0",   end: "99.84.255.255",    provider: "AWS" },
  { start: "107.20.0.0",  end: "107.23.255.255",   provider: "AWS" },
  { start: "174.129.0.0", end: "174.129.255.255",  provider: "AWS" },
  { start: "176.34.0.0",  end: "176.34.255.255",   provider: "AWS" },
  { start: "184.72.0.0",  end: "184.73.255.255",   provider: "AWS" },
  { start: "204.236.128.0", end: "204.236.255.255", provider: "AWS" },
  // GCP
  { start: "34.0.0.0",    end: "34.191.255.255",   provider: "GCP" },
  { start: "35.192.0.0",  end: "35.255.255.255",   provider: "GCP" },
  { start: "104.196.0.0", end: "104.199.255.255",  provider: "GCP" },
  { start: "130.211.0.0", end: "130.211.255.255",  provider: "GCP" },
  { start: "146.148.0.0", end: "146.148.255.255",  provider: "GCP" },
  // Azure
  { start: "13.64.0.0",   end: "13.107.255.255",   provider: "Azure" },
  { start: "20.0.0.0",    end: "20.255.255.255",   provider: "Azure" },
  { start: "40.64.0.0",   end: "40.127.255.255",   provider: "Azure" },
  { start: "51.104.0.0",  end: "51.145.255.255",   provider: "Azure" },
  { start: "52.96.0.0",   end: "52.191.255.255",   provider: "Azure" },
  { start: "104.40.0.0",  end: "104.47.255.255",   provider: "Azure" },
  // DigitalOcean
  { start: "104.131.0.0", end: "104.131.255.255",  provider: "DigitalOcean" },
  { start: "137.184.0.0", end: "137.184.255.255",  provider: "DigitalOcean" },
  { start: "138.68.0.0",  end: "138.68.255.255",   provider: "DigitalOcean" },
  { start: "139.59.0.0",  end: "139.59.255.255",   provider: "DigitalOcean" },
  { start: "142.93.0.0",  end: "142.93.255.255",   provider: "DigitalOcean" },
  { start: "143.198.0.0", end: "143.198.255.255",  provider: "DigitalOcean" },
  { start: "157.245.0.0", end: "157.245.255.255",  provider: "DigitalOcean" },
  { start: "159.65.0.0",  end: "159.65.255.255",   provider: "DigitalOcean" },
  { start: "161.35.0.0",  end: "161.35.255.255",   provider: "DigitalOcean" },
  { start: "164.90.0.0",  end: "164.92.255.255",   provider: "DigitalOcean" },
  { start: "167.172.0.0", end: "167.172.255.255",  provider: "DigitalOcean" },
  { start: "178.128.0.0", end: "178.128.255.255",  provider: "DigitalOcean" },
  { start: "188.166.0.0", end: "188.166.255.255",  provider: "DigitalOcean" },
  { start: "206.189.0.0", end: "206.189.255.255",  provider: "DigitalOcean" },
  // Oracle Cloud
  { start: "129.146.0.0", end: "129.146.255.255",  provider: "Oracle" },
  { start: "130.61.0.0",  end: "130.61.255.255",   provider: "Oracle" },
  { start: "132.145.0.0", end: "132.145.255.255",  provider: "Oracle" },
  { start: "140.238.0.0", end: "140.238.255.255",  provider: "Oracle" },
  { start: "144.24.0.0",  end: "144.24.255.255",   provider: "Oracle" },
  { start: "150.136.0.0", end: "150.136.255.255",  provider: "Oracle" },
  { start: "152.67.0.0",  end: "152.70.255.255",   provider: "Oracle" },
  // Vultr
  { start: "45.32.0.0",   end: "45.32.255.255",    provider: "Vultr" },
  { start: "45.63.0.0",   end: "45.63.255.255",    provider: "Vultr" },
  { start: "45.76.0.0",   end: "45.77.255.255",    provider: "Vultr" },
  { start: "64.176.0.0",  end: "64.176.255.255",   provider: "Vultr" },
  { start: "66.42.0.0",   end: "66.42.255.255",    provider: "Vultr" },
  { start: "104.238.0.0", end: "104.238.255.255",  provider: "Vultr" },
  { start: "108.61.0.0",  end: "108.61.255.255",   provider: "Vultr" },
  { start: "136.244.0.0", end: "136.244.255.255",  provider: "Vultr" },
  { start: "149.28.0.0",  end: "149.28.255.255",   provider: "Vultr" },
  { start: "207.148.0.0", end: "207.148.255.255",  provider: "Vultr" },
  { start: "209.250.0.0", end: "209.250.255.255",  provider: "Vultr" },
  // Linode / Akamai
  { start: "45.33.0.0",   end: "45.33.255.255",    provider: "Linode" },
  { start: "45.56.0.0",   end: "45.56.255.255",    provider: "Linode" },
  { start: "45.79.0.0",   end: "45.79.255.255",    provider: "Linode" },
  { start: "50.116.0.0",  end: "50.116.255.255",   provider: "Linode" },
  { start: "66.175.208.0", end: "66.175.223.255",  provider: "Linode" },
  { start: "69.164.192.0", end: "69.164.223.255",  provider: "Linode" },
  { start: "72.14.176.0",  end: "72.14.191.255",   provider: "Linode" },
  { start: "96.126.96.0",  end: "96.126.127.255",  provider: "Linode" },
  { start: "173.230.128.0", end: "173.230.159.255", provider: "Linode" },
  { start: "173.255.192.0", end: "173.255.255.255", provider: "Linode" },
  { start: "192.81.128.0",  end: "192.81.135.255",  provider: "Linode" },
  { start: "198.58.96.0",   end: "198.58.127.255",  provider: "Linode" },
  // Hetzner
  { start: "5.9.0.0",       end: "5.9.255.255",     provider: "Hetzner" },
  { start: "23.88.0.0",     end: "23.88.255.255",    provider: "Hetzner" },
  { start: "49.12.0.0",     end: "49.13.255.255",    provider: "Hetzner" },
  { start: "65.21.0.0",     end: "65.21.255.255",    provider: "Hetzner" },
  { start: "78.46.0.0",     end: "78.47.255.255",    provider: "Hetzner" },
  { start: "88.198.0.0",    end: "88.198.255.255",   provider: "Hetzner" },
  { start: "95.216.0.0",    end: "95.217.255.255",   provider: "Hetzner" },
  { start: "116.202.0.0",   end: "116.203.255.255",  provider: "Hetzner" },
  { start: "128.140.0.0",   end: "128.140.255.255",  provider: "Hetzner" },
  { start: "135.181.0.0",   end: "135.181.255.255",  provider: "Hetzner" },
  { start: "136.243.0.0",   end: "136.243.255.255",  provider: "Hetzner" },
  { start: "138.201.0.0",   end: "138.201.255.255",  provider: "Hetzner" },
  { start: "142.132.0.0",   end: "142.132.255.255",  provider: "Hetzner" },
  { start: "148.251.0.0",   end: "148.251.255.255",  provider: "Hetzner" },
  { start: "159.69.0.0",    end: "159.69.255.255",   provider: "Hetzner" },
  { start: "168.119.0.0",   end: "168.119.255.255",  provider: "Hetzner" },
  { start: "176.9.0.0",     end: "176.9.255.255",    provider: "Hetzner" },
  { start: "178.63.0.0",    end: "178.63.255.255",   provider: "Hetzner" },
  { start: "188.40.0.0",    end: "188.40.255.255",   provider: "Hetzner" },
  { start: "195.201.0.0",   end: "195.201.255.255",  provider: "Hetzner" },
  // OVH
  { start: "51.38.0.0",     end: "51.38.255.255",    provider: "OVH" },
  { start: "51.68.0.0",     end: "51.68.255.255",    provider: "OVH" },
  { start: "51.75.0.0",     end: "51.75.255.255",    provider: "OVH" },
  { start: "51.77.0.0",     end: "51.79.255.255",    provider: "OVH" },
  { start: "51.81.0.0",     end: "51.81.255.255",    provider: "OVH" },
  { start: "51.83.0.0",     end: "51.83.255.255",    provider: "OVH" },
  { start: "51.89.0.0",     end: "51.89.255.255",    provider: "OVH" },
  { start: "51.91.0.0",     end: "51.91.255.255",    provider: "OVH" },
  { start: "54.36.0.0",     end: "54.39.255.255",    provider: "OVH" },
  { start: "91.134.0.0",    end: "91.134.255.255",   provider: "OVH" },
  { start: "135.125.0.0",   end: "135.125.255.255",  provider: "OVH" },
  { start: "137.74.0.0",    end: "137.74.255.255",   provider: "OVH" },
  { start: "141.94.0.0",    end: "141.95.255.255",   provider: "OVH" },
  { start: "145.239.0.0",   end: "145.239.255.255",  provider: "OVH" },
  { start: "146.59.0.0",    end: "146.59.255.255",   provider: "OVH" },
  { start: "151.80.0.0",    end: "151.80.255.255",   provider: "OVH" },
  { start: "158.69.0.0",    end: "158.69.255.255",   provider: "OVH" },
  { start: "164.132.0.0",   end: "164.132.255.255",  provider: "OVH" },
  { start: "176.31.0.0",    end: "176.31.255.255",   provider: "OVH" },
  { start: "178.32.0.0",    end: "178.33.255.255",   provider: "OVH" },
  { start: "185.12.32.0",   end: "185.12.35.255",    provider: "OVH" },
  { start: "188.165.0.0",   end: "188.165.255.255",  provider: "OVH" },
  { start: "198.27.64.0",   end: "198.27.127.255",   provider: "OVH" },
  { start: "198.100.144.0", end: "198.100.159.255",  provider: "OVH" },
  { start: "213.186.32.0",  end: "213.186.47.255",   provider: "OVH" },
];

// Chuyển IP string -> số để so sánh nhanh
function ipToLong(ip) {
  if (!ip || typeof ip !== "string") return 0;
  const parts = ip.split(".");
  if (parts.length !== 4) return 0;
  return ((parseInt(parts[0], 10) << 24) | (parseInt(parts[1], 10) << 16) | (parseInt(parts[2], 10) << 8) | parseInt(parts[3], 10)) >>> 0;
}

// Pre-compute số cho tất cả IP ranges
const CLOUD_IP_RANGES_NUMERIC = CLOUD_IP_RANGES.map(r => ({
  start: ipToLong(r.start),
  end: ipToLong(r.end),
  provider: r.provider,
}));

function isCloudProviderIp(ip) {
  const ipNum = ipToLong(ip);
  if (ipNum === 0) return null;
  for (const range of CLOUD_IP_RANGES_NUMERIC) {
    if (ipNum >= range.start && ipNum <= range.end) {
      return range.provider;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Các tuyến đường miễn trừ (health check, static assets)
// ═══════════════════════════════════════════════════════════════════
const EXEMPT_PATHS = [
  "/", "/health", "/api/health", "/ping", "/api/ping", "/api/meta",
  "/api/drive-status", "/favicon.ico", "/robots.txt", "/manifest.json", "/locket/postMomentV2", "/api/locket/postMomentV2", "/api/unban-all"
];

function isExemptPath(path = "") {
  const p = String(path).split("?")[0].replace(/\/+$/, "") || "/";
  if (EXEMPT_PATHS.includes(p)) return true;
  if (p.startsWith("/assets/") || p.startsWith("/static/") || /\.(png|jpg|jpeg|svg|ico|gif|woff|woff2|css|js|map|txt)$/i.test(p)) {
    return true;
  }
  return false;
}



function isAdminRequest(req) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const payloadBase64 = token.split('.')[1];
      if (!payloadBase64) return false;
      const payloadString = Buffer.from(payloadBase64, 'base64').toString('utf8');
      const payload = JSON.parse(payloadString);

      const userActivityStore = require('../services/userActivityStore');
      if (userActivityStore.isWhitelisted && payload.email && userActivityStore.isWhitelisted(payload.email)) return true;
      if (userActivityStore.isWhitelisted && payload.uid && userActivityStore.isWhitelisted(payload.uid)) return true;

      if (payload && (payload.role === 'admin' || payload.email === 'buiduchuy2010qn@gmail.com' || payload.email === 'duchuy2010qn@gmail.com' || payload.email === 'nhuyqn2010@gmail.com')) {
        return true;
      }
    }
  } catch (e) {}

  try {
    const ip = getRequestIp(req);
    const userActivityStore = require('../services/userActivityStore');
    if (userActivityStore.isWhitelisted && userActivityStore.isWhitelisted(ip)) return true;
  } catch (e) {}
  
  return false;
}




function getRequestIp(req) {
  return extractBestPublicIp(req) || req.ip || "unknown";
}

// ═══════════════════════════════════════════════════════════════════
// Anti-Spam Threat Log
// ═══════════════════════════════════════════════════════════════════
const recentThreatLogs = new Map();
const LOG_THROTTLING_MS = 15 * 60 * 1000;

// Tự động dọn dẹp bộ nhớ RAM mỗi 30 phút
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of recentThreatLogs) {
    if (now - time > LOG_THROTTLING_MS * 2) recentThreatLogs.delete(key);
  }
}, 30 * 60 * 1000);

async function handleThreatDetected(req, ip, threatType, severity, details, payloadSample = null) {
  if (!ip || ip === "unknown") return;
  const userAgent = String(req.headers["user-agent"] || "").trim();
  const now = Date.now();

  // Heuristic detections may reject or rate-limit this request, but they must not
  // create a permanent IP ban. Mobile networks, NATs and migration smoke tests
  // frequently share an IP with a legitimate browser. Permanent bans remain an
  // explicit admin action through the security panel.

  // Log Throttling
  const logKey = `${ip}_${threatType}`;
  const lastLogTime = recentThreatLogs.get(logKey);
  if (lastLogTime && (now - lastLogTime < LOG_THROTTLING_MS)) return;
  recentThreatLogs.set(logKey, now);

  recordSecurityThreat({
    threatType,
    severity,
    targetEndpoint: req.originalUrl || req.path,
    attackerIp: ip,
    userAgent,
    details,
    payloadSample,
    status: "BLOCKED",
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════
// [TẦNG 4] Headless Browser Fingerprinting
// Phát hiện trình duyệt ảo dựa trên UA signatures
// ═══════════════════════════════════════════════════════════════════
function detectHeadlessBrowser(userAgent) {
  const ua = userAgent.toLowerCase();
  // HeadlessChrome với version cao bất thường (>= 100) thường là bot
  const headlessChromeMatch = ua.match(/headlesschrome\/(\d+)/);
  if (headlessChromeMatch) return `HeadlessChrome/${headlessChromeMatch[1]}`;
  // PhantomJS
  if (ua.includes("phantomjs")) return "PhantomJS";
  // Selenium WebDriver fingerprints
  if (ua.includes("selenium") || ua.includes("webdriver")) return "Selenium/WebDriver";
  // Puppeteer/Playwright explicit
  if (ua.includes("puppeteer") || ua.includes("playwright")) return "Puppeteer/Playwright";
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// [TẦNG 5] Browser Integrity Check
// Trình duyệt thật LUÔN gửi các header đặc trưng. Bot thường thiếu.
// ═══════════════════════════════════════════════════════════════════
function checkBrowserIntegrity(req) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  const issues = [];

  // Trình duyệt thật luôn gửi Accept-Language
  if (!req.headers["accept-language"] && !req.headers["sec-ch-ua"]) {
    // Chỉ đánh dấu khi UA claim là trình duyệt desktop
    if (ua.includes("mozilla/") && (ua.includes("chrome/") || ua.includes("firefox/") || ua.includes("safari/"))) {
      issues.push("MISSING_ACCEPT_LANGUAGE");
    }
  }

  // Chrome thật luôn gửi sec-ch-ua headers (từ Chrome 89+)
  if (ua.includes("chrome/") && !ua.includes("headlesschrome")) {
    const chromeVersionMatch = ua.match(/chrome\/(\d+)/);
    if (chromeVersionMatch && parseInt(chromeVersionMatch[1]) >= 89) {
      if (!req.headers["sec-ch-ua"] && !req.headers["sec-fetch-mode"]) {
        issues.push("MISSING_SEC_CH_UA");
      }
    }
  }

  // Trình duyệt thật gửi Accept header có text/html cho page requests
  if (!req.headers["accept"] || req.headers["accept"] === "*/*") {
    if (ua.includes("mozilla/") && req.method === "GET") {
      issues.push("GENERIC_ACCEPT_HEADER");
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN MIDDLEWARE: Anti-Bot Fortress
// ═══════════════════════════════════════════════════════════════════
function antiBotMiddleware(req, res, next) {
  if (req.method === "OPTIONS" || isExemptPath(req.path) || isAdminRequest(req)) {
    return next();
  }

  const userAgent = String(req.headers["user-agent"] || "").trim();
  const ip = getRequestIp(req);

  // [TẦNG 1] IP Blacklist — Chặn ngay nếu đã bị ban
  if (isIpBlacklisted(ip)) {
    handleThreatDetected(req, ip, "IP_BLACKLIST_PROBE", "HIGH", "IP trong danh sách đen cố gắng truy cập");
    return res.status(403).json({
      success: false,
      code: "IP_BANNED",
      error: "Địa chỉ IP của bạn đã bị Huy Locket cấm truy cập vĩnh viễn do vi phạm chính sách bảo mật.",
    });
  }

  // [TẦNG 2] Cloud Provider IP — Chặn request từ server farm
  const cloudProvider = isCloudProviderIp(ip);
  if (cloudProvider) {
    console.warn(`[🛑 WAF Cloud Block] IP ${ip} thuộc ${cloudProvider} — REQUEST BLOCKED`);
    handleThreatDetected(
      req, ip, "CLOUD_SERVER_IP_BLOCKED", "HIGH",
      `IP ${ip} thuộc nhà cung cấp đám mây ${cloudProvider} — request bị từ chối.`,
      `Provider: ${cloudProvider} | UA: ${userAgent.slice(0, 200)}`
    );
    return res.status(403).json({
      success: false,
      code: "CLOUD_IP_BLOCKED",
      error: "Truy cập từ máy chủ đám mây (Cloud/VPS) bị từ chối. Huy Locket chỉ phục vụ người dùng thật.",
    });
  }

  // [TẦNG 3] Chặn request thiếu User-Agent
  if (!userAgent || userAgent.length < 10) {
    console.warn(`[🚫 WAF] Missing/short UA from IP: ${ip}`);
    handleThreatDetected(req, ip, "BOT_EMPTY_USER_AGENT", "MEDIUM",
      "Truy cập tự động bị từ chối — thiếu hoặc sai định dạng User-Agent"
    );
    return res.status(403).json({
      success: false, code: "BOT_DETECTED",
      error: "Hệ thống tường lửa Huy Locket từ chối truy cập: Không nhận diện được thiết bị/trình duyệt hợp lệ.",
    });
  }

  // [TẦNG 3] Bot UA Keywords
  const uaLower = userAgent.toLowerCase();
  const matchedKeyword = BLOCKED_UA_KEYWORDS.find(kw => uaLower.includes(kw));
  if (matchedKeyword) {
    console.warn(`[🚫 WAF Bot] Blocked "${matchedKeyword}" bot from IP: ${ip}`);
    handleThreatDetected(req, ip, "AUTOMATED_SCRAPER_BOT", "MEDIUM",
      `Phát hiện công cụ cào tự động (${userAgent.slice(0, 150)}) — keyword: "${matchedKeyword}"`,
      `Matched: ${matchedKeyword}`
    );
    return res.status(403).json({
      success: false, code: "BOT_BLOCKED",
      error: "Hệ thống bảo mật Huy Locket đã từ chối yêu cầu từ Bot hoặc công cụ tự động hóa.",
    });
  }

  // [TẦNG 4] Headless Browser Detection
  const headlessResult = detectHeadlessBrowser(userAgent);
  if (headlessResult) {
    console.warn(`[🛑 WAF Headless] Detected ${headlessResult} from IP: ${ip}`);
    handleThreatDetected(req, ip, "HEADLESS_BROWSER_DETECTED", "HIGH",
      `Phát hiện trình duyệt ảo ${headlessResult} — cực kỳ nghi vấn bot scraper`,
      `Detected: ${headlessResult} | UA: ${userAgent.slice(0, 200)}`
    );
    return res.status(403).json({
      success: false, code: "HEADLESS_BLOCKED",
      error: "Huy Locket từ chối truy cập từ trình duyệt tự động (Headless Browser). Vui lòng sử dụng trình duyệt thật.",
    });
  }

  // [TẦNG 5] Browser Integrity Check — chỉ cảnh báo (có thể false positive)
  const integrityIssues = checkBrowserIntegrity(req);
  if (integrityIssues.length >= 2) {
    // 2+ dấu hiệu bất thường = khả năng cao là bot giả mạo trình duyệt
    console.warn(`[⚠️ WAF Integrity] Suspicious browser from IP: ${ip} — Issues: ${integrityIssues.join(", ")}`);
    handleThreatDetected(req, ip, "SUSPICIOUS_BROWSER_FINGERPRINT", "MEDIUM",
      `Trình duyệt đáng ngờ — thiếu ${integrityIssues.length} header đặc trưng: ${integrityIssues.join(", ")}`,
      `Issues: ${integrityIssues.join(", ")} | UA: ${userAgent.slice(0, 200)}`
    );
    // Vẫn cho qua và ghi nhận để admin xem trong nhật ký bảo mật.
  }

  req.isVerifiedUserClient = true;
  return next();
}

// ═══════════════════════════════════════════════════════════════════
// [TẦNG 6] WAF Security Shield: SQLi / XSS / Path Traversal
// ═══════════════════════════════════════════════════════════════════
function wafSecurityShield(req, res, next) {
  if (req.method === "OPTIONS" || isExemptPath(req.path) || isAdminRequest(req)) {
    return next();
  }

  let urlStr = req.originalUrl || req.url || "";
  try { urlStr = decodeURIComponent(urlStr); } catch { /* ignore */ }
  const queryStr = JSON.stringify(req.query || {});
  const bodyStr = req.body && typeof req.body === "object" ? JSON.stringify(req.body) : "";
  const combined = `${urlStr} ${queryStr} ${bodyStr}`;

  const sqliRegex = /(\b(union\s+select|insert\s+into\s+\w+|drop\s+table|delete\s+from\s+\w+|alter\s+table|create\s+table|exec\s*\(|execute\s*\(|xp_cmdshell|information_schema|sys\.objects|waitfor\s+delay|benchmark\s*\(|sleep\s*\(|load_file\s*\(|into\s+outfile|into\s+dumpfile)\b|(%27|')\s*(or|and)\s*('|\d|\w+)\s*(=|LIKE))/i;
  const xssRegex = /(<script\b|javascript:|on(load|error|click|mouseover|mouseout|focus|blur|submit|change|input|keydown|keyup|keypress)\s*=\s*("|')|<iframe\b|<embed\b|<object\b|<svg\s+onload|expression\s*\(|vbscript:|data:\s*text\/html)/i;
  const traversalRegex = /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\/etc\/passwd|\/etc\/shadow|windows\/system32|\.htaccess|\.htpasswd|\.env|\.git\/|web\.config|wp-config)/i;

  let detectedType = null;
  let severity = "HIGH";
  if (sqliRegex.test(combined)) { detectedType = "SQL_INJECTION"; severity = "CRITICAL"; }
  else if (xssRegex.test(combined)) { detectedType = "XSS_INJECTION"; severity = "CRITICAL"; }
  else if (traversalRegex.test(combined)) { detectedType = "PATH_TRAVERSAL"; severity = "CRITICAL"; }

  if (detectedType) {
    const ip = getRequestIp(req);
    console.warn(`[🛑 WAF] Blocked ${detectedType} from IP: ${ip} on ${req.originalUrl}`);
    handleThreatDetected(req, ip, detectedType, severity,
      `WAF Tường Lửa phát hiện payload mã độc ${detectedType}`,
      combined.slice(0, 400)
    );
    return res.status(403).json({
      success: false, code: "WAF_SECURITY_BLOCK",
      error: `Hệ thống Bảo Mật Huy Locket đã từ chối yêu cầu do phát hiện mã độc (${detectedType}). Lịch sử vi phạm đã được ghi nhận để admin xem xét.`,
    });
  }

  return next();
}

// ═══════════════════════════════════════════════════════════════════
// [TẦNG 7] DDoS Rate Limiter
// ═══════════════════════════════════════════════════════════════════
const globalDDoSShield = rateLimit({
  windowMs: 60 * 1000,
  limit: 800, // Tăng lên 800 req/phút để không chặn nhầm người dùng tải lại trang
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS" || isExemptPath(req.path) || isAdminRequest(req),
  handler: (req, res, next, options) => {
    const ip = getRequestIp(req);
    // Chỉ ghi nhận vi phạm; rate limiter tự từ chối request này.
    handleThreatDetected(req, ip, "DDOS_RATE_FLOOD", "HIGH",
      "Vượt ngưỡng tường lửa (>800 req/phút)"
    );
    res.status(429).json(options.message);
  },
  message: {
    success: false,
    code: "DDOS_SHIELD_TRIGGERED",
    error: "Bạn đang gửi quá nhiều yêu cầu. Vui lòng chậm lại một chút.",
  },
});

// Rate limit cực kỳ nghiêm ngặt cho API nhạy cảm (broadcast, admin, auth)
const sensitiveApiShield = rateLimit({
  windowMs: 60 * 1000,
  limit: 100, // Tăng lên 100 req/phút để an toàn hơn cho người dùng thật
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getRequestIp(req),
  skip: (req) => req.method === "OPTIONS" || isAdminRequest(req),
  handler: (req, res) => {
    const ip = getRequestIp(req);
    handleThreatDetected(req, ip, "SENSITIVE_API_FLOOD", "HIGH",
      `Gửi quá nhiều request đến endpoint nhạy cảm ${req.originalUrl} (>100/phút)`
    );
    res.status(429).json({
      success: false,
      code: "API_RATE_LIMITED",
      error: "Quá nhiều yêu cầu đến API bảo mật. Vui lòng thử lại sau.",
    });
  }
});

module.exports = {
  antiBotMiddleware,
  wafSecurityShield,
  globalDDoSShield,
  sensitiveApiShield,
  getRequestIp,
};

