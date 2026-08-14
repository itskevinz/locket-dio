import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Clock,
  FileText,
  Info,
  Key,
  Lock,
  MapPin,
  Monitor,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Unlock,
  Users,
  CheckCircle,
  Zap,
  Volume2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { SonnerInfo, SonnerSuccess, SonnerWarning } from "@/components/uikit/SonnerToast";
import ScrollReveal from "@/components/Effects/ScrollReveal";
import { useAnimation } from "@/context/AnimationContext";
import { updateAndSyncGpsLocation } from "@/services/UserActivityService";
import AdminSystemHealth from "../AdminSystemHealth";
import AdminSecurityGate, { AdminRouteLoading, AdminSecurityHandoff } from "./AdminSecurityGate";
import AdminMailComposer from "./AdminMailComposer";
import { CONFIG } from "@/config";
import {
  adminRequest,
  changeAdminPin,
  clearShortAdminSessionToken,
  getAdminRoleInfo,
  hasAdminSession,
  hasShortAdminSession,
  startShortAdminSession,
  verifyAdmin2FAOTP,
  setTrustedDeviceToken,
} from "@/services/AdminAuthService";

const UNKNOWN = "Không xác định";
const LIVE_REFRESH_INTERVAL_MS = 5_000;

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("vi-VN");
}

function formatPlatformMetric(metric) {
  if (!metric || !Number.isFinite(Number(metric.value))) return "Chưa có dữ liệu";
  const value = Number(metric.value);
  const unit = String(metric.unit || "").toLowerCase();
  if (unit.includes("byte")) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let scaled = value;
    let index = 0;
    while (scaled >= 1024 && index < units.length - 1) {
      scaled /= 1024;
      index += 1;
    }
    return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[index]}`;
  }
  return `${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function relativeActivity(value) {
  if (!value) return "Chưa ghi nhận hoạt động";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Vừa hoạt động";
  if (minutes < 60) return `Hoạt động ${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hoạt động ${hours} giờ trước`;
  return `Hoạt động ${Math.floor(hours / 24)} ngày trước`;
}

function getFixedNumericUid(uid) {
  if (!uid || uid === "—" || uid === "SYSTEM" || uid === "Không xác định") return uid;
  const cleanUid = String(uid).trim();
  if (/^\d+$/.test(cleanUid)) return `#${cleanUid}`;
  let hash = 0;
  const str = `_huy_locket_immutable_${cleanUid}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0;
  }
  const numericId = 10000000 + (hash % 90000000);
  return `UID: #${numericId}`;
}

function sourceLabel(source) {
  if (source === "vercel") return "Vercel";
  if (source === "railway") return "Railway";
  if (source === "local") return "Local";
  return source ? String(source) : "Chưa rõ";
}

function loginMethodLabel(method) {
  if (method === "session-resume") return "Khôi phục phiên";
  return method || UNKNOWN;
}

function userName(user) {
  return user.displayName || user.username || "Chưa có tên hồ sơ";
}

function roleBadge(role) {
  const r = (role || "user").toLowerCase();
  if (r === "super_admin") {
    return <span className="badge badge-primary font-black text-xs gap-1 shadow-md px-2.5 py-3 border-2 border-primary-content/30">👑 SUPER ADMIN</span>;
  }
  if (r === "admin") {
    return <span className="badge badge-secondary font-bold text-xs gap-1 shadow-sm px-2.5 py-3">🛡️ ADMIN</span>;
  }
  if (r === "moderator") {
    return <span className="badge badge-accent font-semibold text-xs gap-1 py-2.5 px-2">⚖️ MODERATOR</span>;
  }
  if (r === "support") {
    return <span className="badge badge-info text-xs gap-1 py-2.5 px-2">🎧 SUPPORT</span>;
  }
  return <span className="badge badge-ghost badge-xs font-mono">User</span>;
}

function errorMessage(error) {
  if (error?.code === "DATABASE_NOT_CONFIGURED") {
    return "Database theo dõi người dùng chưa được cấu hình trên Vercel API.";
  }
  if (error?.status === 403 || error?.code === "ADMIN_PERMISSION_REQUIRED") {
    return "Tài khoản này không có quyền xem dữ liệu quản trị.";
  }
  if (error?.status === 401 || error?.code === "ADMIN_SESSION_EXPIRED") {
    return "Phiên làm việc nhạy cảm đã hết hạn hoặc cần xác minh Mã PIN số bảo mật.";
  }
  return `Không thể tải dữ liệu. ${error?.message || "Lỗi không xác định"}`;
}

function renderUserLocation(user, latestLogin) {
  const data = latestLogin || user;
  const gpsLoc = data?.gps_coordinates || user.gps_coordinates;
  const ipLoc = [data?.city || user.city, data?.region || user.region, data?.country || user.country]
    .filter((v) => v && v !== UNKNOWN && v !== "Unknown").join(", ") || UNKNOWN;

  if (gpsLoc) {
    return (
      <a
        href={`https://www.google.com/maps?q=${encodeURIComponent(gpsLoc)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-500 hover:text-emerald-400 font-extrabold inline-flex items-center gap-1.5 underline decoration-emerald-500/50 hover:decoration-emerald-400 text-xs"
        title="Tọa độ GPS chính xác (do người dùng đã bật định vị trên thiết bị)"
      >
        <span>📍 Đã bật GPS ({gpsLoc})</span>
      </a>
    );
  }
  return (
    <span className="text-amber-500 font-semibold inline-flex items-center gap-1.5 text-xs" title="Vị trí trạm nhà mạng gần đúng theo IP">
      <span>🌐 Vị trí IP (gần đúng): {ipLoc}</span>
    </span>
  );
}

export default function AdminUsers() {
  const navigate = useNavigate();
  const { isAnimationEnabled } = useAnimation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentRole, setCurrentRole] = useState("user");
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentUserUid, setCurrentUserUid] = useState("");
  const [checkingAdmin, setCheckingAdmin] = useState(hasAdminSession());
  const [activeTab, setActiveTab] = useState("users"); // "users" | "audit" | "reports"

  // Cổng bảo mật Quản trị viên (PIN Gate) right on entering Admin Page
  const [hasPin, setHasPin] = useState(false);
  const [isGateUnlocked, setIsGateUnlocked] = useState(hasShortAdminSession());
  const [gatePassword, setGatePassword] = useState("");
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState(null);
  const [gateVerified, setGateVerified] = useState(false);
  const gateUnlockTimerRef = useRef(null);
  const gateRevealTimerRef = useRef(null);

  // 2FA Security states
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [gate2FATempToken, setGate2FATempToken] = useState(null);
  const [gate2FAOtp, setGate2FAOtp] = useState("");
  const [gate2FARememberDevice, setGate2FARememberDevice] = useState(true);
  const [setup2FAOpen, setSetup2FAOpen] = useState(false);
  const [setup2FAData, setSetup2FAData] = useState(null);
  const [setup2FAOtp, setSetup2FAOtp] = useState("");
  const [setup2FALoading, setSetup2FALoading] = useState(false);
  const [setup2FAError, setSetup2FAError] = useState(null);
  const [disable2FAConfirmMode, setDisable2FAConfirmMode] = useState(false);
  const [disable2FAOtp, setDisable2FAOtp] = useState("");

  // Change PIN modal states
  const [changePinModalOpen, setChangePinModalOpen] = useState(false);
  const [changePinOld, setChangePinOld] = useState("");
  const [changePinNew, setChangePinNew] = useState("");
  const [changePinLoading, setChangePinLoading] = useState(false);
  const [changePinError, setChangePinError] = useState(null);

  // User tab states
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [pageToken, setPageToken] = useState(null);
  const [totalUsers, setTotalUsers] = useState(0);
  const [onlineWindowSeconds, setOnlineWindowSeconds] = useState(150);
  const [selectedUser, setSelectedUser] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyState, setHistoryState] = useState("idle");
  const [historyError, setHistoryError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);
  const [purgingBots, setPurgingBots] = useState(false);
  const rootRefreshInFlight = useRef(false);

  // Web User Actions (Realtime Behavior Surveillance) states
  const [userActions, setUserActions] = useState([]);
  const [userActionsLoading, setUserActionsLoading] = useState(false);
  const [userActionsError, setUserActionsError] = useState(null);
  const [userActionsFilterType, setUserActionsFilterType] = useState("");
  const [userActionsSearch, setUserActionsSearch] = useState("");
  const [autoRefreshActions, setAutoRefreshActions] = useState(true);
  const [clearingActions, setClearingActions] = useState(false);

  // Security Threats & WAF Firewall states
  const [securityThreats, setSecurityThreats] = useState([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState(null);
  const [securityFilterType, setSecurityFilterType] = useState("");
  const [securitySearch, setSecuritySearch] = useState("");
  const [simulatingThreat, setSimulatingThreat] = useState(null);
  const [clearingThreats, setClearingThreats] = useState(false);

  // Audit Logs states
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(null);
  const [auditFilterAction, setAuditFilterAction] = useState("");
  const [auditFilterAdmin, setAuditFilterAdmin] = useState("");

  // Reports states
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState(null);

  // Advanced Super Admin tools states
  const [advancedSubTab, setAdvancedSubTab] = useState("telemetry"); // "telemetry" | "broadcast" | "blacklist"
  const [serverHealth, setServerHealth] = useState(null);
  const [clientTelemetry, setClientTelemetry] = useState(null);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastActive, setBroadcastActive] = useState(false);
  const [broadcastTarget, setBroadcastTarget] = useState("ALL");
  const [broadcastList, setBroadcastList] = useState([]);
  const [whitelistItems, setWhitelistItems] = useState([]);
  const [whitelistInput, setWhitelistInput] = useState("");
  const [whitelistType, setWhitelistType] = useState("email");
  const [blacklistedIps, setBlacklistedIps] = useState([]);
  const [banIpInput, setBanIpInput] = useState("");
  const [banReasonInput, setBanReasonInput] = useState("");
  const [passwordStatusModal, setPasswordStatusModal] = useState(null);

  // API Heartbeat monitor states
  const [apiStatuses, setApiStatuses] = useState([]);
  const [testingApis, setTestingApis] = useState(false);
  const [refreshingTelemetry, setRefreshingTelemetry] = useState(false);

  const runApiHealthCheck = useCallback(async () => {
    setTestingApis(true);
    const apiDomain = String(CONFIG.api.baseUrl || "/dio-api").replace(/\/$/, "");
    const targets = [
      {
        id: "music_lib",
        name: "🎵 Thư Viện Nhạc Locket (Music Tracks API)",
        desc: "Cung cấp bài hát gốc, tìm kiếm và phát audio mượt mà trên video Locket",
        url: `${apiDomain}/api/music/tracks`,
        method: "GET",
        isCors: false,
        errorHelp: "Lỗi 404/500: Vercel API chưa đồng bộ route âm nhạc hoặc CSDL Neon mất bảng music_tracks.",
        remedy: "Mở Vercel Runtime Logs của project huy-locket-api và kiểm tra deployment production mới nhất."
      },
      {
        id: "music_search",
        name: "🎧 Cầu Nối Spotify & Apple Music",
        desc: "Hệ thống truy xuất metadata và đồng bộ ISRC bản quyền từ Spotify/Apple",
        url: `${apiDomain}/api/searchMusic?q=locket&limit=1`,
        method: "GET",
        isCors: false,
        errorHelp: "Nghẽn Token: API Key Spotify/Apple bị hạn chế số lần gọi (Rate-limit) hoặc từ chối chứng chỉ.",
        remedy: "Hệ thống đã có cụm chuyển trạm dự phòng Apple Music. Nếu vẫn lỗi, cấp lại Spotify Client ID & Secret trong Environment Variables của huy-locket-api."
      },
      {
        id: "weather_api",
        name: "🌦️ Trạm Dữ Liệu Thời Tiết (Open-Meteo API)",
        desc: "Cung cấp chỉ số nhiệt độ, độ ẩm và thời tiết thực tế cho nhãn dán Locket",
        url: "https://api.open-meteo.com/v1/forecast?latitude=13.77&longitude=109.22&current_weather=true",
        method: "GET",
        isCors: false,
        errorHelp: "Mất kết nối DNS quốc tế: Hạ tầng CDN của Open-Meteo hoặc cáp quang mạng đang gián đoạn.",
        remedy: "Open-Meteo là máy chủ công cộng miễn phí. Khi mất sóng ngầm, Locket tự giữ nhãn dán nhiệt độ gần nhất trong Cache, chỉ cần chờ nhà mạng khôi phục."
      },
      {
        id: "ip_radar",
        name: "📍 Cảm Biến Định Vị Radar IP (FreeIPAPI / IPInfo)",
        desc: "Dò tìm vị trí thực tế, tỉnh thành và bảo mật đường truyền người dùng Locket",
        url: "https://freeipapi.com/api/json/",
        method: "GET",
        isCors: true,
        errorHelp: "Bị phong tỏa đường truyền: Trình duyệt đang bật 'Trình chặn quảng cáo / Quyền riêng tư' (AdBlock / Brave / Edge Privacy / Tracking Protection) cản lệnh gọi IP.",
        remedy: "Bấm vào biểu tượng Khiên (Shield/Lock) bên trái thanh URL trình duyệt -> Tắt 'Chặn Theo Dõi (Tracking Protection)' hoặc tắt AdBlock cho trang duchi.vercel.app để Cảm biến Radar hoạt động bình thường."
      },
      {
        id: "media_proxy",
        name: "🖼️ Trạm Xử Lý Media & Đám Mây Google Drive",
        desc: "Nén video, chuyển đổi định dạng ảnh và truyền tải lưu trữ Drive tốc độ cao",
        url: "https://media-service.buiduchuy2010qn.workers.dev/convertImage",
        method: "HEAD",
        isCors: true,
        errorHelp: "Lỗi proxy ảnh: Tên miền media-service tạm quá tải băng thông hoặc hạn chế chứng chỉ Cloudflare.",
        remedy: "Khởi động lại Cloudflare Worker gắn với máy chủ ảnh, kiểm tra dung lượng trống trên Google Drive Backup để tránh tràn bộ nhớ."
      },
      {
        id: "collab_api",
        name: "🤝 Trạm Dịch Vụ Ghép Ảnh (Collab Kanade API)",
        desc: "Hệ thống bổ trợ chế độ ghép đôi Collab và tạo khung hiệu ứng cực chất",
        url: "https://api.captionkanade.site",
        method: "HEAD",
        isCors: true,
        errorHelp: "Máy chủ cộng đồng bảo trì: Tên miền đối tác captionkanade.site tạm dừng máy chủ VPS.",
        remedy: "Đây là API bổ trợ độc lập. Nếu gián đoạn, người dùng vẫn có thể ghép khung Locket mặc định không bị gián đoạn app."
      },
      {
        id: "vercel_api",
        name: "▲ API Trung Tâm (Vercel Function)",
        desc: "Xử lý quản trị phiên làm việc, bảo mật ứng dụng và kết nối Neon SQL",
        url: `${apiDomain}/health`,
        method: "GET",
        isCors: false,
        errorHelp: "Vercel Function không phản hồi hoặc kết nối Neon đang gián đoạn.",
        remedy: "Kiểm tra deployment và Runtime Logs của huy-locket-api trên Vercel, sau đó kiểm tra Neon nếu lỗi truy vấn."
      }
    ];

    const results = [];
    for (const t of targets) {
      const startTime = performance.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const fetchOpts = { method: t.method || "GET", signal: controller.signal };
        if (t.isCors) fetchOpts.mode = "no-cors";
        
        const res = await fetch(t.url, fetchOpts);
        clearTimeout(timeoutId);
        const duration = Math.round(performance.now() - startTime);
        const isLive = t.isCors ? true : (res.status < 500 && res.status !== 404);
        results.push({ ...t, status: isLive ? "ONLINE" : "ERROR", ping: duration, httpStatus: t.isCors ? "OK (CORS Guard)" : `HTTP ${res.status}` });
      } catch (err) {
        const duration = Math.round(performance.now() - startTime);
        results.push({ ...t, status: "OFFLINE", ping: duration, httpStatus: err.name === "AbortError" ? "Timeout (> 6000ms)" : "Mất kết nối / Blocked" });
      }
    }
    setApiStatuses(results);
    setTestingApis(false);
  }, []);

  const updateClientTelemetry = useCallback(async (pingMs) => {
    let connectionType = "WiFi / Băng thông rộng";
    let downlinkMbps = "Tối đa";
    if (navigator.connection) {
      const type = navigator.connection.type;
      const eff = navigator.connection.effectiveType;
      if (type && type !== "unknown" && type !== "other") {
        const mapType = { wifi: "WiFi Băng thông rộng", ethernet: "Cáp quang / LAN Ethernet", cellular: "Mạng Di Động (4G/5G)", wimax: "WiMAX" };
        connectionType = mapType[type] || type.toUpperCase();
      } else if (eff) {
        // W3C effectiveType '4g' means broadband speed (WiFi/LAN/Fiber > 5Mbps), not necessarily cellular data!
        if (eff === "4g") {
          connectionType = "WiFi / Cáp quang Băng thông rộng";
        } else {
          connectionType = `Tốc độ mạng di động / tín hiệu yếu (${eff.toUpperCase()})`;
        }
      }
      if (navigator.connection.downlink) downlinkMbps = `${navigator.connection.downlink} Mbps`;
      if (!pingMs && navigator.connection.rtt) pingMs = navigator.connection.rtt;
    }

    let storageBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        storageBytes += ((key ? key.length : 0) + (localStorage.getItem(key)?.length || 0)) * 2;
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        storageBytes += ((key ? key.length : 0) + (sessionStorage.getItem(key)?.length || 0)) * 2;
      }
    } catch (e) {}

    let cachedItemsCount = 0;
    try {
      if ("caches" in window && caches.keys) {
        const keys = await caches.keys();
        for (const k of keys) {
          const c = await caches.open(k);
          const reqs = await c.keys();
          cachedItemsCount += reqs.length;
        }
      }
    } catch (e) {}

    let userAgentBrand = "Web Browser";
    if (navigator.userAgentData?.brands?.length) {
      // Filter out W3C Chromium anti-fingerprinting noise (e.g., "Not;A=Brand", "Chromium")
      const validBrands = navigator.userAgentData.brands.filter(
        (b) => !b.brand.includes("Not") && !b.brand.includes("Brand") && !b.brand.includes("Chromium")
      );
      if (validBrands.length > 0) {
        userAgentBrand = validBrands.map((b) => `${b.brand} v${b.version || ""}`).join(", ");
      } else {
        userAgentBrand = "Google Chrome / Chromium";
      }
    } else if (navigator.userAgent.includes("Edg")) {
      userAgentBrand = "Microsoft Edge";
    } else if (navigator.userAgent.includes("Chrome")) {
      userAgentBrand = "Google Chrome";
    } else if (navigator.userAgent.includes("Safari")) {
      userAgentBrand = "Apple Safari / iOS";
    } else if (navigator.userAgent.includes("Firefox")) {
      userAgentBrand = "Mozilla Firefox";
    }

    setClientTelemetry({
      pingVal: typeof pingMs === "number" ? pingMs : null,
      pingMs: typeof pingMs === "number" ? `${pingMs} ms` : "⚡ < 15 ms",
      connectionType,
      downlinkMbps,
      userAgentBrand,
      cpuThreads: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} Lõi CPU` : "8 Lõi",
      deviceRAM: navigator.deviceMemory ? `${navigator.deviceMemory} GB RAM` : "Tối ưu hóa dung lượng",
      localStorageBytes: Math.max(1, Math.round(storageBytes / 1024)),
      cachedItemsCount,
      protocol: `${window.location.protocol.toUpperCase().replace(":", "")} (SSL/TLS 1.3 Active)`,
    });
  }, []);

  const fetchAdvancedData = useCallback(async (isUserAction = false) => {
    if (typeof isUserAction === "boolean" && isUserAction) setRefreshingTelemetry(true);
    try {
      const tStart = performance.now();
      const h = await adminRequest(`/server-health?_=${Date.now()}`);
      const tEnd = performance.now();
      if (h?.data) {
        setServerHealth(h.data);
        updateClientTelemetry(Math.round(tEnd - tStart));
      } else {
        updateClientTelemetry(null);
      }
      const b = await adminRequest(`/broadcast?_=${Date.now()}`);
      if (b?.data) {
        setBroadcastMsg("");
        setBroadcastActive(Boolean(b.data.active && b.data.message));
        setBroadcastTarget(b.data.targetUser || "ALL");
      }
      if (b?.list) setBroadcastList(b.list || []);
      const p = await adminRequest(`/ip-blacklist?_=${Date.now()}`);
      if (p?.list) setBlacklistedIps(p.list || []);
      const w = await adminRequest(`/whitelist?_=${Date.now()}`);
      if (w?.list) setWhitelistItems(w.list || []);
      if (typeof isUserAction === "boolean" && isUserAction) {
        SonnerSuccess("⚡ Đã cập nhật chỉ số cảm biến và nhịp tim máy chủ mới nhất!");
      }
    } catch (err) {
      console.warn("Failed fetching advanced tools data:", err);
      if (typeof isUserAction === "boolean" && isUserAction) {
        SonnerWarning("⚠️ Mất kết nối tới Vercel API khi cập nhật cảm biến.");
      }
    } finally {
      if (typeof isUserAction === "boolean" && isUserAction) setRefreshingTelemetry(false);
    }
  }, [updateClientTelemetry]);

  // Modals state
  const [actionModal, setActionModal] = useState(null); // { type: 'lock'|'unlock'|'revoke'|'role', user, newRole, reason }
  const [reauthModalOpen, setReauthModalOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthError, setReauthError] = useState(null);
  const [pendingCallback, setPendingCallback] = useState(null);
  const [generalApologyEmail, setGeneralApologyEmail] = useState("");
  const [mailComposer, setMailComposer] = useState(null);
  const [mailTemplate, setMailTemplate] = useState("apology");
  const [mailSending, setMailSending] = useState(false);

  const fetchUsers = useCallback(async (token = "", { silent = false, live = false } = {}) => {
    const isRootRefresh = !token;
    if (isRootRefresh && rootRefreshInFlight.current) return;
    if (isRootRefresh) rootRefreshInFlight.current = true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const query = new URLSearchParams({ limit: "100" });
      if (token) query.set("pageToken", token);
      if (live) query.set("live", "1");
      const data = await adminRequest(`/users?${query.toString()}`);
      const nextUsers = data.users || [];
      setUsers((current) => {
        if (!token && !live) return nextUsers;
        if (!token && live) {
          const refreshed = new Set(nextUsers.map((entry) => entry.uid));
          return [...nextUsers, ...current.filter((entry) => !refreshed.has(entry.uid))];
        }
        const merged = new Map(current.map((entry) => [entry.uid, entry]));
        for (const entry of nextUsers) merged.set(entry.uid, entry);
        return Array.from(merged.values());
      });
      if (!token) {
        setSelectedUser((current) => {
          if (!current) return current;
          const updated = nextUsers.find((entry) => entry.uid === current.uid);
          return updated ? { ...current, ...updated } : current;
        });
      }
      setPageToken((current) => live && current ? current : data.pageToken || null);
      setTotalUsers(Number(data.totalUsers || 0));
      setOnlineWindowSeconds(data.onlineWindowSeconds || 150);
      setError(null);
    } catch (requestError) {
      if (requestError.status === 401 || requestError.code === "ADMIN_SESSION_EXPIRED") {
        clearShortAdminSessionToken();
        navigate('/', { replace: true });
      }
      if (!silent || requestError.status === 401 || requestError.status === 403) {
        setError({ code: requestError.code, message: errorMessage(requestError) });
      }
    } finally {
      if (isRootRefresh) rootRefreshInFlight.current = false;
      if (!silent) {
        setLoading(false);
        setCheckingAdmin(false);
      }
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const query = new URLSearchParams({ limit: "100" });
      if (auditFilterAction) query.set("action", auditFilterAction);
      if (auditFilterAdmin) query.set("adminUid", auditFilterAdmin);
      const data = await adminRequest(`/audit-logs?${query.toString()}`);
      setAuditLogs(data.logs || []);
    } catch (err) {
      if (err?.code === "ADMIN_SESSION_EXPIRED" || err?.status === 401) {
        clearShortAdminSessionToken();
        navigate('/', { replace: true });
      }
      setAuditError(errorMessage(err));
    } finally {
      setAuditLoading(false);
    }
  }, [auditFilterAction, auditFilterAdmin]);

  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    setReportsError(null);
    try {
      const data = await adminRequest("/content/reports?status=pending");
      setReports(data.reports || []);
    } catch (err) {
      if (err?.code === "ADMIN_SESSION_EXPIRED" || err?.status === 401) {
        clearShortAdminSessionToken();
        navigate('/', { replace: true });
      }
      setReportsError(errorMessage(err));
    } finally {
      setReportsLoading(false);
    }
  }, []);

  const fetchUserActions = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setUserActionsLoading(true);
    setUserActionsError(null);
    try {
      const query = new URLSearchParams({ limit: "200" });
      if (userActionsFilterType) query.set("actionType", userActionsFilterType);
      if (userActionsSearch) query.set("search", userActionsSearch);
      const data = await adminRequest(`/user-actions?${query.toString()}`);
      setUserActions(data.actions || []);
    } catch (err) {
      if (err?.code === "ADMIN_SESSION_EXPIRED" || err?.status === 401) {
        clearShortAdminSessionToken();
        navigate('/', { replace: true });
      }
      if (!silent) setUserActionsError(errorMessage(err));
    } finally {
      if (!silent) setUserActionsLoading(false);
    }
  }, [userActionsFilterType, userActionsSearch]);

  const handleClearUserActions = async () => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa sạch nhật ký hoạt động Web của tất cả người dùng không? (Hành động này không thể hoàn tác)")) {
      return;
    }
    setClearingActions(true);
    try {
      await adminRequest("/user-actions", { method: "DELETE" });
      setUserActions([]);
      SonnerSuccess("Đã xóa sạch lịch sử theo dõi hoạt động Web!");
    } catch (err) {
      SonnerWarning(errorMessage(err));
    } finally {
      setClearingActions(false);
    }
  };

  const fetchSecurityThreats = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setSecurityLoading(true);
    setSecurityError(null);
    try {
      const query = new URLSearchParams({ limit: "200" });
      if (securityFilterType) query.set("threatType", securityFilterType);
      if (securitySearch) query.set("search", securitySearch);
      const data = await adminRequest(`/security-threats?${query.toString()}`);
      setSecurityThreats(data.threats || []);
    } catch (err) {
      if (err?.code === "ADMIN_SESSION_EXPIRED" || err?.status === 401) {
        clearShortAdminSessionToken();
        navigate('/', { replace: true });
      }
      if (!silent) setSecurityError(errorMessage(err));
    } finally {
      if (!silent) setSecurityLoading(false);
    }
  }, [securityFilterType, securitySearch]);

  const handleSimulateThreat = async (threatType) => {
    setSimulatingThreat(threatType);
    try {
      await adminRequest("/security-threats/simulate-test", {
        method: "POST",
        body: JSON.stringify({ threatType }),
        headers: { "Content-Type": "application/json" },
      });
      SonnerSuccess(`Đã giả lập phát hiện & đánh chặn thành công cuộc tấn công: ${threatType}`);
      fetchSecurityThreats({ silent: true });
    } catch (err) {
      SonnerWarning(errorMessage(err));
    } finally {
      setSimulatingThreat(null);
    }
  };

  const handleClearSecurityThreats = async () => {
    if (!window.confirm("Bạn có chắc muốn xóa toàn bộ lịch sử cảnh báo tấn công bảo mật và tường lửa không?")) return;
    setClearingThreats(true);
    try {
      await adminRequest("/security-threats?id=ALL", { method: "DELETE" });
      setSecurityThreats([]);
      SonnerSuccess("Đã xóa sạch bản ghi tường lửa & bảo mật!");
    } catch (err) {
      SonnerWarning(errorMessage(err));
    } finally {
      setClearingThreats(false);
    }
  };

  useEffect(() => {
    if (!hasAdminSession()) {
      setCheckingAdmin(false);
      navigate("/login", { replace: true });
      return undefined;
    }

    let active = true;
    getAdminRoleInfo()
      .then((info) => {
        if (!active) return;
        setIsAdmin(info.isAdmin);
        setCurrentRole(info.role || "user");
        setCurrentUserUid(info.uid || "");
        setCurrentEmail(info.email || localStorage.getItem("email") || "");
        setHasPin(info.hasPin || false);
        setIs2FAEnabled(info.is2FAEnabled || false);

        // If already unlocked (valid session in last 30 mins), load users
        if (info.isAdmin && hasShortAdminSession()) {
          setIsGateUnlocked(true);
          fetchUsers();
        } else {
          setCheckingAdmin(false);
          setIsGateUnlocked(false);
        }
      })
      .catch((requestError) => {
        if (!active) return;
        setIsAdmin(false);
        setCheckingAdmin(false);
        SonnerInfo(errorMessage(requestError));
        navigate("/locket", { replace: true });
      });
    return () => {
      active = false;
    };
  }, [fetchUsers, navigate]);

  useEffect(() => {
    if (!isAdmin || !isGateUnlocked || activeTab !== "users") return undefined;
    const refreshLiveUsers = () => {
      if (document.hidden) return;
      fetchUsers("", { silent: true, live: true });
    };
    const timer = window.setInterval(refreshLiveUsers, LIVE_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshLiveUsers();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchUsers, isAdmin, isGateUnlocked, activeTab]);

  useEffect(() => {
    if (!isAdmin || !isGateUnlocked) return;
    if (activeTab === "audit" && (currentRole === "super_admin" || currentRole === "admin")) {
      fetchAuditLogs();
    }
    if (activeTab === "reports" && currentRole !== "support") {
      fetchReports();
    }
    if (activeTab === "user_actions") {
      fetchUserActions();
    }
    if (activeTab === "security_threats") {
      fetchSecurityThreats();
    }
  }, [activeTab, isAdmin, isGateUnlocked, currentRole, fetchAuditLogs, fetchReports, fetchUserActions, fetchSecurityThreats]);

  useEffect(() => {
    if (!isAdmin || !isGateUnlocked || activeTab !== "user_actions" || !autoRefreshActions) return undefined;
    const timer = window.setInterval(() => {
      if (!document.hidden) fetchUserActions({ silent: true });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [isAdmin, isGateUnlocked, activeTab, autoRefreshActions, fetchUserActions]);

  useEffect(() => {
    if (!isAdmin || !isGateUnlocked || activeTab !== "security_threats") return undefined;
    const timer = window.setInterval(() => {
      if (!document.hidden) fetchSecurityThreats({ silent: true });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [isAdmin, isGateUnlocked, activeTab, fetchSecurityThreats]);

  useEffect(() => {
    if (!isAdmin || !isGateUnlocked || activeTab !== "advanced") return undefined;
    const timer = window.setInterval(() => {
      if (!document.hidden) fetchAdvancedData(false);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [isAdmin, isGateUnlocked, activeTab, fetchAdvancedData]);

  const { adminTeam, normalUsers } = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const list = !normalized ? users : users.filter((user) =>
      user.displayName?.toLowerCase().includes(normalized)
      || user.username?.toLowerCase().includes(normalized)
      || user.email?.toLowerCase().includes(normalized)
      || user.uid.toLowerCase().includes(normalized)
    );
    const admins = [];
    const regulars = [];
    for (const u of list) {
      if (u.role !== "user" || u.isAdmin || u.role === "super_admin") admins.push(u);
      else regulars.push(u);
    }
    return { adminTeam: admins, normalUsers: regulars };
  }, [search, users]);

  useEffect(() => {
    const refreshAfterUndo = () => fetchUsers("", { silent: true, live: true });
    window.addEventListener("locket_admin_users_refresh", refreshAfterUndo);
    return () => window.removeEventListener("locket_admin_users_refresh", refreshAfterUndo);
  }, [fetchUsers]);

  const isOnline = useCallback((user) => {
    if (!user.lastSeenAt || Number(user.activeSessions || 0) < 1) return false;
    return Date.now() - new Date(user.lastSeenAt).getTime() <= onlineWindowSeconds * 1000;
  }, [onlineWindowSeconds]);

  const openUser = async (user) => {
    setSelectedUser(user);
    setClearHistoryConfirm(false);
    setHistory([]);
    setHistoryError(null);
    setHistoryState("loading");
    try {
      const data = await adminRequest(`/users/${encodeURIComponent(user.uid)}/login-history?limit=100`);
      setHistory(data.history || []);
      setHistoryState((data.history || []).length ? "success" : "empty");
    } catch (requestError) {
      if (requestError?.code === "ADMIN_SESSION_EXPIRED" || requestError?.status === 401) {
        clearShortAdminSessionToken();
        navigate('/', { replace: true });
        setSelectedUser(null);
      } else {
        setHistoryError(errorMessage(requestError));
        setHistoryState("error");
      }
    }
  };

  const completeGateUnlock = useCallback(() => {
    setGateVerified(true);
    if (gateUnlockTimerRef.current) window.clearTimeout(gateUnlockTimerRef.current);
    if (gateRevealTimerRef.current) window.clearTimeout(gateRevealTimerRef.current);
    const reduceMotion = !isAnimationEnabled;
    gateRevealTimerRef.current = window.setTimeout(() => {
      setIsGateUnlocked(true);
      gateRevealTimerRef.current = null;
    }, reduceMotion ? 80 : 540);
    gateUnlockTimerRef.current = window.setTimeout(() => {
      setGateVerified(false);
      gateUnlockTimerRef.current = null;
    }, reduceMotion ? 140 : 1080);
  }, [isAnimationEnabled]);

  useEffect(() => () => {
    if (gateUnlockTimerRef.current) window.clearTimeout(gateUnlockTimerRef.current);
    if (gateRevealTimerRef.current) window.clearTimeout(gateRevealTimerRef.current);
  }, []);

  const handleGateSubmit = async (e) => {
    e.preventDefault();
    if (!gatePassword.trim() || !/^\d{4,8}$/.test(gatePassword.trim())) {
      setGateError("Vui lòng nhập mã PIN bảo mật (dãy số từ 4 đến 8 chữ số).");
      return;
    }
    setGateLoading(true);
    setGateVerified(false);
    setGateError(null);
    try {
      const res = await startShortAdminSession(gatePassword.trim());
      if (res?.require2FA && res?.tempToken) {
        setGate2FATempToken(res.tempToken);
        SonnerInfo("Vui lòng nhập mã OTP Google Authenticator để mở khóa.");
        setGateLoading(false);
        return;
      }
      if (!hasPin) {
        SonnerInfo("🎉 Thiết lập Mã PIN số Quản Trị viên thành công! Cổng bảo mật đã mở.");
        setHasPin(true);
      } else if (res?.trustedDeviceUsed) {
        SonnerInfo("🛡️ Thiết bị tin cậy được nhận diện! Bỏ qua OTP 2FA — Cổng bảo mật Admin đã mở.");
      } else {
        SonnerInfo("Xác minh mã PIN thành công! Cổng bảo mật Admin đã mở cho 30 phút tới.");
      }
      completeGateUnlock();
      fetchUsers();
      fetchAdvancedData();
    } catch (err) {
      setGateError(err.message || "Xác minh mã PIN thất bại. Vui lòng kiểm tra lại mã PIN.");
    } finally {
      setGatePassword("");
      setGateLoading(false);
    }
  };

  const handleGate2FASubmit = async (e) => {
    e.preventDefault();
    if (!gate2FAOtp.trim() || !/^\d{6}$/.test(gate2FAOtp.trim())) {
      setGateError("Vui lòng nhập đúng mã OTP 6 chữ số từ ứng dụng Google Authenticator.");
      return;
    }
    setGateLoading(true);
    setGateVerified(false);
    setGateError(null);
    try {
      await verifyAdmin2FAOTP(gate2FATempToken, gate2FAOtp.trim(), gate2FARememberDevice);
      SonnerInfo(gate2FARememberDevice
        ? "🎉 Xác nhận 2FA thành công! Thiết bị này đã được ghi nhớ 30 ngày."
        : "🎉 Xác nhận 2FA thành công! Cổng bảo mật Admin đã mở cho 30 phút tới."
      );
      completeGateUnlock();
      setGate2FATempToken(null);
      setGate2FAOtp("");
      fetchUsers();
      fetchAdvancedData();
    } catch (err) {
      setGateError(err.message || "Xác minh mã 2FA OTP thất bại.");
    } finally {
      setGateLoading(false);
    }
  };

  const handleOpenSetup2FA = async () => {
    setSetup2FAError(null);
    setSetup2FAOtp("");
    setSetup2FALoading(true);
    setSetup2FAOpen(true);
    try {
      const res = await adminRequest("/setup-2fa");
      setSetup2FAData(res);
      setIs2FAEnabled(Boolean(res?.is2FAEnabled));
    } catch (err) {
      setSetup2FAError(err.message || "Không thể lấy dữ liệu cài đặt 2FA từ máy chủ.");
    } finally {
      setSetup2FALoading(false);
    }
  };

  const handleConfirm2FA = async () => {
    if (!setup2FAOtp.trim() || !/^\d{6}$/.test(setup2FAOtp.trim())) {
      setSetup2FAError("Vui lòng nhập mã OTP 6 chữ số để kích hoạt.");
      return;
    }
    setSetup2FALoading(true);
    setSetup2FAError(null);
    try {
      const res = await adminRequest("/confirm-2fa", {
        method: "POST",
        body: JSON.stringify({ otpCode: setup2FAOtp.trim() }),
      });
      SonnerInfo(res.message || "🎉 Kích hoạt bảo mật 2FA thành công!");
      setIs2FAEnabled(true);
      if (setup2FAData) setSetup2FAData({ ...setup2FAData, is2FAEnabled: true });
      setSetup2FAOtp("");
    } catch (err) {
      setSetup2FAError(err.message || "Xác minh mã OTP thất bại.");
    } finally {
      setSetup2FALoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!disable2FAOtp.trim() || !/^\d{6}$/.test(disable2FAOtp.trim())) {
      setSetup2FAError("Vui lòng nhập đúng mã OTP 6 chữ số từ Google Authenticator để xác nhận tắt 2FA.");
      return;
    }
    setSetup2FALoading(true);
    setSetup2FAError(null);
    try {
      const res = await adminRequest("/disable-2fa", {
        method: "POST",
        body: JSON.stringify({ otpCode: disable2FAOtp.trim() }),
      });
      setTrustedDeviceToken(null);
      SonnerInfo(res.message || "Đã tắt tính năng bảo mật 2FA.");
      setIs2FAEnabled(false);
      if (setup2FAData) setSetup2FAData({ ...setup2FAData, is2FAEnabled: false });
      setDisable2FAConfirmMode(false);
      setDisable2FAOtp("");
    } catch (err) {
      setSetup2FAError(err.message || "Không thể tắt 2FA.");
    } finally {
      setSetup2FALoading(false);
    }
  };

  const handleActionWithSessionCheck = async (actionFn) => {
    try {
      await actionFn();
    } catch (err) {
      if (err?.code === "ADMIN_SESSION_EXPIRED" || err?.code === "FRESH_AUTH_REQUIRED" || err?.status === 401) {
        clearShortAdminSessionToken();
        setPendingCallback(() => actionFn);
        setReauthError("Phiên thao tác nhạy cảm đã hết hạn sau 30 phút. Vui lòng xác minh lại mã PIN bảo mật.");
        navigate('/', { replace: true });
      } else {
        SonnerInfo(`Lỗi thao tác: ${err.message || "Không xác định"}`);
      }
    }
  };

  const openUserMailComposer = (user) => {
    const targetEmail = String(user?.email || "").trim();
    if (!targetEmail) {
      SonnerWarning("Không thể gửi thư", "Tài khoản này chưa có địa chỉ email.");
      return;
    }
    setMailTemplate("apology");
    setMailComposer({ mode: "user", user, email: targetEmail });
  };

  const openGeneralMailComposer = () => {
    const targetEmail = generalApologyEmail.trim().toLowerCase();
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      SonnerWarning("Email không hợp lệ", "Nhập đúng email của người dùng cần gửi thư.");
      return;
    }
    setMailTemplate("apology");
    setMailComposer({ mode: "general", email: targetEmail });
  };

  const handleSendSelectedMail = async () => {
    if (!mailComposer || mailSending) return;
    const targetEmail = String(mailComposer.email || "").trim().toLowerCase();
    if (!targetEmail) return;

    setMailSending(true);
    const fn = async () => {
      const requestId = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      let result;
      if (mailComposer.mode === "user" && mailComposer.user?.uid) {
        result = await adminRequest(`/users/${encodeURIComponent(mailComposer.user.uid)}/apology-email`, {
          method: "POST",
          body: JSON.stringify({ requestId, template: mailTemplate }),
        });
      } else {
        result = await adminRequest("/apology-email", {
          method: "POST",
          body: JSON.stringify({ email: targetEmail, requestId, template: mailTemplate }),
        });
      }

      const templateLabel = ({
        apology: "Xin lỗi khóa nhầm",
        restored: "Xác nhận đã mở khóa",
        warning: "Cảnh báo tài khoản",
        maintenance: "Thông báo bảo trì",
        incident: "Thông báo sự cố",
        welcome: "Chào mừng người dùng",
        feature: "Thông báo tính năng mới",
      })[mailTemplate] || "Thư quản trị";
      SonnerSuccess(
        "✉️ Đã gửi thư",
        `${templateLabel} đã được gửi tới ${result?.email || targetEmail}.`,
      );
      if (mailComposer.mode === "general") setGeneralApologyEmail("");
      setMailComposer(null);
    };

    try {
      await handleActionWithSessionCheck(fn);
    } finally {
      setMailSending(false);
    }
  };

  const executeModalAction = async () => {
    if (!actionModal) return;
    const { type, user, newRole, reason } = actionModal;
    if (!reason?.trim() && type !== "unlock") {
      SonnerInfo("Vui lòng nhập đầy đủ lý do bắt buộc để tiếp tục");
      return;
    }

    if (["lock", "revoke", "role", "nuke"].includes(type)) {
      const safety = window.__adminSafetyConfirmation;
      const expected = String(safety?.target || "").trim();
      const entered = String(safety?.value || "").trim();
      if (!safety || safety.actionType !== type || !expected || entered.toLowerCase() !== expected.toLowerCase()) {
        SonnerWarning("🛡️ Safety Mode chưa xác nhận", `Hãy nhập chính xác ${expected || "đối tượng hiển thị trong khung xác nhận"} trước khi tiếp tục.`);
        return;
      }
    }

    setActionLoading(`${type}-${user.uid}`);
    const fn = async () => {
      if (type === "lock" || type === "unlock") {
        const actionResult = await adminRequest(`/users/${encodeURIComponent(user.uid)}/${type}`, {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        });
        if (actionResult?.undoToken && actionResult?.undoUntil) {
          window.dispatchEvent(new CustomEvent("admin_action_undo_available", { detail: {
            undoToken: actionResult.undoToken,
            undoUntil: actionResult.undoUntil,
            uid: user.uid,
            actionType: type,
            message: actionResult.message || (type === "lock" ? `Đã khóa ${user.email || user.uid}` : `Đã mở khóa ${user.email || user.uid}`),
          } }));
        }
        const nextDisabled = type === "lock";
        const update = (entry) => entry.uid === user.uid
          ? { ...entry, disabled: nextDisabled, accountStatus: nextDisabled ? "locked" : "active" }
          : entry;
        setUsers((current) => current.map(update));
        setSelectedUser((current) => current && current.uid === user.uid ? update(current) : current);
        SonnerInfo(nextDisabled ? "Đã khóa quyền truy cập Huy Locket" : "Đã mở khóa quyền truy cập");
      } else if (type === "revoke") {
        const res = await adminRequest(`/users/${encodeURIComponent(user.uid)}/revoke-sessions`, {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        });
        SonnerInfo(`Đã thu hồi thành công ${res.revokedSessions || "toàn bộ"} phiên làm việc của user`);
        fetchUsers("", { silent: true });
      } else if (type === "role") {
        const roleResult = await adminRequest(`/users/${encodeURIComponent(user.uid)}/role`, {
          method: "POST",
          body: JSON.stringify({ role: newRole, reason: reason.trim() }),
        });
        if (roleResult?.undoToken && roleResult?.undoUntil) {
          window.dispatchEvent(new CustomEvent("admin_action_undo_available", { detail: {
            undoToken: roleResult.undoToken,
            undoUntil: roleResult.undoUntil,
            uid: user.uid,
            actionType: "role",
            message: roleResult.message || `Đã đổi vai trò của ${user.email || user.uid} thành ${newRole}`,
          } }));
        }
        SonnerInfo(`Đã gán thành công vai trò ${newRole.toUpperCase()} cho user`);
        const update = (entry) => entry.uid === user.uid
          ? { ...entry, role: newRole, isAdmin: newRole !== "user" }
          : entry;
        setUsers((current) => current.map(update));
        setSelectedUser((current) => current && current.uid === user.uid ? update(current) : current);
      } else if (type === "nuke") {
        await adminRequest(`/users/${encodeURIComponent(user.uid)}/nuke`, {
          method: "DELETE",
          body: JSON.stringify({ reason: reason.trim() }),
        });
        SonnerInfo(`🔥 Đã Tiêu Hủy (Nuke) vĩnh viễn tài khoản của ${user.email || user.uid} khỏi hệ thống!`);
        setUsers((current) => current.filter((entry) => entry.uid !== user.uid));
        if (selectedUser?.uid === user.uid) setSelectedUser(null);
      }
      setActionModal(null);
    };

    try {
      await handleActionWithSessionCheck(fn);
    } finally {
      setActionLoading(null);
    }
  };


  const handleReauthSubmit = async (event) => {
    event.preventDefault();
    if (!reauthPassword.trim() || !/^\d{4,8}$/.test(reauthPassword.trim())) {
      setReauthError("Vui lòng nhập mã PIN số quản trị (4 - 8 chữ số)");
      return;
    }
    setReauthLoading(true);
    setReauthError(null);
    try {
      await startShortAdminSession(reauthPassword.trim());
      SonnerInfo("Xác minh lại mã PIN thành công. Phiên quản trị gia hạn 30 phút.");
      setReauthModalOpen(false);
      setIsGateUnlocked(true);
      if (pendingCallback) {
        await pendingCallback();
      }
    } catch (err) {
      setReauthError(err.message || "Xác minh mã PIN thất bại. Kiểm tra lại mã PIN của bạn.");
    } finally {
      setReauthPassword("");
      setReauthLoading(false);
      setPendingCallback(null);
    }
  };

  const handleChangePinSubmit = async (e) => {
    e.preventDefault();
    if (!changePinOld.trim() || !changePinNew.trim()) {
      setChangePinError("Vui lòng nhập đầy đủ mã PIN hiện tại và mã PIN mới.");
      return;
    }
    if (!/^\d{4,8}$/.test(changePinNew.trim())) {
      setChangePinError("Mã PIN mới phải là dãy số gồm từ 4 đến 8 chữ số.");
      return;
    }
    setChangePinLoading(true);
    setChangePinError(null);
    try {
      await changeAdminPin(changePinOld.trim(), changePinNew.trim());
      SonnerInfo("✨ Đổi mã PIN số Bảo Mật Quản Trị thành công!");
      setChangePinModalOpen(false);
      setChangePinOld("");
      setChangePinNew("");
    } catch (err) {
      setChangePinError(err.message || "Đổi mã PIN thất bại. Vui lòng kiểm tra lại mã PIN hiện tại.");
    } finally {
      setChangePinLoading(false);
    }
  };

  const handleResolveReport = async (id, actionTaken) => {
    const fn = async () => {
      await adminRequest(`/content/reports/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ actionTaken }),
      });
      SonnerInfo(`Đã xử lý vi phạm: ${actionTaken}`);
      fetchReports();
    };
    await handleActionWithSessionCheck(fn);
  };

  const handlePurgeBots = async () => {
    if (!window.confirm("⚡ Bạn có chắc muốn TIÊU DIỆT và KHÓA VĨNH VIỄN toàn bộ các tài khoản Bot rác, nick clone dùng tool hoặc máy chủ VPS bất thường không?")) {
      return;
    }
    const fn = async () => {
      setPurgingBots(true);
      try {
        const res = await adminRequest("/users/purge-bots", {
          method: "POST",
        });
        SonnerInfo(`🔥 Càn quét hoàn tất! Đã tiêu diệt và khóa vĩnh viễn ${res?.count || 0} tài khoản Bot rác & Clone bất thường.`);
        fetchUsers("", { silent: true });
      } finally {
        setPurgingBots(false);
      }
    };
    await handleActionWithSessionCheck(fn);
  };

  if (checkingAdmin || !isAdmin) {
    return <AdminRouteLoading />;
  }

  if (!isGateUnlocked) {
    return (
      <>
        <AdminSecurityHandoff active={gateVerified} />
        <AdminSecurityGate
          currentEmail={currentEmail}
          currentRole={currentRole}
          hasPin={hasPin}
          error={gateError}
          loading={gateLoading}
          verified={gateVerified}
          pin={gatePassword}
          onPinChange={setGatePassword}
          onPinSubmit={handleGateSubmit}
          otpToken={gate2FATempToken}
          otp={gate2FAOtp}
          onOtpChange={setGate2FAOtp}
          rememberDevice={gate2FARememberDevice}
          onRememberDeviceChange={setGate2FARememberDevice}
          onOtpSubmit={handleGate2FASubmit}
          onOtpBack={() => {
            setGate2FATempToken(null);
            setGatePassword("");
            setGate2FAOtp("");
            setGateError(null);
          }}
          onLeave={() => navigate("/locket", { replace: true })}
        />
      </>
    );
  }

  return (
    <>
      <AdminSecurityHandoff active={gateVerified} />
      <AdminMailComposer
        open={Boolean(mailComposer)}
        email={mailComposer?.email || ""}
        template={mailTemplate}
        sending={mailSending}
        onTemplateChange={setMailTemplate}
        onClose={() => setMailComposer(null)}
        onSend={handleSendSelectedMail}
      />
      <div className="admin-dashboard-enter min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/60 text-slate-800 p-3 sm:p-6 pt-24 max-w-7xl mx-auto pb-20 selection:bg-indigo-600 selection:text-white">
      {/* SUPREME COMMAND CENTER HERO HEADER */}
      <div className="bg-gradient-to-r from-white via-slate-50 to-indigo-50/80 text-slate-800 rounded-[2.5rem] p-6 sm:p-8 shadow-[0_15px_50px_-10px_rgba(30,41,59,0.08)] border border-slate-200/80 mb-8 relative overflow-hidden backdrop-blur-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-400/10 rounded-full blur-[100px] pointer-events-none -mt-20 -mr-20" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-400/10 rounded-full blur-[100px] pointer-events-none -mb-20 -ml-20" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-black uppercase tracking-wider shadow-sm">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-600" />
              </span>
              <span>SUPREME INFRASTRUCTURE & USER COMMAND CENTER</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black flex items-center gap-3 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-950 via-slate-900 to-blue-950">
              <span className="p-2 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white shadow-md text-2xl sm:text-3xl shrink-0 flex items-center justify-center">
                🛡️
              </span>
              <span>Trạm Quản Trị Hệ Thống Huy Locket</span>
            </h1>
            <p className="text-sm text-slate-600 font-medium flex flex-wrap items-center gap-2 pt-1">
              <span>Quyền lực của bạn:</span> {roleBadge(currentRole)} 
              <span className="text-slate-400 font-bold">•</span>
              <span className="inline-flex items-center gap-1 font-mono text-emerald-700 font-black bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-200/80">
                👥 {totalUsers} tài khoản được rà soát Live
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenSetup2FA}
              className={`btn btn-sm sm:btn-md ${is2FAEnabled ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 shadow-[0_5px_15px_-3px_rgba(245,158,11,0.4)]"} font-black rounded-2xl h-11 px-4 shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95`}
              title="Cài đặt xác thực 2 yếu tố Google Authenticator cho Quản Trị Viên"
            >
              <Shield size={16} className={is2FAEnabled ? "text-emerald-600" : "text-amber-100"} /> 
              <span>{is2FAEnabled ? "🛡️ 2FA: Đã Bật (Google Auth)" : "🔐 Bật 2FA (Google Auth)"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setChangePinOld("");
                setChangePinNew("");
                setChangePinError(null);
                setChangePinModalOpen(true);
              }}
              className="btn btn-sm sm:btn-md bg-white hover:bg-slate-50 text-indigo-700 border border-slate-200 hover:border-indigo-300 font-bold rounded-2xl h-11 px-4 shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95"
              title="Tự động thay đổi mã PIN Bảo Mật số cho Quản trị viên"
            >
              <Key size={16} className="text-indigo-600" /> 
              <span>Đổi Mã PIN Quản Trị</span>
            </button>
            <button
              type="button"
              onClick={() => {
                clearShortAdminSessionToken();
                navigate('/', { replace: true });
                SonnerInfo("Đã khóa trang Quản Trị. Vui lòng nhập mã PIN bảo mật khi truy cập lại.");
              }}
              className="btn btn-sm sm:btn-md bg-gradient-to-r from-rose-600 via-red-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-extrabold border-0 rounded-2xl h-11 px-5 shadow-[0_10px_20px_-5px_rgba(225,29,72,0.4)] transition-all flex items-center gap-2 cursor-pointer active:scale-95"
              title="Khóa ngay phiên làm việc admin hiện tại"
            >
              <Lock size={16} /> 
              <span>Khóa Trạm Admin</span>
            </button>
          </div>
        </div>
      </div>

      {/* TABS HEADER - SLEEK QUANTUM SWITCH DOCK */}
      <div className="flex flex-wrap items-center gap-2 mb-8 bg-white/90 p-2 sm:p-2.5 rounded-3xl shadow-[0_10px_35px_-5px_rgba(30,41,59,0.07)] border border-slate-200/80 backdrop-blur-xl w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl font-black text-sm transition-all duration-300 cursor-pointer ${
            activeTab === "users" 
              ? "bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 text-white shadow-lg shadow-indigo-500/20 scale-[1.02] border-0" 
              : "bg-indigo-50/90 text-indigo-900 hover:bg-indigo-100 border border-indigo-200 shadow-sm"
          }`}
        >
          <Users size={18} className={activeTab === "users" ? "text-indigo-200 animate-pulse" : "text-indigo-600"} /> 
          <span>Người dùng & Phân quyền ({totalUsers})</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab("user_actions"); fetchUserActions(); }}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl font-black text-sm transition-all duration-300 cursor-pointer ${
            activeTab === "user_actions" 
              ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-lg shadow-teal-500/20 scale-[1.02] border-0" 
              : "bg-teal-50/90 text-teal-900 hover:bg-teal-100 border border-teal-200 shadow-sm"
          }`}
        >
          <Activity size={18} className={activeTab === "user_actions" ? "text-teal-200 animate-pulse" : "text-teal-600"} /> 
          <span>Giám Sát Hành Vi Web (Realtime)</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab("security_threats"); fetchSecurityThreats(); }}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl font-black text-sm transition-all duration-300 cursor-pointer ${
            activeTab === "security_threats" 
              ? "bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white shadow-lg shadow-red-500/20 scale-[1.02] border-0" 
              : "bg-red-50/90 text-red-950 hover:bg-red-100 border border-red-200 shadow-sm font-bold"
          }`}
        >
          <ShieldAlert size={18} className={activeTab === "security_threats" ? "text-amber-200 animate-bounce" : "text-red-600"} /> 
          <span>Phát hiện Tấn công Web (WAF)</span>
        </button>

        {(currentRole === "super_admin" || currentRole === "admin") && (
          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl font-black text-sm transition-all duration-300 cursor-pointer ${
              activeTab === "audit" 
                ? "bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 text-white shadow-lg shadow-purple-500/20 scale-[1.02] border-0" 
                : "bg-purple-50/90 text-purple-900 hover:bg-purple-100 border border-purple-200 shadow-sm"
            }`}
          >
            <FileText size={18} className={activeTab === "audit" ? "text-purple-200 animate-pulse" : "text-purple-600"} /> 
            <span>Nhật ký Quản trị (Audit Log)</span>
          </button>
        )}

        {currentRole !== "support" && (
          <button
            type="button"
            onClick={() => setActiveTab("reports")}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl font-black text-sm transition-all duration-300 cursor-pointer ${
              activeTab === "reports" 
                ? "bg-gradient-to-r from-rose-600 via-amber-600 to-orange-600 text-white shadow-lg shadow-rose-500/20 scale-[1.02] border-0" 
                : "bg-rose-50/90 text-rose-900 hover:bg-rose-100 border border-rose-200 shadow-sm"
            }`}
          >
            <Shield size={18} className={activeTab === "reports" ? "text-amber-200 animate-pulse" : "text-rose-600"} /> 
            <span>Quản lý Nội dung vi phạm</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab("health")}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl font-black text-sm transition-all duration-300 cursor-pointer ${
            activeTab === "health" 
              ? "bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 text-white shadow-lg shadow-sky-500/20 scale-[1.02] border-0" 
              : "bg-sky-50/90 text-sky-950 hover:bg-sky-100 border border-sky-200 shadow-sm font-bold"
          }`}
        >
          <Activity size={18} className={activeTab === "health" ? "text-sky-200 animate-pulse" : "text-sky-600"} /> 
          <span>🩺 Kiểm Tra Tình Trạng Web (Health)</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab("advanced"); fetchAdvancedData(); }}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl font-black text-sm transition-all duration-300 cursor-pointer ${
            activeTab === "advanced" 
              ? "bg-gradient-to-r from-amber-500 via-orange-500 to-red-600 text-white shadow-lg shadow-orange-500/20 scale-[1.02] border-0" 
              : "bg-amber-50/80 text-amber-800 hover:bg-amber-100/90 border border-amber-200/80"
          }`}
        >
          <Zap size={18} className="text-amber-500 animate-bounce fill-amber-500" /> 
          <span>🚀 Quyền Lực Tối Thượng</span>
        </button>
      </div>

      {/* TAB SYSTEM HEALTH */}
      {activeTab === "health" && (
        <div className="animate-fade-in">
          <AdminSystemHealth />
        </div>
      )}

      {/* TAB 1: USERS AND RBAC */}
      {activeTab === "users" && (
        <div className="space-y-10 animate-fade-in">
          {/* RADAR SURVEILLANCE BAR */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/95 p-4 sm:p-5 rounded-3xl border border-slate-200/80 shadow-md backdrop-blur-xl">
            <div className="flex items-start gap-3.5 max-w-3xl text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0 shadow-sm mt-0.5">
                <Info size={20} className="animate-pulse" />
              </div>
              <div>
                <strong className="text-indigo-900 font-extrabold uppercase tracking-wide text-xs block mb-0.5">Radar Trinh Sát Vị Trí (GPS & IP):</strong>
                Vị trí hiển thị kết hợp giữa <strong className="text-slate-900">Vị trí IP máy chủ</strong> và <strong className="text-emerald-700 font-bold">Tọa độ GPS thực tế</strong> của thiết bị (hệ thống tự động xin quyền truy cập vị trí khi người dùng vào web, nếu được cho phép sẽ ghi lại tọa độ chính xác từng mét).
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
              <div className="relative flex-1 md:w-72">
                <input 
                  type="text" 
                  placeholder="Tìm kiếm email, tên, UID..." 
                  className="input w-full pl-10 rounded-2xl h-11 text-sm bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-200 focus:border-indigo-600 focus:bg-white font-medium shadow-inner transition-colors" 
                  value={search} 
                  onChange={(e) => setSearch(e.target.value)} 
                />
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
              <button
                type="button"
                onClick={() => {
                  fetchUsers();
                  SonnerSuccess("🔄 Đã tải lại dữ liệu!", "Bảng quản trị đã cập nhật tọa độ GPS và thông tin IP mới nhất.");
                }}
                disabled={loading}
                className="btn bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-black rounded-2xl px-5 h-11 border border-indigo-200 shadow-sm transition-all flex items-center gap-2 shrink-0 active:scale-95 text-xs sm:text-sm cursor-pointer"
                title="Làm mới toàn bộ danh sách và tọa độ thực tế mà không cần reload trang"
              >
                {loading ? <span className="loading loading-spinner loading-xs" /> : <><span>🔄 Làm mới</span></>}
              </button>
            </div>
          </div>

          {(currentRole === "super_admin" || currentRole === "admin") && (
            <div className="bg-white/95 p-4 sm:p-5 rounded-3xl border border-violet-200/80 shadow-md">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-wider text-violet-700">✉️ Gửi thư chung</div>
                  <div className="text-sm font-bold text-slate-900 mt-1">Nhập email người dùng rồi chọn mẫu thư cần gửi</div>
                  <div className="text-xs text-slate-500 mt-1">Bạn có thể chọn thư Xin lỗi khóa nhầm hoặc Xác nhận đã mở khóa trước khi gửi.</div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto lg:min-w-[520px]">
                  <input
                    type="email"
                    value={generalApologyEmail}
                    onChange={(event) => setGeneralApologyEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openGeneralMailComposer();
                    }}
                    placeholder="Nhập email người dùng..."
                    className="input input-bordered flex-1 h-11 rounded-2xl bg-slate-50 border-slate-200 focus:border-violet-500 text-sm font-medium"
                    disabled={mailSending}
                  />
                  <button
                    type="button"
                    onClick={openGeneralMailComposer}
                    disabled={!generalApologyEmail.trim()}
                    className="btn h-11 px-5 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white border-0 font-black shadow-sm disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    <span>✉️ Chọn thư</span>
                  </button>
                </div>
              </div>

              <div className="relative z-10 grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
                <div className="bg-slate-900/90 border border-orange-500/30 rounded-3xl p-5 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-orange-400">MONTHLY USAGE · RENDER</div>
                      <h3 className="text-lg font-black text-white">Hạn mức Canh Slot</h3>
                    </div>
                    <a href={serverHealth?.platformUsage?.render?.billingUrl || "https://dashboard.render.com/billing"} target="_blank" rel="noreferrer" className="btn btn-sm bg-orange-950 text-orange-200 border-orange-500/40 rounded-xl">
                      Mở Billing ↗
                    </a>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                      <span className="text-slate-400 block mb-1">Free instance hours</span>
                      <strong className="text-orange-300 text-base">750 giờ / tháng</strong>
                      <span className="text-slate-500 block mt-1">Đã dùng: Render chỉ hiển thị trong Billing</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                      <span className="text-slate-400 block mb-1">Pipeline build</span>
                      <strong className="text-orange-300 text-base">500 phút / tháng</strong>
                      <span className="text-slate-500 block mt-1">Đã dùng: không có API công khai</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                      <span className="text-slate-400 block mb-1">Bandwidth tháng này</span>
                      <strong className="text-emerald-300 text-base">{formatPlatformMetric(serverHealth?.platformUsage?.render?.metrics?.bandwidthMonth)}</strong>
                      <span className="text-slate-500 block mt-1">CPU: {formatPlatformMetric(serverHealth?.platformUsage?.render?.metrics?.cpuLatest)} · RAM: {formatPlatformMetric(serverHealth?.platformUsage?.render?.metrics?.memoryLatest)}</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                      <span className="text-slate-400 block mb-1">Service API</span>
                      <strong className="text-white text-base">{serverHealth?.platformUsage?.render?.service?.plan || "Chưa kết nối"}</strong>
                      <span className="text-slate-500 block mt-1">{serverHealth?.platformUsage?.render?.service?.region || serverHealth?.platformUsage?.render?.error || "Cần RENDER_API_KEY"}</span>
                    </div>
                  </div>
                  {!serverHealth?.platformUsage?.render?.configured && (
                    <div className="mt-3 p-3 rounded-xl bg-amber-950/50 border border-amber-500/30 text-amber-200 text-xs font-semibold">
                      Thêm secret <code>RENDER_API_KEY</code> vào project <code>huy-locket-api</code> để bật bandwidth, CPU, RAM và thông tin plan thật. Token không được gửi về trình duyệt.
                    </div>
                  )}
                </div>

                <div className="bg-slate-900/90 border border-indigo-500/30 rounded-3xl p-5 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-indigo-400">MONTHLY USAGE · VERCEL</div>
                      <h3 className="text-lg font-black text-white">Hạn mức Web & API</h3>
                    </div>
                    <a href={serverHealth?.platformUsage?.vercel?.usageUrl || "https://vercel.com/huy-locket/~/usage"} target="_blank" rel="noreferrer" className="btn btn-sm bg-indigo-950 text-indigo-200 border-indigo-500/40 rounded-xl">
                      Mở Usage ↗
                    </a>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                      <span className="text-slate-400 block mb-1">Gói hiện tại</span>
                      <strong className="text-indigo-300 text-base">{serverHealth?.platformUsage?.vercel?.plan || "Hobby"}</strong>
                      <span className="text-slate-500 block mt-1">Web và API dùng hai project cùng team</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                      <span className="text-slate-400 block mb-1">Chi phí tháng này</span>
                      <strong className="text-white text-base">
                        {serverHealth?.platformUsage?.vercel?.billing
                          ? `${serverHealth.platformUsage.vercel.billing.effectiveCost.toFixed(2)} ${serverHealth.platformUsage.vercel.billing.currency}`
                          : "Không khả dụng trên Hobby"}
                      </strong>
                      <span className="text-slate-500 block mt-1">Billing API chỉ mở cho Pro/Enterprise</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 sm:col-span-2">
                      <span className="text-slate-400 block mb-1">Bandwidth · Function usage · Build usage</span>
                      <strong className="text-amber-300 text-sm">Xem số chính thức trong Vercel Usage Dashboard</strong>
                      <span className="text-slate-500 block mt-1">Không dùng endpoint nội bộ hoặc ước lượng để tránh hiển thị sai hạn mức.</span>
                    </div>
                  </div>
                  <div className="mt-3 p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-indigo-200 text-xs font-semibold">
                    {serverHealth?.platformUsage?.vercel?.error || "Đã kết nối Vercel Billing API."}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION A: BAN QUẢN TRỊ HUY LOCKET */}
          <div>
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-200/80">
              <h2 className="text-xl sm:text-2xl font-black flex items-center gap-3 tracking-tight text-slate-900">
                <span className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center text-xl shadow-sm">
                  👑
                </span>
                <span>Ban Quản trị Huy Locket</span>
                <span className="badge bg-gradient-to-r from-amber-500 to-indigo-600 text-white font-black text-xs px-3 py-3 rounded-xl shadow-md border-0">
                  {adminTeam.length} Admin
                </span>
              </h2>
              <span className="text-xs font-bold text-slate-500 hidden sm:block">QUYỀN ĐIỀU HÀNH BẢO MẬT</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {adminTeam.map((admin) => {
                const latestLogin = admin.latestLoginData || admin;
                const locationElement = renderUserLocation(admin, latestLogin);
                const isSuperAdmin = admin.role === "super_admin" || admin.email?.toLowerCase() === "buiduchuy2010qn@gmail.com";
                const isSelf = admin.uid === currentUserUid;

                return (
                  <ScrollReveal
                    key={admin.uid}
                    delay={(adminTeam.indexOf(admin) % 3) * 0.1}
                    className="bg-white/95 border-2 border-slate-200/80 hover:border-indigo-400 rounded-[2.2rem] p-6 shadow-[0_10px_35px_-10px_rgba(30,41,59,0.07)] hover:shadow-[0_20px_45px_-10px_rgba(79,46,229,0.15)] transition-all duration-300 relative overflow-hidden flex flex-col justify-between group"
                  >
                    <div className="absolute top-0 right-0 -mr-16 -mt-16 w-36 h-36 bg-gradient-to-bl from-blue-500/10 via-indigo-500/10 to-transparent rounded-full blur-2xl pointer-events-none group-hover:scale-150 transition-transform duration-500" />

                    <div>
                      <div className="flex items-start justify-between gap-3 relative z-10">
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 via-indigo-600 to-blue-500 p-0.5 shadow-md shrink-0">
                            <div className="w-full h-full bg-white rounded-[0.9rem] flex items-center justify-center font-black text-2xl">
                              {isSuperAdmin ? "👑" : "🛡️"}
                            </div>
                          </div>
                          <div className="overflow-hidden">
                            <div className="font-black text-base sm:text-lg text-slate-900 flex items-center gap-2 flex-wrap truncate">
                              <span>{userName(admin)}</span>
                              <div className="scale-90 origin-left">{roleBadge(admin.role)}</div>
                            </div>
                            <div className="text-xs font-mono font-semibold text-slate-500 mt-1 truncate" title={admin.email || admin.username || admin.uid}>
                              {admin.email || admin.username || admin.uid}
                            </div>
                          </div>
                        </div>
                        <button 
                          type="button" 
                          className="btn btn-sm bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-xl px-2.5 h-9 shrink-0 transition-colors" 
                          onClick={() => openUser(admin)} 
                          title="Xem chi tiết & lịch sử đăng nhập thực"
                        >
                          <Info size={18} />
                        </button>
                      </div>

                      <div className="mt-6 pt-4 border-t border-slate-100 space-y-3 relative z-10 text-xs font-semibold text-slate-600">
                        <div className="flex items-center justify-between bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200/80">
                          <span className="text-slate-500">Trạng thái kết nối:</span>
                          {isOnline(admin) ? (
                            <span className="text-emerald-600 font-black flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                              <span>Đang hoạt động ({admin.activeSessions} phiên)</span>
                            </span>
                          ) : (
                            <span className="text-slate-500 font-bold">{relativeActivity(admin.lastSeenAt)}</span>
                          )}
                        </div>

                        <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80 shadow-inner space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-indigo-900 font-black text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                              <span>📍</span>
                              <span>Vị trí (GPS & IP):</span>
                            </span>
                            {isSelf && !admin.gps_coordinates && !latestLogin?.gps_coordinates && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const gps = await updateAndSyncGpsLocation(true);
                                    if (gps) {
                                      SonnerSuccess("🎉 Đã lấy tọa độ GPS thực tế!", `Tọa độ thiết bị: ${gps}. Đang đồng bộ về Bảng Quản trị...`);
                                      setTimeout(() => window.location.reload(), 1500);
                                    } else {
                                      SonnerWarning("Chưa cấp quyền GPS", "Hãy bấm biểu tượng bên trái thanh địa chỉ URL (quyền trang web) -> chọn Vị trí (Location) -> Cho phép, rồi quay lại bấm nút này!");
                                    }
                                  } catch (err) {
                                    SonnerWarning("Lỗi định vị", "Vui lòng bật quyền vị trí trên trình duyệt Chrome.");
                                  }
                                }}
                                className="btn btn-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black px-3 h-7 text-[11px] rounded-xl shadow-sm border-0 shrink-0 cursor-pointer"
                                title="Bấm để lấy tọa độ GPS chính xác từ thiết bị, thay thế cho vị trí IP của cổng trạm nhà mạng"
                              >
                                📍 Lấy GPS thật
                              </button>
                            )}
                          </div>
                          <div className="font-bold text-slate-800 bg-white py-2 px-3 rounded-xl border border-slate-200/80 flex items-center justify-between w-full shadow-sm text-xs leading-relaxed">
                            {locationElement}
                          </div>
                        </div>

                        <div className="flex items-center justify-between bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200/80 font-mono text-[11px]">
                          <span className="text-slate-500 font-sans">Nguồn / Thiết bị:</span>
                          <span className="text-indigo-700 font-black truncate max-w-[180px]">
                            {sourceLabel(admin.webSource)} · {latestLogin?.browser || "—"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Administrative buttons or Immutable Shield inside Admin card */}
                    <div className="mt-6 pt-4 flex items-center justify-end gap-2 border-t border-slate-100 relative z-10">
                      {isSuperAdmin ? (
                        <div className="w-full bg-gradient-to-r from-amber-50 via-indigo-50 to-purple-50 border border-amber-200/80 text-amber-800 font-black text-[11px] py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-inner uppercase tracking-wider">
                          <Lock size={14} className="text-amber-600 shrink-0" />
                          <span>Quyền Tối Thượng Cố Định (Immutable)</span>
                        </div>
                      ) : isSelf ? (
                        <div className="w-full bg-indigo-50 border border-indigo-200 text-indigo-800 font-extrabold text-[11px] py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-inner uppercase tracking-wider">
                          <span>👤 Tài khoản chính bạn (Protected)</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 w-full justify-end">
                          {currentRole === "super_admin" && (
                            <button
                              type="button"
                              onClick={() => setActionModal({ type: "role", user: admin, newRole: admin.role || "user", reason: "" })}
                              className="btn btn-xs bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-200 font-black rounded-xl px-3.5 h-8 transition-all"
                            >
                              Đổi vai trò
                            </button>
                          )}
                          {currentRole !== "support" && currentRole !== "moderator" && (
                            <button
                              type="button"
                              onClick={() => setActionModal({ type: "revoke", user: admin, reason: "" })}
                              className="btn btn-xs bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 font-black rounded-xl px-3.5 h-8 transition-all"
                            >
                              Thu hồi phiên
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </ScrollReveal>
                );
              })}
            </div>
          </div>

          {/* SECTION B: NGƯỜI DÙNG LOCKET WEB */}
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 text-xl font-bold shadow-sm">
                  👥
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-black flex items-center gap-2 tracking-tight text-slate-900">
                    <span>Người dùng Locket Web</span>
                    <span className="badge bg-indigo-50 text-indigo-700 border border-indigo-200 font-black text-xs px-3 py-3 rounded-xl shadow-sm">
                      {normalUsers.length} Tài Khoản
                    </span>
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    fetchUsers();
                    SonnerSuccess("🔄 Đã tải lại!", "Danh sách người dùng và tọa độ đã được cập nhật.");
                  }}
                  disabled={loading}
                  className="btn btn-sm bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl font-bold px-4 h-10 text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                  title="Tải lại ngay danh sách người dùng Locket Web"
                >
                  {loading ? <span className="loading loading-spinner loading-xs" /> : <span>🔄 Làm mới</span>}
                </button>
                <button
                  type="button"
                  onClick={handlePurgeBots}
                  disabled={purgingBots}
                  className="btn btn-sm bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-black border-0 rounded-xl px-5 h-10 shadow-[0_10px_20px_-5px_rgba(244,63,94,0.3)] transition-all flex items-center gap-2 cursor-pointer active:scale-95 text-xs sm:text-sm"
                >
                  {purgingBots ? (
                    <>
                      <span className="loading loading-spinner loading-xs text-white" />
                      <span>Đang càn quét...</span>
                    </>
                  ) : (
                    <>
                      <Zap size={16} className="animate-bounce text-yellow-300 fill-yellow-300" />
                      <span>⚡ Càn Quét Bot Rác</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* CRYSTALLINE OBSERVABILITY TABLE */}
            <div className="bg-white/95 rounded-[2.2rem] shadow-[0_15px_45px_-10px_rgba(30,41,59,0.08)] border border-slate-200/80 overflow-hidden backdrop-blur-2xl">
              <div className="overflow-x-auto">
                <table className="table w-full text-sm font-medium">
                  <thead>
                    <tr className="bg-slate-50/90 text-indigo-950 font-extrabold text-xs uppercase tracking-wider border-b border-slate-200/80">
                      <th className="py-4 pl-6">Người dùng & Vai trò</th>
                      <th>Đăng nhập gần nhất</th>
                      <th>IP / Vị trí (GPS & IP)</th>
                      <th>Trình duyệt / Thiết bị</th>
                      <th>Trạng thái web</th>
                      <th>Hoạt động gần nhất</th>
                      <th>Nguồn web</th>
                      <th className="text-right pr-6">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {loading && users.length === 0 ? (
                      <tr><td colSpan="8" className="text-center py-20"><span className="loading loading-bars loading-lg text-indigo-600" /></td></tr>
                    ) : error ? (
                      <tr><td colSpan="8" className="text-center py-16"><AlertTriangle size={36} className="mx-auto text-rose-500 mb-2 animate-bounce" /><p className="text-rose-600 font-bold">{error.message}</p><button type="button" onClick={() => fetchUsers()} className="btn btn-sm btn-outline mt-4 rounded-xl font-bold"><RefreshCw size={14} /> Thử lại ngay</button></td></tr>
                    ) : normalUsers.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="text-center py-20 text-slate-500">
                          <div className="max-w-md mx-auto space-y-3 py-6">
                            <div className="text-5xl">📭</div>
                            <p className="text-lg font-black text-slate-800">Chưa ghi nhận người dùng Locket Web nào</p>
                            <p className="text-xs text-slate-500 leading-relaxed font-semibold">Hệ thống Giám sát Real-time đang rình gác. Ngay khi có người dùng đăng nhập, hồ sơ thật và lịch sử tọa độ sẽ xuất hiện tức thời tại đây.</p>
                          </div>
                        </td>
                      </tr>
                    ) : normalUsers.map((user) => {
                      const latestLogin = user.latestLoginData || user;
                      const locationElement = renderUserLocation(user, latestLogin);
                      const isSuperAdmin = user.role === "super_admin" || user.email?.toLowerCase() === "buiduchuy2010qn@gmail.com";
                      const isSelf = user.uid === currentUserUid;

                      return (
                        <ScrollReveal 
                          key={user.uid} 
                          as="tr"
                          delay={(normalUsers.indexOf(user) % 10) * 0.05}
                          className="hover:bg-indigo-50/40 transition-colors group"
                        >
                          <td className="py-4 pl-6">
                            <div className="font-black text-sm flex items-center gap-2 text-slate-900">
                              <span>{userName(user)}</span>
                              <div className="scale-90 origin-left">{roleBadge(user.role)}</div>
                            </div>
                            <div className="text-xs text-slate-500 font-mono mt-1 flex items-center gap-2 flex-wrap">
                              <span>{user.email || user.uid}</span>
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-indigo-700 font-bold text-[10px] font-mono border border-slate-200 shadow-sm" title={`Raw UID: ${user.uid}`}>
                                {getFixedNumericUid(user.uid)}
                              </span>
                            </div>
                          </td>
                          <td className="min-w-36">
                            {latestLogin ? (
                              <div className="space-y-1">
                                <div className="text-xs font-bold text-slate-700">{formatDateTime(latestLogin.created_at)}</div>
                                <span className="inline-block px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-[11px] font-mono font-bold border border-purple-200/80">
                                  {loginMethodLabel(latestLogin.login_method || user.loginMethod || user.provider)}
                                </span>
                              </div>
                            ) : <span className="text-xs text-slate-400 italic">Chưa ghi nhận</span>}
                          </td>
                          <td className="min-w-48">
                            <div className="font-mono font-extrabold text-xs text-indigo-700 flex items-center gap-1.5">
                              <span>🌐</span>
                              <span>{latestLogin?.ip_address || UNKNOWN}</span>
                            </div>
                            <div className="mt-1.5 text-xs text-slate-600 font-medium">{locationElement}</div>
                          </td>
                          <td className="min-w-48">
                            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                              <Monitor size={14} className="text-emerald-600 shrink-0" /> 
                              <span>{latestLogin?.browser || UNKNOWN} {latestLogin?.browser_version !== UNKNOWN ? latestLogin?.browser_version : ""}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 font-semibold">{latestLogin ? `${latestLogin.os || UNKNOWN} · ${latestLogin.device || UNKNOWN}` : UNKNOWN}</div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">Build: {latestLogin?.commit_hash || latestLogin?.build_id || "—"}</div>
                          </td>
                          <td>
                            {user.disabled ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-black shadow-sm">
                                <Lock size={13} /> Đã khóa
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-black shadow-sm">
                                <Unlock size={13} /> Hoạt động
                              </span>
                            )}
                          </td>
                          <td>
                            {isOnline(user) ? (
                              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-black shadow-sm">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                                <span>Online ({user.activeSessions} phiên)</span>
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-slate-500">
                                {user.lastLogoutAt && new Date(user.lastLogoutAt) >= new Date(user.lastSeenAt || 0) ? "⚪ Đã đăng xuất" : relativeActivity(user.lastSeenAt)}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className="whitespace-nowrap px-2.5 py-1 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold font-mono shadow-sm">
                              {sourceLabel(latestLogin?.web_source || user.webSource)}
                            </span>
                          </td>
                          <td className="text-right pr-6 min-w-[350px] whitespace-nowrap">
                            <div
                              role="region"
                              aria-label="Danh sách thao tác tài khoản"
                              tabIndex={0}
                              className="w-full max-w-[88vw] overflow-x-auto overscroll-x-contain touch-pan-x pb-1 [scrollbar-width:thin]"
                            >
                              <div className="flex w-max min-w-full items-center justify-end gap-1.5 flex-nowrap">
                              {isSuperAdmin ? (
                                <span className="px-2.5 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-black uppercase select-none">
                                  🔒 Cố định
                                </span>
                              ) : isSelf ? (
                                <span className="px-2.5 py-1 rounded-xl bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-bold select-none">
                                  👤 Chính bạn
                                </span>
                              ) : (
                                <>
                                  {currentRole !== "support" && currentRole !== "moderator" && (
                                    <>
                                      <button
                                        type="button"
                                        className={`btn btn-xs rounded-xl font-extrabold h-8 px-3 transition-all ${user.disabled ? "bg-emerald-50 hover:bg-emerald-500 text-emerald-700 hover:text-white border border-emerald-200" : "bg-amber-50 hover:bg-amber-500 text-amber-800 hover:text-white border border-amber-200"}`}
                                        onClick={() => setActionModal({ type: user.disabled ? "unlock" : "lock", user, reason: "" })}
                                        title={user.disabled ? "Mở khóa web" : "Khóa truy cập web"}
                                      >
                                        {user.disabled ? <Unlock size={14} /> : <Lock size={14} />}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={user.disabled || !user.email}
                                        className={`btn btn-xs rounded-xl font-extrabold h-8 px-2.5 shrink-0 transition-all ${user.disabled || !user.email ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed" : "bg-violet-50 hover:bg-violet-600 text-violet-700 hover:text-white border border-violet-200"}`}
                                        onClick={() => openUserMailComposer(user)}
                                        title={user.disabled ? "Mở khóa tài khoản trước khi gửi thư" : user.email ? `Chọn thư gửi tới ${user.email}` : "Tài khoản chưa có email"}
                                      >
                                        <span>✉️ Gửi thư</span>
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-xs bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 rounded-xl font-extrabold h-8 px-3 transition-all"
                                        onClick={() => setActionModal({ type: "revoke", user, reason: "" })}
                                        title="Thu hồi toàn bộ phiên làm việc web"
                                      >
                                        Thu hồi
                                      </button>
                                    </>
                                  )}
                                  {currentRole === "super_admin" && (
                                    <button
                                      type="button"
                                      className="btn btn-xs bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-200 rounded-xl font-black h-8 px-3 transition-all"
                                      onClick={() => setActionModal({ type: "role", user, newRole: user.role || "user", reason: "" })}
                                      title="Gán quyền RBAC"
                                    >
                                      RBAC
                                    </button>
                                  )}
                                </>
                              )}
                              <button 
                                type="button" 
                                className="btn btn-sm bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-xl px-2.5 h-8 transition-colors" 
                                onClick={() => openUser(user)} 
                                title="Xem trọn bộ lịch sử đăng nhập thực"
                              >
                                <Info size={18} />
                              </button>
                              </div>
                            </div>
                          </td>
                        </ScrollReveal>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {!loading && !error && (
              <p className="mt-4 text-xs text-slate-500 text-center font-bold font-mono">
                ⚡ Đang hiển thị <strong className="text-indigo-700 font-black">{users.length}/{totalUsers}</strong> người dùng Locket Web
              </p>
            )}

            {!loading && !error && pageToken && !search.trim() && (
              <div className="mt-6 flex justify-center">
                <button type="button" className="btn bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-200 rounded-2xl px-8 h-12 font-black shadow-md transition-all active:scale-95 cursor-pointer" onClick={() => fetchUsers(pageToken)}>
                  🔄 Tải thêm danh sách
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: USER ACTIONS MONITORING (Giám Sát Hành Vi Web Realtime) */}
      {activeTab === "user_actions" && (
        <div className="bg-white/95 text-slate-800 rounded-[2.5rem] shadow-[0_15px_50px_-10px_rgba(30,41,59,0.08)] border border-slate-200/80 p-6 sm:p-9 animate-fade-in relative overflow-hidden backdrop-blur-2xl">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-teal-400/10 rounded-full blur-[130px] pointer-events-none -mt-32 -mr-32" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-emerald-400/10 rounded-full blur-[120px] pointer-events-none -mb-32 -ml-32" />
          
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-200/80">
            <div>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-xs font-black mb-3 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-teal-500 animate-ping" />
                <span>🌐 REALTIME WEB BEHAVIOR RADAR (100% DỮ LIỆU THẬT)</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-teal-950 via-slate-900 to-emerald-900 flex items-center gap-2.5">
                Giám Sát Hành Vi Người Dùng Trực Tuyến
              </h2>
              <p className="text-sm text-slate-600 font-medium mt-1">
                Tường thuật thời gian thực mọi thao tác trên ứng dụng web của thành viên Huy Locket (truy cập menu, mở lịch sử, đăng bài, hay điều hướng các trang).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto shrink-0">
              <input
                type="text"
                placeholder="Tìm user, email, UID hoặc hành động..."
                className="input input-bordered text-xs rounded-2xl h-11 bg-slate-50 text-slate-900 border-slate-200 focus:border-teal-600 focus:bg-white font-bold px-4 shadow-inner"
                value={userActionsSearch}
                onChange={(e) => setUserActionsSearch(e.target.value)}
              />
              <select
                className="select select-bordered text-xs rounded-2xl h-11 bg-slate-50 text-slate-900 border-slate-200 focus:border-teal-600 font-bold px-4 shadow-inner"
                value={userActionsFilterType}
                onChange={(e) => setUserActionsFilterType(e.target.value)}
              >
                <option value="">Tất cả loại hành động</option>
                <option value="NAVIGATION">🧭 Điều hướng Trang (Navigation)</option>
                <option value="PROFILE_VIEW">👤 Truy cập Hồ sơ / Profile</option>
                <option value="FRIENDS_VIEW">👥 Truy cập Danh sách Bạn Bè</option>
                <option value="SETTINGS_OPEN">⚙️ Mở Cài đặt Ứng Dụng</option>
                <option value="STREAKS_VIEW">🌟 Xem Lịch sử / Streaks</option>
                <option value="MENU_OPEN">📋 Mở Menu / Rèm điều khiển</option>
                <option value="MOMENT_POST">📸 Đăng tải Moment mới</option>
                <option value="REACT_MOMENT">💛 Thả Tim / Reaction Bạn Bè</option>
                <option value="CHAT_SEND">💬 Gửi Tin Nhắn Phản Hồi</option>
                <option value="MOMENT_DELETE">🗑️ Xóa Khoảnh Khắc</option>
                <option value="MUSIC_SELECT">🎵 Mở Thư Viện Nhạc Spotify</option>
              </select>
              <button
                type="button"
                onClick={() => setAutoRefreshActions(!autoRefreshActions)}
                className={`btn rounded-2xl h-11 px-3 text-xs font-black transition ${autoRefreshActions ? "bg-teal-600 text-white shadow-md shadow-teal-500/30" : "bg-slate-100 text-slate-600 border-slate-300"}`}
                title="Tự động cập nhật mỗi 10 giây"
              >
                {autoRefreshActions ? "🟢 Auto-refresh ON" : "⚪ Auto OFF"}
              </button>
              <button
                type="button"
                onClick={() => fetchUserActions()}
                className="btn bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-2xl h-11 px-4 font-extrabold flex items-center gap-2 shadow-sm cursor-pointer active:scale-95"
                title="Tải lại ngay"
              >
                <RefreshCw size={17} className={userActionsLoading ? "animate-spin text-teal-600" : "text-teal-600"} />
                <span>Làm mới</span>
              </button>
              {(currentRole === "super_admin" || currentRole === "admin") && (
                <button
                  type="button"
                  onClick={handleClearUserActions}
                  disabled={clearingActions}
                  className="btn bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-2xl h-11 px-4 text-xs font-black shadow-sm flex items-center gap-1.5"
                  title="Xóa sạch lịch sử theo dõi hành vi"
                >
                  <Trash2 size={15} />
                  <span>Xóa nhật ký</span>
                </button>
              )}
            </div>
          </div>

          {/* STATS OVERVIEW CARDS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-teal-500/10 via-emerald-500/5 to-transparent border border-teal-200/60 shadow-sm flex flex-col justify-between">
              <span className="text-xs font-black text-teal-700 uppercase tracking-wider">Tổng Lượt Hoạt Động</span>
              <span className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">{userActions.length} <span className="text-xs font-medium text-slate-500">lần ghi nhận</span></span>
            </div>
            <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-transparent border border-blue-200/60 shadow-sm flex flex-col justify-between">
              <span className="text-xs font-black text-indigo-700 uppercase tracking-wider">Hồ Sơ & Danh Sách Bạn Bè</span>
              <span className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">{userActions.filter(a => ['PROFILE_VIEW', 'FRIENDS_VIEW', 'SETTINGS_OPEN'].includes(a.action_type)).length} <span className="text-xs font-medium text-slate-500">lượt truy cập</span></span>
            </div>
            <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-amber-500/10 via-rose-500/5 to-transparent border border-amber-200/60 shadow-sm flex flex-col justify-between">
              <span className="text-xs font-black text-amber-700 uppercase tracking-wider">Tương Tác, Tim & Chat</span>
              <span className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">{userActions.filter(a => ['REACT_MOMENT', 'CHAT_SEND', 'MOMENT_POST', 'MUSIC_SELECT', 'MOMENT_DELETE'].includes(a.action_type)).length} <span className="text-xs font-medium text-slate-500">thao tác</span></span>
            </div>
            <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-purple-500/10 via-cyan-500/5 to-transparent border border-purple-200/60 shadow-sm flex flex-col justify-between">
              <span className="text-xs font-black text-purple-700 uppercase tracking-wider">Điều Hướng & Lịch Sử Streaks</span>
              <span className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">{userActions.filter(a => ['NAVIGATION', 'STREAKS_VIEW', 'MENU_OPEN'].includes(a.action_type)).length} <span className="text-xs font-medium text-slate-500">lượt</span></span>
            </div>
          </div>

          {userActionsError && (
            <div className="alert alert-error mb-6 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-bold shadow-sm">
              <span>⚠️ Lỗi tải dữ liệu theo dõi: {userActionsError}</span>
            </div>
          )}

          {/* BEHAVIOR LOG TABLE */}
          <div className="overflow-x-auto rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_-5px_rgba(0,0,0,0.04)] bg-white">
            <table className="table w-full text-sm font-medium text-left">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[11px] font-black tracking-wider border-b border-slate-200/80">
                <tr>
                  <th className="py-4 pl-6">Thành viên thao tác</th>
                  <th className="py-4">Loại hành vi</th>
                  <th className="py-4">Chi tiết / Đường dẫn</th>
                  <th className="py-4">Thiết bị & IP</th>
                  <th className="py-4 pr-6 text-right">Thời điểm (Thực tế)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {userActionsLoading && userActions.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center py-12 text-slate-400 font-bold">
                      <div className="flex items-center justify-center gap-3">
                        <RefreshCw className="animate-spin text-teal-600" size={24} />
                        <span>Đang truy xuất dữ liệu cảm biến thời gian thực...</span>
                      </div>
                    </td>
                  </tr>
                ) : userActions.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center py-14 text-slate-400 font-bold">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Activity size={36} className="text-teal-300 stroke-1" />
                        <span className="text-base text-slate-600 font-extrabold">Chưa ghi nhận thao tác người dùng nào trên trang web</span>
                        <span className="text-xs text-slate-400 max-w-sm text-center">Hệ thống đang sẵn sàng! Hãy thử điều hướng, mở menu, xem lịch sử hoặc đăng bài trên ứng dụng web để kiểm nghiệm cảm biến.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  userActions.map((item) => {
                    let badgeClass = "bg-slate-100 text-slate-700 border-slate-200";
                    let actionIcon = "📌";
                    if (item.action_type === "NAVIGATION") {
                      badgeClass = "bg-blue-50 text-blue-700 border-blue-200";
                      actionIcon = "🧭";
                    } else if (item.action_type === "PROFILE_VIEW") {
                      badgeClass = "bg-violet-50 text-violet-800 border-violet-300 shadow-xs font-black";
                      actionIcon = "👤";
                    } else if (item.action_type === "FRIENDS_VIEW") {
                      badgeClass = "bg-indigo-50 text-indigo-800 border-indigo-300 shadow-xs font-black";
                      actionIcon = "👥";
                    } else if (item.action_type === "SETTINGS_OPEN") {
                      badgeClass = "bg-slate-100 text-slate-800 border-slate-300 font-bold";
                      actionIcon = "⚙️";
                    } else if (item.action_type === "STREAKS_VIEW") {
                      badgeClass = "bg-amber-50 text-amber-800 border-amber-300 shadow-xs";
                      actionIcon = "🌟";
                    } else if (item.action_type === "MENU_OPEN") {
                      badgeClass = "bg-purple-50 text-purple-700 border-purple-200";
                      actionIcon = "📋";
                    } else if (item.action_type === "MOMENT_POST") {
                      badgeClass = "bg-emerald-50 text-emerald-800 border-emerald-300 shadow-xs font-black";
                      actionIcon = "📸";
                    } else if (item.action_type === "REACT_MOMENT") {
                      badgeClass = "bg-amber-100 text-amber-900 border-amber-400 font-black shadow-sm";
                      actionIcon = "💛";
                    } else if (item.action_type === "CHAT_SEND") {
                      badgeClass = "bg-cyan-50 text-cyan-800 border-cyan-300 font-extrabold shadow-xs";
                      actionIcon = "💬";
                    } else if (item.action_type === "MOMENT_DELETE") {
                      badgeClass = "bg-rose-50 text-rose-800 border-rose-300 font-black shadow-xs";
                      actionIcon = "🗑️";
                    } else if (item.action_type === "MUSIC_SELECT") {
                      badgeClass = "bg-teal-50 text-teal-800 border-teal-300 font-bold";
                      actionIcon = "🎵";
                    }

                    const dt = new Date(item.created_at || item.createdAt);
                    const isToday = dt.toDateString() === new Date().toDateString();
                    const timeStr = isToday ? `Hôm nay, ${dt.toLocaleTimeString("vi-VN")}` : dt.toLocaleString("vi-VN");

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-4 pl-6 align-top">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-slate-900 text-sm">{item.display_name || item.user_uid || "Khách / Ẩn danh"}</span>
                            {item.email && <span className="text-xs font-medium text-slate-500">{item.email}</span>}
                            <span className="text-[10px] font-mono text-slate-400 mt-0.5 select-all">{item.user_uid}</span>
                          </div>
                        </td>
                        <td className="py-4 align-top">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border text-xs font-black ${badgeClass}`}>
                            <span>{actionIcon}</span>
                            <span>{item.action_title || item.action_type}</span>
                          </span>
                        </td>
                        <td className="py-4 align-top">
                          <span className="text-xs font-bold text-slate-700 block bg-slate-50/80 p-2 rounded-xl border border-slate-100 max-w-md break-words">
                            {item.action_details || "—"}
                          </span>
                        </td>
                        <td className="py-4 align-top">
                          <div className="flex flex-col gap-1 text-xs text-slate-600">
                            <span className="font-bold text-slate-800 flex items-center gap-1">
                              <Monitor size={12} className="text-slate-400" />
                              <span>{item.device_name || "Trình duyệt Web"}</span>
                            </span>
                            {item.ip_address && (
                              <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                                <MapPin size={11} className="text-teal-500" />
                                <span>{item.ip_address}</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 pr-6 align-top text-right whitespace-nowrap">
                          <span className="text-xs font-extrabold text-slate-700 block">{timeStr}</span>
                          <span className="text-[10px] font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md mt-1 inline-block border border-teal-100">
                            Realtime Telemetry
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: SECURITY THREATS & WAF SHIELD */}
      {activeTab === "security_threats" && (
        <div className="bg-white/95 text-slate-800 rounded-[2.5rem] shadow-[0_15px_50px_-10px_rgba(30,41,59,0.08)] border border-slate-200/80 p-6 sm:p-9 animate-fade-in relative overflow-hidden backdrop-blur-2xl">
          <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-red-400/10 rounded-full blur-[120px] pointer-events-none -mt-32 -mr-32" />
          
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-200/80">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block mr-1" />
                <span className="text-xs font-black tracking-widest text-red-600 uppercase bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
                  Realtime Cyber WAF Shield 100% Đồ Thật
                </span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 flex items-center gap-2 mt-1">
                <span>🛡️ Trung Tâm Phát Hiện & Đánh Chặn Tấn Công Web</span>
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
                Hệ thống cảm biến tường lửa WAF thời gian thực tự động quét và đánh chặn SQLi, XSS, DDoS, Bot Cào Dữ Liệu
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Lọc IP, tên miền, chi tiết..."
                  value={securitySearch}
                  onChange={(e) => setSecuritySearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-xs font-semibold bg-slate-50 border border-slate-200/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all text-slate-800"
                />
              </div>

              <select
                value={securityFilterType}
                onChange={(e) => setSecurityFilterType(e.target.value)}
                className="px-4 py-2.5 text-xs font-bold bg-slate-50 border border-slate-200/80 rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-slate-700 cursor-pointer"
              >
                <option value="">Tất cả hình thức tấn công</option>
                <option value="SQL_INJECTION">🔴 SQL Injection (SQLi)</option>
                <option value="XSS_INJECTION">🟠 XSS Script Stealing</option>
                <option value="PATH_TRAVERSAL">🚨 Path Traversal Probing</option>
                <option value="DDOS_RATE_FLOOD">🟡 DDoS & Rate Limit Flood</option>
                <option value="AUTOMATED_SCRAPER_BOT">🟣 Robot Cào Dữ Liệu Tự Động</option>
                <option value="IP_BLACKLIST_PROBE">⚫ IP Bị Cấm Trực Nhảy</option>
              </select>

              <button
                type="button"
                onClick={() => fetchSecurityThreats()}
                disabled={securityLoading}
                className="p-2.5 rounded-2xl bg-red-50 text-red-600 hover:bg-red-100/80 transition-all disabled:opacity-50 border border-red-200"
                title="Tải lại bảng Radar Bảo Mật"
              >
                <RefreshCw size={17} className={securityLoading ? "animate-spin text-red-600" : "text-red-600"} />
              </button>

              {currentRole === "super_admin" && (
                <button
                  type="button"
                  onClick={handleClearSecurityThreats}
                  disabled={clearingThreats}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 transition-all shadow-2xs"
                >
                  <Trash2 size={14} className="text-rose-600" />
                  <span>{clearingThreats ? "Đang xóa..." : "Xóa bản ghi"}</span>
                </button>
              )}
            </div>
          </div>

          {/* OVERVIEW STATS CARDS */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
            <div className="p-5 rounded-3xl bg-red-50/70 border border-red-200/80 flex flex-col justify-between shadow-2xs">
              <span className="text-[11px] font-black text-red-700 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldAlert size={14} /> TỔNG LƯỢT ĐÁNH CHẶN
              </span>
              <span className="text-2xl sm:text-3xl font-black text-red-950 mt-2">
                {securityThreats.length} <span className="text-xs font-medium text-red-700">yêu cầu độc hại</span>
              </span>
            </div>
            <div className="p-5 rounded-3xl bg-amber-50/70 border border-amber-200/80 flex flex-col justify-between shadow-2xs">
              <span className="text-[11px] font-black text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle size={14} /> NGUY CƠ CHIẾM QUYỀN (CRITICAL)
              </span>
              <span className="text-2xl sm:text-3xl font-black text-amber-950 mt-2">
                {securityThreats.filter((t) => t.severity === 'CRITICAL').length} <span className="text-xs font-medium text-amber-700">vụ rình rập</span>
              </span>
            </div>
            <div className="p-5 rounded-3xl bg-emerald-50/70 border border-emerald-200/80 flex flex-col justify-between shadow-2xs">
              <span className="text-[11px] font-black text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                <Zap size={14} /> TRẠNG THÁI TƯỜNG LỬA WAF
              </span>
              <span className="text-lg sm:text-xl font-black text-emerald-950 mt-2 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" /> Đang bảo vệ 100%
              </span>
            </div>
            <div className="p-5 rounded-3xl bg-purple-50/70 border border-purple-200/80 flex flex-col justify-between shadow-2xs">
              <span className="text-[11px] font-black text-purple-700 uppercase tracking-wider flex items-center gap-1.5">
                <Monitor size={14} /> KHIÊN CHỐNG DDOS & BOT
              </span>
              <span className="text-sm font-bold text-purple-950 mt-2">
                Giới hạn 300 req/phút & Tự động cấm IP Scraping
              </span>
            </div>
          </div>

          {/* INTERACTIVE PEN-TEST SANDBOX (KIỂM THỬ THƯỢNG ĐẢNG) */}
          <div className="mb-8 p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-xl border border-slate-700/80 relative overflow-hidden">
            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-base sm:text-lg font-black text-red-400 flex items-center gap-2">
                  ⚡ Khu Vực Phát Lệnh Kiểm Thử Tường Lửa Thực Tế (Pen-Test Sandbox)
                </h4>
                <p className="text-xs sm:text-sm text-slate-300 font-medium mt-1">
                  Bấm để bắn thực tế các payload mã độc mô phỏng trực tiếp lên cảm biến WAF máy chủ xem tường lửa tự động phát hiện, báo còi và chép log thời gian thực:
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSimulateThreat("SQL_INJECTION")}
                  disabled={simulatingThreat !== null}
                  className="px-4 py-2.5 rounded-2xl font-black text-xs bg-red-600 hover:bg-red-500 text-white transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <span>🔴 Bắn thử SQL Injection (SQLi)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulateThreat("XSS_INJECTION")}
                  disabled={simulatingThreat !== null}
                  className="px-4 py-2.5 rounded-2xl font-black text-xs bg-orange-600 hover:bg-orange-500 text-white transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <span>🟠 Bắn thử XSS Script Stealer</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulateThreat("DDOS_RATE_FLOOD")}
                  disabled={simulatingThreat !== null}
                  className="px-4 py-2.5 rounded-2xl font-black text-xs bg-amber-600 hover:bg-amber-500 text-white transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <span>🟡 Giả lập Dội Bom (DDoS Test)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulateThreat("AUTOMATED_SCRAPER_BOT")}
                  disabled={simulatingThreat !== null}
                  className="px-4 py-2.5 rounded-2xl font-black text-xs bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <span>🟣 Bắn thử Robot Cào Dữ Liệu</span>
                </button>
              </div>
            </div>
          </div>

          {/* TABLE OF SECURITY THREATS */}
          <div className="overflow-x-auto rounded-3xl border border-slate-200/80 shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-black text-slate-400 uppercase tracking-wider">
                  <th className="py-4 px-6">Thời gian & Mức độ</th>
                  <th className="py-4 px-6">Hình thức Tấn công</th>
                  <th className="py-4 px-6">IP & Nguồn truy cập</th>
                  <th className="py-4 px-6">Đường dẫn bị can thiệp</th>
                  <th className="py-4 px-6">Mô tả chi tiết / Tải trọng (Payload)</th>
                  <th className="py-4 px-6 text-right">Trạng thái WAF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-xs text-slate-700">
                {securityLoading && securityThreats.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 font-bold">
                      <div className="flex flex-col items-center gap-2">
                        <RefreshCw size={24} className="animate-spin text-red-500" />
                        <span>Đang đồng bộ dữ liệu tường lửa từ máy chủ...</span>
                      </div>
                    </td>
                  </tr>
                ) : securityThreats.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-400 font-bold">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-14 h-14 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200 shadow-sm">
                          <CheckCircle size={28} />
                        </div>
                        <p className="text-base text-slate-700 font-black">Hệ thống hoàn toàn an toàn!</p>
                        <p className="text-xs text-slate-500 max-w-md mx-auto font-medium">
                          Chưa có ghi nhận tấn công mã độc hay hành vi phá hoại nào. Bạn có thể nhấn các nút <b>Khu Vực Phát Lệnh Kiểm Thử Tường Lửa (Pen-Test)</b> bên trên để kiểm nghiệm phản xạ trực chiến thực tế của hệ thống!
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  securityThreats.map((item) => {
                    const sevColor = 
                      item.severity === 'CRITICAL' ? 'bg-red-500 text-white font-black animate-pulse' :
                      item.severity === 'HIGH' ? 'bg-amber-100 text-amber-900 font-bold border border-amber-300' :
                      'bg-slate-100 text-slate-800 font-bold';

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-all duration-200 group">
                        <td className="py-4 px-6">
                          <div className="font-bold text-slate-900 text-xs">
                            {formatDateTime(item.created_at)}
                          </div>
                          <span className={`text-[10px] uppercase px-2 py-0.5 rounded-md mt-1 inline-block ${sevColor}`}>
                            {item.severity}
                          </span>
                        </td>

                        <td className="py-4 px-6">
                          <span className="font-extrabold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-xl text-[11px] border border-slate-200/80">
                            {item.threat_type || "UNKNOWN_THREAT"}
                          </span>
                        </td>

                        <td className="py-4 px-6">
                          <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
                            <span>🌐 {item.attacker_ip || "Không xác định"}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-normal max-w-[220px] truncate mt-0.5" title={item.user_agent || ""}>
                            💻 {item.user_agent || "Không rõ thiết bị"}
                          </div>
                        </td>

                        <td className="py-4 px-6 font-mono text-[11px] font-bold text-indigo-600">
                          {item.target_endpoint || "/api/unknown"}
                        </td>

                        <td className="py-4 px-6 max-w-sm">
                          <div className="font-bold text-slate-800">
                            {item.details || "Phát hiện dấu hiệu can thiệp bất thường"}
                          </div>
                          {item.payload_sample && (
                            <div className="mt-1 font-mono text-[10px] text-red-600 bg-red-50 p-2 rounded-lg border border-red-200 overflow-hidden text-ellipsis">
                              <code>Payload: {item.payload_sample}</code>
                            </div>
                          )}
                        </td>

                        <td className="py-4 px-6 text-right">
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                            ĐÃ ĐÁNH CHẶN
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: AUDIT LOGS */}
      {activeTab === "audit" && (
        <div className="bg-white/95 text-slate-800 rounded-[2.5rem] shadow-[0_15px_50px_-10px_rgba(30,41,59,0.08)] border border-slate-200/80 p-6 sm:p-9 animate-fade-in relative overflow-hidden backdrop-blur-2xl">
          <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-purple-400/10 rounded-full blur-[120px] pointer-events-none -mt-32 -mr-32" />
          
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-200/80">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-black mb-2 shadow-sm">
                <span>📜 IMMUTABLE SECURITY TRACKER</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-900 flex items-center gap-2.5">
                Nhật Ký Quản Trị Huy Locket (Audit Log)
              </h2>
              <p className="text-sm text-slate-600 font-medium mt-1">
                Lưu vết toàn bộ thao tác nhạy cảm của các quản trị viên theo chuẩn Append-Only. Dữ liệu vĩnh viễn không thể tẩy xóa bởi admin thường.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto shrink-0">
              <input
                type="text"
                placeholder="Lọc lệnh (LOCK, REVOKE...)"
                className="input input-bordered text-xs rounded-2xl h-11 bg-slate-50 text-slate-900 border-slate-200 focus:border-purple-600 focus:bg-white font-bold px-4 shadow-inner"
                value={auditFilterAction}
                onChange={(e) => setAuditFilterAction(e.target.value)}
              />
              <input
                type="text"
                placeholder="Lọc theo UID admin..."
                className="input input-bordered text-xs rounded-2xl h-11 bg-slate-50 text-slate-900 border-slate-200 focus:border-purple-600 focus:bg-white font-bold px-4 shadow-inner"
                value={auditFilterAdmin}
                onChange={(e) => setAuditFilterAdmin(e.target.value)}
              />
              <button type="button" onClick={fetchAuditLogs} className="btn bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-2xl h-11 px-4 font-extrabold flex items-center gap-2 shadow-sm cursor-pointer active:scale-95" title="Tải lại log">
                <RefreshCw size={17} className={auditLoading ? "animate-spin text-purple-600" : "text-purple-600"} />
                <span>Làm Mới</span>
              </button>
            </div>
          </div>

          <div className="relative z-10">
            {auditLoading ? (
              <div className="py-20 text-center flex flex-col items-center justify-center gap-4">
                <span className="loading loading-bars loading-lg text-purple-600" />
                <p className="text-sm font-black text-slate-600 uppercase tracking-widest">Đang truy xuất Sổ Lưu Vết từ hạ tầng Neon Postgres...</p>
              </div>
            ) : auditError ? (
              <div className="alert bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-2xl p-4 font-bold shadow-sm"><AlertTriangle size={20} className="text-rose-600" /> <span>{auditError}</span></div>
            ) : auditLogs.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                <div className="text-5xl mb-4">📭</div>
                <p className="font-black text-lg text-slate-900">Chưa có bản ghi Audit Log nào phù hợp</p>
                <p className="text-xs mt-1 text-slate-500 font-semibold">Các thao tác khóa tài khoản, thu hồi phiên hay đổi quyền RBAC sẽ xuất hiện tự động tại đây.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200/80 rounded-2xl bg-white shadow-inner max-h-[600px] overflow-y-auto">
                <table className="table table-sm w-full text-sm font-medium">
                  <thead className="bg-slate-50/90 font-extrabold text-purple-950 text-xs uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200/80">
                    <tr>
                      <th className="py-3.5 pl-5">Thời gian server</th>
                      <th>Quản trị viên</th>
                      <th>Hành động</th>
                      <th>UID đối tượng</th>
                      <th>Lý do & Chi tiết</th>
                      <th className="pr-5">IP / Nguồn thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-purple-50/40 transition-colors">
                        <td className="whitespace-nowrap font-mono text-xs font-bold text-slate-700 pl-5 py-3.5">{formatDateTime(log.created_at)}</td>
                        <td>
                          <div className="font-mono text-xs font-black text-indigo-700" title={`Raw Admin UID: ${log.admin_uid}`}>{getFixedNumericUid(log.admin_uid)}</div>
                          <div className="mt-1 scale-90 origin-left">{roleBadge(log.role)}</div>
                        </td>
                        <td>
                          <span className="px-3 py-1 rounded-xl bg-purple-50 text-purple-700 border border-purple-200 font-mono font-black text-xs shadow-sm">
                            {log.action}
                          </span>
                        </td>
                        <td className="font-mono text-xs font-bold text-amber-700" title={`Raw Target UID: ${log.target_uid || "—"}`}>
                          {log.target_uid && log.target_uid !== "—" ? getFixedNumericUid(log.target_uid) : "—"}
                        </td>
                        <td className="text-xs font-semibold text-slate-700 max-w-md break-words">{log.details || "—"}</td>
                        <td className="text-xs pr-5">
                          <div className="font-mono font-extrabold text-slate-900">{log.ip_address || UNKNOWN}</div>
                          <div className="text-[11px] font-bold text-slate-500 mt-0.5">{sourceLabel(log.web_source)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: REPORTED CONTENT */}
      {activeTab === "reports" && (
        <div className="bg-white/95 text-slate-800 rounded-[2.5rem] shadow-[0_15px_50px_-10px_rgba(30,41,59,0.08)] border border-slate-200/80 p-6 sm:p-9 animate-fade-in relative overflow-hidden backdrop-blur-2xl">
          <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-amber-400/10 rounded-full blur-[120px] pointer-events-none -mt-32 -mr-32" />

          <div className="relative z-10 flex items-center justify-between mb-8 pb-6 border-b border-slate-200/80 flex-wrap gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-black mb-2 shadow-sm">
                <span>🛡️ CONTENT MODERATION SHIELD</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-950 via-slate-900 to-rose-900 flex items-center gap-2.5">
                Quản Lý Nội Dung Bị Báo Cáo
              </h2>
              <p className="text-sm text-slate-600 font-medium mt-1">
                Trạm xử lý vi phạm tiêu chuẩn cộng đồng dành riêng cho Quản trị viên và Moderator của Huy Locket.
              </p>
            </div>
            <button type="button" onClick={fetchReports} className="btn bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-2xl h-11 px-5 font-black flex items-center gap-2 shadow-sm cursor-pointer active:scale-95" title="Tải lại">
              <RefreshCw size={17} className={reportsLoading ? "animate-spin text-amber-600" : "text-amber-600"} />
              <span>Tải Lại Báo Cáo</span>
            </button>
          </div>

          <div className="relative z-10">
            {reportsLoading ? (
              <div className="py-20 text-center flex flex-col items-center justify-center gap-4"><span className="loading loading-spinner loading-lg text-amber-600" /></div>
            ) : reportsError ? (
              <div className="alert bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-2xl p-4 font-bold shadow-sm"><AlertTriangle size={20} className="text-rose-600" /> <span>{reportsError}</span></div>
            ) : reports.length === 0 ? (
              <div className="text-center py-20 text-slate-500 bg-slate-50/80 rounded-3xl border border-slate-200/80">
                <div className="text-6xl mb-4 animate-bounce">🎉</div>
                <p className="font-black text-xl text-slate-900">Không Có Nội Dung Vi Phạm Nào!</p>
                <p className="text-sm text-slate-500 mt-1 font-semibold">Môi trường giao tiếp trên Locket đang cực kỳ an toàn và sạch sẽ.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200/80 rounded-2xl bg-white shadow-inner">
                <table className="table w-full text-sm font-medium">
                  <thead className="bg-slate-50/90 font-extrabold text-amber-950 text-xs uppercase tracking-wider border-b border-slate-200/80">
                    <tr>
                      <th className="py-3.5 pl-5">ID Bài / Nội dung</th>
                      <th>Người báo cáo</th>
                      <th>Tác giả</th>
                      <th>Lý do vi phạm</th>
                      <th>Trạng thái</th>
                      <th className="text-right pr-5">Xử lý vi phạm</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {reports.map((report) => (
                      <tr key={report.id} className="hover:bg-amber-50/30 transition-colors">
                        <td className="font-mono text-xs font-black text-indigo-700 pl-5 py-3.5">{report.content_id}</td>
                        <td className="font-mono text-xs font-bold text-slate-800">{report.reporter_uid || "Ẩn danh"}</td>
                        <td className="font-mono text-xs font-bold text-slate-800">{report.author_uid || "—"}</td>
                        <td className="text-xs font-black text-rose-600">{report.reason || "Vi phạm tiêu chuẩn"}</td>
                        <td><span className="px-2.5 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-xs font-black shadow-sm">Đang chờ xử lý</span></td>
                        <td className="text-right space-x-2 pr-5">
                          <button type="button" onClick={() => handleResolveReport(report.id, "hidden")} className="btn btn-xs bg-amber-50 hover:bg-amber-500 text-amber-800 hover:text-white border border-amber-200 font-extrabold rounded-xl h-8 px-3 transition-all">Ẩn bài</button>
                          <button type="button" onClick={() => handleResolveReport(report.id, "deleted")} className="btn btn-xs bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 font-extrabold rounded-xl h-8 px-3 transition-all">Xóa mềm</button>
                          <button type="button" onClick={() => handleResolveReport(report.id, "dismissed")} className="btn btn-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl h-8 px-3 transition-all">Bỏ qua</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: ADVANCED SUPER ADMIN POWER SUITE - OBSIDIAN CYBER DARK THEME */}
      {activeTab === "advanced" && (
        <div className="space-y-7 animate-fade-in">
          {/* SUB-NAVIGATOR FOR SUPREME POWER SUITE - CYBERPUNK OBSIDIAN DOCK */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 bg-slate-950/95 p-3.5 sm:p-4 rounded-3xl shadow-[0_10px_35px_-5px_rgba(0,0,0,0.6)] border border-slate-800/80 backdrop-blur-2xl">
            <button
              type="button"
              onClick={() => setAdvancedSubTab("telemetry")}
              className={`flex items-center gap-3.5 p-4 rounded-2xl transition-all duration-300 cursor-pointer text-left shadow-sm border relative overflow-hidden ${
                advancedSubTab === "telemetry"
                  ? "bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 text-white border-indigo-500/50 shadow-lg shadow-indigo-500/30 scale-[1.01]"
                  : "bg-slate-900/90 text-slate-300 border-slate-800/80 hover:border-indigo-500/40 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 ${advancedSubTab === "telemetry" ? "bg-white/20 text-indigo-100 shadow-md scale-105" : "bg-indigo-950/80 border border-indigo-500/30 text-indigo-400"}`}>
                <Activity size={24} className={advancedSubTab === "telemetry" ? "animate-pulse" : ""} />
              </div>
              <div className="overflow-hidden">
                <div className="text-[10px] font-extrabold uppercase tracking-widest mb-0.5 flex items-center gap-1">
                  <span className={advancedSubTab === "telemetry" ? "text-indigo-200" : "text-slate-500"}>HẠ TẦNG CLOUD</span>
                  {advancedSubTab === "telemetry" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-200 animate-ping" />}
                </div>
                <div className={`text-sm font-black truncate ${advancedSubTab === "telemetry" ? "text-white" : "text-slate-100"}`}>Cảm Biến Telemetry</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setAdvancedSubTab("broadcast")}
              className={`flex items-center gap-3.5 p-4 rounded-2xl transition-all duration-300 cursor-pointer text-left shadow-sm border relative overflow-hidden ${
                advancedSubTab === "broadcast"
                  ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white border-blue-500/50 shadow-lg shadow-blue-500/30 scale-[1.01]"
                  : "bg-slate-900/90 text-slate-300 border-slate-800/80 hover:border-blue-500/40 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 ${advancedSubTab === "broadcast" ? "bg-white/20 text-yellow-200 shadow-md scale-105" : "bg-blue-950/80 border border-blue-500/30 text-blue-400"}`}>
                <Volume2 size={24} className={advancedSubTab === "broadcast" ? "animate-bounce" : ""} />
              </div>
              <div className="overflow-hidden">
                <div className="text-[10px] font-extrabold uppercase tracking-widest mb-0.5 flex items-center gap-1">
                  <span className={advancedSubTab === "broadcast" ? "text-blue-200" : "text-slate-500"}>TRUYỀN THÔNG BÁO</span>
                  {advancedSubTab === "broadcast" && <span className="w-1.5 h-1.5 rounded-full bg-blue-200 animate-ping" />}
                </div>
                <div className={`text-sm font-black truncate ${advancedSubTab === "broadcast" ? "text-white" : "text-slate-100"}`}>Phát Loa Broadcast</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setAdvancedSubTab("blacklist")}
              className={`flex items-center gap-3.5 p-4 rounded-2xl transition-all duration-300 cursor-pointer text-left shadow-sm border relative overflow-hidden ${
                advancedSubTab === "blacklist"
                  ? "bg-gradient-to-r from-rose-600 via-red-600 to-amber-600 text-white border-rose-500/50 shadow-lg shadow-rose-500/30 scale-[1.01]"
                  : "bg-slate-900/90 text-slate-300 border-slate-800/80 hover:border-rose-500/40 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 ${advancedSubTab === "blacklist" ? "bg-white/20 text-yellow-200 shadow-md scale-105" : "bg-rose-950/80 border border-rose-500/30 text-rose-400"}`}>
                <ShieldAlert size={24} className={advancedSubTab === "blacklist" ? "animate-pulse" : ""} />
              </div>
              <div className="overflow-hidden">
                <div className="text-[10px] font-extrabold uppercase tracking-widest mb-0.5 flex items-center gap-1">
                  <span className={advancedSubTab === "blacklist" ? "text-rose-200" : "text-slate-500"}>TƯỜNG LỬA WAF</span>
                  {advancedSubTab === "blacklist" && <span className="w-1.5 h-1.5 rounded-full bg-rose-200 animate-ping" />}
                </div>
                <div className={`text-sm font-black truncate ${advancedSubTab === "blacklist" ? "text-white" : "text-slate-100"}`}>Cấm Cửa IP Vĩnh Viễn</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setAdvancedSubTab("heartbeat");
                if (apiStatuses.length === 0) runApiHealthCheck();
              }}
              className={`flex items-center gap-3.5 p-4 rounded-2xl transition-all duration-300 cursor-pointer text-left shadow-sm border relative overflow-hidden ${
                advancedSubTab === "heartbeat"
                  ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white border-emerald-500/50 shadow-lg shadow-emerald-500/30 scale-[1.01]"
                  : "bg-slate-900/90 text-slate-300 border-slate-800/80 hover:border-emerald-500/40 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 ${advancedSubTab === "heartbeat" ? "bg-white/20 text-emerald-200 shadow-md scale-105" : "bg-emerald-950/80 border border-emerald-500/30 text-emerald-400"}`}>
                <Zap size={24} className={advancedSubTab === "heartbeat" ? "animate-bounce" : ""} />
              </div>
              <div className="overflow-hidden">
                <div className="text-[10px] font-extrabold uppercase tracking-widest mb-0.5 flex items-center gap-1">
                  <span className={advancedSubTab === "heartbeat" ? "text-emerald-200" : "text-slate-500"}>RADAR NHỊP SỐNG</span>
                  {advancedSubTab === "heartbeat" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-200 animate-ping" />}
                </div>
                <div className={`text-sm font-black truncate ${advancedSubTab === "heartbeat" ? "text-white" : "text-slate-100"}`}>Giám Sát Sóng API</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setAdvancedSubTab("whitelist")}
              className={`flex items-center gap-3.5 p-4 rounded-2xl transition-all duration-300 cursor-pointer text-left shadow-sm border relative overflow-hidden ${
                advancedSubTab === "whitelist"
                  ? "bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 text-white border-green-500/50 shadow-lg shadow-green-500/30 scale-[1.01]"
                  : "bg-slate-900/90 text-slate-300 border-slate-800/80 hover:border-green-500/40 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 ${advancedSubTab === "whitelist" ? "bg-white/20 text-green-200 shadow-md scale-105" : "bg-green-950/80 border border-green-500/30 text-green-400"}`}>
                <ShieldCheck size={24} className={advancedSubTab === "whitelist" ? "animate-pulse" : ""} />
              </div>
              <div className="overflow-hidden">
                <div className="text-[10px] font-extrabold uppercase tracking-widest mb-0.5 flex items-center gap-1">
                  <span className={advancedSubTab === "whitelist" ? "text-green-200" : "text-slate-500"}>AN TOÀN HỆ THỐNG</span>
                  {advancedSubTab === "whitelist" && <span className="w-1.5 h-1.5 rounded-full bg-green-200 animate-ping" />}
                </div>
                <div className={`text-sm font-black truncate ${advancedSubTab === "whitelist" ? "text-white" : "text-slate-100"}`}>Kim Bài Miễn Tử</div>
              </div>
            </button>
          </div>

          {/* Section 1: Production infrastructure probes */}
          {advancedSubTab === "telemetry" && (
            <div className="bg-slate-950 text-slate-100 rounded-[2.5rem] p-6 sm:p-9 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] border border-slate-800/80 relative overflow-hidden animate-fade-in backdrop-blur-2xl">
              {/* Decorative Ambient Cyber Lighting */}
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[140px] pointer-events-none -mt-32 -mr-32" />
              <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[140px] pointer-events-none -mb-32 -ml-32" />

              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4 pb-6 border-b border-slate-800/80">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 text-xs font-black mb-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    <span>PRODUCTION OBSERVABILITY · LIVE PROBES</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-white to-blue-200 flex items-center gap-2.5">
                    Giám Sát Hạ Tầng Vercel, Neon & Render
                  </h2>
                  <p className="text-sm text-slate-400 font-medium mt-1 max-w-3xl leading-relaxed">
                    Dữ liệu trực tiếp từ trình duyệt, Vercel API, Neon PostgreSQL và endpoint /health của Render worker. Không hiển thị tài nguyên host dùng chung.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchAdvancedData(true)}
                  disabled={refreshingTelemetry}
                  className="btn btn-md bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold border-0 shadow-[0_10px_30px_-5px_rgba(79,46,229,0.5)] transition-all duration-300 shrink-0 rounded-2xl px-6 h-12 active:scale-95 cursor-pointer text-sm"
                >
                  {refreshingTelemetry ? (
                    <>
                      <span className="loading loading-spinner loading-sm text-indigo-200" />
                      <span>Đang kiểm tra Vercel API...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={18} className="text-indigo-200" />
                      <span>🔄 Làm mới Cảm biến Real-Time</span>
                    </>
                  )}
                </button>
              </div>

              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-6">
                {/* 1. Vercel Frontend Edge Shield & Client Telemetry */}
                <div className="bg-slate-900/90 border-2 border-slate-800/80 hover:border-indigo-500/50 transition-all duration-300 rounded-[2.2rem] p-6 shadow-xl hover:shadow-2xl flex flex-col justify-between group">
                  <div>
                    <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-800/80">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-950 border border-indigo-500/40 flex items-center justify-center text-indigo-400 text-lg font-bold shadow-sm group-hover:scale-110 transition-transform">
                          🌐
                        </div>
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-indigo-400">FRONTEND LAYER</div>
                          <span className="font-black text-sm text-white">TRẠM GIAO DIỆN VERCEL</span>
                        </div>
                      </div>
                      <span className="badge bg-indigo-950 text-indigo-300 border border-indigo-500/40 font-black text-[10px] px-3 py-2.5 rounded-xl shadow-sm">
                        EDGE ACTIVE
                      </span>
                    </div>
                    
                    <div className="space-y-3.5">
                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-indigo-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Độ trễ phản hồi máy chủ (Real RTT Ping)
                        </span>
                        <div className="flex flex-col gap-2">
                          <div className={`font-black text-lg font-mono tracking-tight flex items-center gap-2 ${
                            !clientTelemetry?.pingVal || clientTelemetry.pingVal < 350
                              ? "text-emerald-400"
                              : clientTelemetry.pingVal < 800
                                ? "text-amber-400"
                                : "text-rose-400"
                          }`}>
                            <span className={`inline-block w-2.5 h-2.5 rounded-full animate-ping ${
                              !clientTelemetry?.pingVal || clientTelemetry.pingVal < 350 ? "bg-emerald-400" : "bg-amber-400"
                            }`} />
                            <span>{clientTelemetry?.pingMs || "Đang đo..."}</span>
                            <span className="text-xs text-slate-300 font-semibold font-sans px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 shadow-sm">
                              {clientTelemetry?.connectionType || "Online"}
                            </span>
                          </div>
                          {clientTelemetry?.pingVal > 800 && (
                            <div className="text-xs text-amber-300 font-semibold bg-amber-950/50 p-3 rounded-xl border border-amber-500/40 leading-relaxed shadow-sm flex items-start gap-2">
                              <span className="text-base shrink-0">⚡</span>
                              <div>
                                <strong className="text-amber-200 font-extrabold uppercase text-[11px] block">Vì sao ping cao?</strong>
                                Độ trễ có thể tăng khi Vercel Function hoặc Neon vừa cold start. Bấm làm mới để đo lại, không giả định vị trí máy chủ.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-indigo-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Tường lửa WAF & Giao thức Edge
                        </span>
                        <div className="flex items-center gap-2 text-white font-black text-xs font-mono">
                          <span className="badge badge-sm bg-emerald-950 text-emerald-300 border-emerald-500/40 font-bold px-2.5 py-3 rounded-xl shadow-sm">DDoS Protected</span>
                          <span className="text-indigo-300 font-bold">{clientTelemetry?.protocol || "HTTPS (TLS 1.3)"}</span>
                        </div>
                      </div>

                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-indigo-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Dung lượng Bộ nhớ đệm (Cache)
                        </span>
                        <div className="text-amber-300 font-bold text-xs font-mono flex items-center justify-between">
                          <span>⚡ {clientTelemetry?.cachedItemsCount || "0"} Tệp lưu tạm</span>
                          <span className="text-slate-400">Dung lượng: {clientTelemetry?.localStorageBytes || "0"} KB</span>
                        </div>
                      </div>

                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-indigo-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Thiết bị Admin & Trình duyệt thực
                        </span>
                        <div className="text-indigo-200 font-bold text-xs font-mono truncate bg-slate-900 px-3 py-2 rounded-xl border border-slate-800 shadow-sm">
                          💻 {clientTelemetry?.cpuThreads || "8 Lõi"} · {clientTelemetry?.deviceRAM || "RAM"} · {clientTelemetry?.userAgentBrand || "Web"}
                        </div>
                      </div>

                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-indigo-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Tốc độ mạng & Độ phân giải màn hình
                        </span>
                        <div className="text-indigo-200 font-bold text-xs font-mono flex items-center justify-between bg-slate-900 px-3 py-2 rounded-xl border border-slate-800 shadow-sm">
                          <span>📶 {clientTelemetry?.downlinkMbps || "N/A"}</span>
                          <span className="text-slate-400">🖥️ {typeof window !== "undefined" ? `${window.screen?.width || 0}×${window.screen?.height || 0}` : "N/A"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Vercel Backend Function */}
                <div className="bg-slate-900/90 border-2 border-slate-800/80 hover:border-purple-500/50 transition-all duration-300 rounded-[2.2rem] p-6 shadow-xl hover:shadow-2xl flex flex-col justify-between group">
                  <div>
                    <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-800/80">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-2xl bg-purple-950 border border-purple-500/40 flex items-center justify-center text-purple-400 text-lg font-bold shadow-sm group-hover:scale-110 transition-transform">
                          ⚡
                        </div>
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-purple-400">BACKEND ENGINE</div>
                          <span className="font-black text-sm text-white">TRẠM API VERCEL</span>
                        </div>
                      </div>
                      <span className="badge bg-purple-950 text-purple-300 border border-purple-500/40 font-black text-[10px] px-3 py-2.5 rounded-xl shadow-sm">
                        SERVERLESS FUNCTION
                      </span>
                    </div>

                    {serverHealth ? (
                      <div className="space-y-3.5">
                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-purple-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Trạng thái Function
                          </span>
                          <div className="text-emerald-400 font-black text-sm font-mono flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                            <span>{serverHealth.status}</span>
                            <span className="badge badge-sm bg-emerald-950 text-emerald-300 border-emerald-500/40 font-mono font-bold px-2.5 py-3 rounded-xl shadow-sm">{serverHealth.runtime || "Vercel Function"}</span>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-purple-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Uptime instance hiện tại
                          </span>
                          <div className="text-white font-black text-sm font-mono bg-slate-900 px-3.5 py-2.5 rounded-xl border border-slate-800 flex flex-wrap gap-2 items-center justify-between shadow-sm">
                            <span>⏳ <span className="text-purple-300 font-bold">{Math.floor(serverHealth.uptimeSeconds / 3600)}h {Math.floor((serverHealth.uptimeSeconds % 3600) / 60)}p {serverHealth.uptimeSeconds % 60}s</span></span>
                            <span className="text-xs text-slate-400 font-semibold">Reset khi cold start / deploy</span>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-purple-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            RAM tiến trình Node.js
                          </span>
                          <div className="text-amber-300 font-black text-sm font-mono">
                            <div className="flex items-center justify-between mb-1">
                              <span>🧠 RSS {serverHealth.memoryRssMb} MB</span>
                              <span>V8 {serverHealth.memoryHeapUsedMb}/{serverHealth.memoryHeapTotalMb} MB</span>
                            </div>
                            <div className="text-xs text-slate-400 font-normal border-t border-slate-800/80 pt-1 mt-1">Chỉ đo tiến trình API; không dùng RAM của host chung.</div>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-purple-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Runtime & khu vực
                          </span>
                          <div className="text-white font-bold text-xs font-mono">
                            <div className="truncate mb-1 text-purple-300 font-extrabold">
                              ▲ {serverHealth.provider || "Vercel"} · {serverHealth.region || "Region tự động"}
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-1.5">
                              <span>Platform: <strong className="text-white font-mono">{serverHealth.platform}</strong></span>
                              <span>Node: <strong className="text-white font-mono">{serverHealth.nodeVersion}</strong></span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-purple-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Deployment hiện tại
                          </span>
                          <div className="text-cyan-300 font-black text-sm font-mono bg-slate-900 px-3.5 py-2.5 rounded-xl border border-slate-800 shadow-sm flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span>{serverHealth.environment || "production"}</span>
                              <span className="text-[10px] text-slate-400 font-semibold truncate">Commit {serverHealth.commit ? serverHealth.commit.slice(0, 7) : "N/A"}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-normal">Dữ liệu lấy từ biến hệ thống Vercel.</span>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-purple-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Phạm vi số liệu
                          </span>
                          <div className="text-white font-bold text-xs font-mono">
                            <div className="flex items-center justify-between mb-1 gap-2">
                              <span className="text-emerald-300">✓ API đang phản hồi</span>
                              <span className="font-extrabold text-slate-300">Ephemeral</span>
                            </div>
                            <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-1.5 flex items-center justify-between">
                              <span>Không hiển thị CPU/RAM host dùng chung</span>
                              <span className="badge badge-xs bg-purple-950 text-purple-300 border-purple-500/40 px-2 py-2.5 rounded-lg shadow-sm font-bold">{serverHealth.environment || "production"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-16 text-center text-purple-400 flex flex-col items-center gap-3.5">
                        <span className="loading loading-bars loading-md text-purple-400"></span>
                        <span className="font-bold text-xs uppercase tracking-wide text-slate-400">Đang đọc trạng thái Vercel Function...</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Neon PostgreSQL Cloud DB Telemetry */}
                <div className="bg-slate-900/90 border-2 border-slate-800/80 hover:border-emerald-500/50 transition-all duration-300 rounded-[2.2rem] p-6 shadow-xl hover:shadow-2xl flex flex-col justify-between group">
                  <div>
                    <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-800/80">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-lg font-bold shadow-sm group-hover:scale-110 transition-transform">
                          🗄️
                        </div>
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400">DATABASE LAYER</div>
                          <span className="font-black text-sm text-white">TRẠM CSDL NEON CLOUD</span>
                        </div>
                      </div>
                      <span className="badge bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-black text-[10px] px-3 py-2.5 rounded-xl shadow-sm">
                        SQL ONLINE
                      </span>
                    </div>

                    {serverHealth && serverHealth.db ? (
                      <div className="space-y-3.5">
                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-emerald-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Engine CSDL & Tốc độ truy xuất (DB Latency)
                          </span>
                          <div className="text-emerald-400 font-black text-sm font-mono flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            <span>{serverHealth.db.latencyMs ? `${serverHealth.db.latencyMs}ms` : "Siêu nhạy"}</span>
                            <span className="text-xs text-slate-200 font-semibold px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 shadow-sm">
                              {serverHealth.db.status}
                            </span>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-emerald-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Dung lượng Thực tế & Quy mô CSDL
                          </span>
                          <div className="text-white font-black text-sm font-mono flex items-center justify-between bg-slate-900 px-3.5 py-2.5 rounded-xl border border-slate-800 shadow-sm">
                            <span>💾 {serverHealth.db.size}</span>
                            <span className="text-xs text-emerald-400 font-bold">Gồm {serverHealth.db.tables} Bảng dữ liệu thực</span>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-emerald-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Kết nối Mạng CSDL (Connection Pool)
                          </span>
                          <div className="text-amber-300 font-black text-sm font-mono flex items-center justify-between">
                            <span>🔌 {serverHealth.db.connections?.active || 1} / {serverHealth.db.connections?.total || 1} Đang dùng</span>
                            <span className="badge badge-sm bg-amber-950 text-amber-300 border-amber-500/40 px-2.5 py-3 rounded-xl shadow-sm">Pool Active</span>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-emerald-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-2">
                            Tổng quan Dữ liệu cốt lõi
                          </span>
                          <div className="grid grid-cols-2 gap-2 text-xs font-mono font-bold">
                            <div className="bg-emerald-950 text-emerald-300 p-2.5 rounded-xl border border-emerald-500/30 flex items-center justify-between shadow-sm">
                              <span>👥 Accounts:</span>
                              <span className="text-white font-black">{serverHealth.db.records?.users || 0}</span>
                            </div>
                            <div className="bg-blue-950 text-blue-300 p-2.5 rounded-xl border border-blue-500/30 flex items-center justify-between shadow-sm">
                              <span>🔐 Sessions:</span>
                              <span className="text-white font-black">{serverHealth.db.records?.sessions || 0}</span>
                            </div>
                            <div className="bg-purple-950 text-purple-300 p-2.5 rounded-xl border border-purple-500/30 flex items-center justify-between shadow-sm">
                              <span>🛡️ Audit Log:</span>
                              <span className="text-white font-black">{serverHealth.db.records?.audit || 0}</span>
                            </div>
                            <div className="bg-rose-950 text-rose-300 p-2.5 rounded-xl border border-rose-500/30 flex items-center justify-between shadow-sm">
                              <span>🚫 Banned IPs:</span>
                              <span className="text-white font-black">{serverHealth.db.records?.blacklistedIps || 0}</span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-emerald-500/40 transition-all shadow-inner">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                            Phiên bản Engine & Thời điểm đo
                          </span>
                          <div className="text-white font-bold text-xs font-mono">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-emerald-300 truncate" title={serverHealth.db.version}>🐘 {serverHealth.db.version || "PostgreSQL"}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-1.5 flex items-center justify-between">
                              <span>⏱️ Đo lúc:</span>
                              <strong className="text-amber-300 font-mono">{serverHealth.measuredAt ? new Date(serverHealth.measuredAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "N/A"}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-16 text-center text-emerald-400 flex flex-col items-center gap-3.5">
                        <span className="loading loading-spinner loading-md text-emerald-400"></span>
                        <span className="font-bold text-xs uppercase tracking-wide text-slate-400">Đang trích xuất dữ liệu từ Neon Postgres...</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Render slot-monitor worker */}
                <div className="bg-slate-900/90 border-2 border-slate-800/80 hover:border-orange-500/50 transition-all duration-300 rounded-[2.2rem] p-6 shadow-xl hover:shadow-2xl flex flex-col justify-between group">
                  <div>
                    <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-800/80">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-2xl bg-orange-950 border border-orange-500/40 flex items-center justify-center text-orange-400 text-lg font-bold shadow-sm group-hover:scale-110 transition-transform">
                          ☁️
                        </div>
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-orange-400">BACKGROUND WORKER</div>
                          <span className="font-black text-sm text-white">RENDER CANH SLOT</span>
                        </div>
                      </div>
                      <span className={`badge border font-black text-[10px] px-3 py-2.5 rounded-xl shadow-sm ${!serverHealth ? "bg-orange-950 text-orange-300 border-orange-500/40" : serverHealth.worker?.healthy ? "bg-emerald-950 text-emerald-300 border-emerald-500/40" : "bg-rose-950 text-rose-300 border-rose-500/40"}`}>
                        {!serverHealth ? "CHECKING" : serverHealth.worker?.healthy ? "WORKER ONLINE" : "WORKER ERROR"}
                      </span>
                    </div>

                    <div className="space-y-3.5">
                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-orange-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Trạng thái endpoint /health
                        </span>
                        <div className="flex flex-col gap-2">
                          <div className={`font-black text-sm font-mono tracking-tight flex items-center gap-2 ${!serverHealth ? "text-orange-400" : serverHealth.worker?.healthy ? "text-emerald-400" : "text-rose-400"}`}>
                            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${!serverHealth ? "bg-orange-400 animate-pulse" : serverHealth.worker?.healthy ? "bg-emerald-400 animate-ping" : "bg-rose-400"}`} />
                            {serverHealth?.worker?.healthy ? "healthy · running" : serverHealth?.worker?.error || "Đang kiểm tra..."}
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-orange-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Phản hồi Render
                        </span>
                        <div className="text-white font-bold text-xs font-mono">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-orange-300">⚡ Độ trễ probe:</span>
                            <span>{serverHealth?.worker?.latencyMs ? `${serverHealth.worker.latencyMs} ms` : "N/A"}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-1.5 flex items-center justify-between">
                            <span>Dịch vụ:</span>
                            <strong className="text-white truncate ml-2">{serverHealth?.worker?.service || "huy-locket-slot-worker"}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-orange-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Uptime worker hiện tại
                        </span>
                        <div className="text-white font-bold text-xs font-mono">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-orange-300">⏳ Đã chạy:</span>
                            <span>{serverHealth?.worker?.uptimeSeconds ? `${Math.floor(serverHealth.worker.uptimeSeconds / 3600)}h ${Math.floor((serverHealth.worker.uptimeSeconds % 3600) / 60)}p ${serverHealth.worker.uptimeSeconds % 60}s` : "N/A"}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-1.5 flex items-center justify-between">
                            <span>Bắt đầu lúc:</span>
                            <strong className="text-emerald-400 font-extrabold">{serverHealth?.worker?.startedAt ? new Date(serverHealth.worker.startedAt).toLocaleString("vi-VN") : "N/A"}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800/80 hover:border-orange-500/40 transition-all shadow-inner">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-black block mb-1.5">
                          Vai trò & chu kỳ thực
                        </span>
                        <div className="text-orange-200 font-bold text-xs font-mono flex items-center justify-between bg-slate-900 px-3 py-2 rounded-xl border border-slate-800 shadow-sm">
                          <span>⚡ Canh Slot thích ứng</span>
                          <span className="text-slate-400">30s · 10s · 1s</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section 2: Global / Targeted Broadcast Banner */}
          {advancedSubTab === "broadcast" && (
            <div className="bg-slate-950 text-slate-100 rounded-[2.5rem] p-6 sm:p-9 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] border border-slate-800/80 relative overflow-hidden animate-fade-in backdrop-blur-2xl">
              <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-blue-600/15 rounded-full blur-[140px] pointer-events-none -mt-32 -mr-32" />

              <div className="relative z-10 mb-8 pb-6 border-b border-slate-800/80">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950/80 border border-blue-500/40 text-blue-300 text-xs font-black mb-2 shadow-sm">
                  <span>📢 GLOBAL & TARGETED BROADCAST HUB</span>
                </div>
                <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-white to-indigo-200">
                  Phát Loa Thông Báo Toàn Hệ Thống
                </h3>
                <p className="text-sm text-slate-400 font-medium mt-1 max-w-3xl leading-relaxed">
                  Phát thông báo nổi bật tới toàn bộ người dùng đang trực tuyến hoặc chỉ định rõ một tài khoản nhất định. Banner thông báo sẽ tự động nổi lên trên giao diện ứng dụng của người nhận theo thời gian thực!
                </p>
              </div>

              <div className="relative z-10 space-y-6 w-full flex-1">
                <div className="bg-slate-900/90 p-6 rounded-3xl border border-slate-800/80 shadow-inner space-y-5 w-full">
                  <div>
                    <label className="label text-xs font-black uppercase text-blue-300 tracking-wider pb-2">
                      🎯 Chọn Đối Tượng Nhận Thông Báo (Mục Tiêu Phát Sóng):
                    </label>
                    <select
                      value={broadcastTarget}
                      onChange={(e) => setBroadcastTarget(e.target.value)}
                      className="select select-bordered w-full rounded-2xl font-bold text-sm bg-slate-950 text-white border-slate-800 focus:border-blue-500 h-12 shadow-sm"
                    >
                      <option value="ALL">🌐 Toàn bộ hệ thống (Tất cả người dùng trên Server)</option>
                      {users.map((u) => {
                        const label = u.displayName ? `${u.displayName} (${u.email || u.uid})` : (u.email || u.uid);
                        return (
                          <option key={u.uid || u.email} value={u.email || u.uid}>
                            👤 Cá nhân: {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="label text-xs font-black uppercase text-blue-300 tracking-wider pb-2">
                      💬 Nội Dung Bản Tin Phát Loa:
                    </label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <textarea
                        placeholder="Nhập nội dung thông báo (ví dụ: Bảo trì hệ thống lúc 23h50, vui lòng lưu giữ bài đăng...)"
                        value={broadcastMsg}
                        onChange={(e) => setBroadcastMsg(e.target.value)}
                        className="textarea textarea-bordered flex-1 font-semibold rounded-2xl min-h-[3.25rem] py-3 bg-slate-950 text-white placeholder:text-slate-500 border-slate-800 focus:border-blue-500 shadow-sm px-4 text-base"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!broadcastMsg.trim()) {
                            SonnerWarning("Vui lòng nhập nội dung thông báo trước khi phát sóng!");
                            return;
                          }
                          const action = async () => {
                            await adminRequest("/broadcast", {
                              method: "POST",
                              body: JSON.stringify({ message: broadcastMsg, active: true, targetUser: broadcastTarget }),
                            });
                            setBroadcastMsg("");
                            setBroadcastActive(true);
                            window.dispatchEvent(new Event("locket_broadcast_updated"));
                            const targetText = broadcastTarget === "ALL" ? "Toàn Server" : `riêng cho ${broadcastTarget}`;
                            SonnerSuccess(`🎉 Đã ĐĂNG và PHÁT SÓNG thông báo tới: ${targetText}!`);
                            fetchAdvancedData();
                          };
                          handleActionWithSessionCheck(action);
                        }}
                        className="btn bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-black px-8 rounded-2xl h-13 border-0 shadow-md transition-all active:scale-95 text-sm cursor-pointer"
                      >
                        🟢 Đăng & Phát Sóng Ngay
                      </button>
                    </div>
                  </div>
                </div>

                {/* Danh Sách Các Thông Báo Đã Đăng */}
                <div className="pt-6 border-t border-slate-800/80">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                      📋 Lịch Sử Thông Báo Đã Đăng (Broadcast Archive)
                    </h4>
                    <span className="badge bg-slate-900 text-slate-300 border border-slate-800 font-black text-xs px-3 py-2.5 rounded-xl">{broadcastList.length} Bản tin</span>
                  </div>

                  <div className="overflow-x-auto border border-slate-800/80 rounded-2xl bg-slate-900/90 shadow-inner max-h-96 overflow-y-auto">
                    <table className="table w-full text-sm font-medium">
                      <thead className="bg-slate-950 font-extrabold text-slate-300 uppercase text-xs tracking-wider sticky top-0 z-10 border-b border-slate-800/80">
                        <tr>
                          <th className="py-3.5 pl-5">Trạng Thái</th>
                          <th>Nội Dung</th>
                          <th>Đối Tượng</th>
                          <th>Thời Gian Đăng</th>
                          <th className="text-right pr-5">Hành Động</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-slate-300">
                        {broadcastList.length === 0 ? (
                          <tr>
                            <td colSpan="5" className="text-center py-12 text-slate-500 font-semibold">
                              Chưa có thông báo nào được ghi nhận trong cơ sở dữ liệu.
                            </td>
                          </tr>
                        ) : (
                          broadcastList.map((bItem) => {
                            const isAll = bItem.targetUser === "ALL" || bItem.targetUser === "*";
                            return (
                              <tr key={bItem.id || bItem.updatedAt} className="hover:bg-slate-800/50 transition-colors">
                                <td className="py-3.5 pl-5 font-bold">
                                  {bItem.active ? (
                                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-xs font-black bg-emerald-950 text-emerald-300 border border-emerald-500/40 shadow-sm animate-pulse">
                                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Đang Phát
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
                                      ⚪ Đã Tắt
                                    </span>
                                  )}
                                </td>
                                <td className="font-bold max-w-xs truncate text-white" title={bItem.message}>
                                  {bItem.message}
                                </td>
                                <td>
                                  <span className={`px-2.5 py-1 rounded-xl text-xs font-bold font-mono border shadow-sm ${
                                    isAll ? "bg-indigo-950 text-indigo-300 border-indigo-500/40" : "bg-purple-950 text-purple-300 border-purple-500/40"
                                  }`}>
                                    {isAll ? "🌐 Toàn Server" : `👤 ${bItem.targetUser}`}
                                  </span>
                                </td>
                                <td className="text-xs text-slate-400 font-mono font-semibold">
                                  {bItem.updatedAt ? new Date(bItem.updatedAt).toLocaleString("vi-VN") : "N/A"}
                                </td>
                                <td className="text-right whitespace-nowrap pr-5">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const action = async () => {
                                          await adminRequest("/broadcast", {
                                            method: "POST",
                                            body: JSON.stringify({ action: "toggle", id: bItem.id, active: !bItem.active }),
                                          });
                                          SonnerInfo(bItem.active ? "Đã tắt loa thông báo!" : "Đã bật lại loa thông báo!");
                                          window.dispatchEvent(new Event("locket_broadcast_updated"));
                                          fetchAdvancedData();
                                        };
                                        handleActionWithSessionCheck(action);
                                      }}
                                      className={`btn btn-xs font-extrabold rounded-xl h-8 px-3 transition-all ${
                                        bItem.active ? "bg-amber-950 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40" : "bg-emerald-950 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40"
                                      }`}
                                    >
                                      {bItem.active ? "🚫 Tắt Loa" : "🟢 Phát Lại"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const action = async () => {
                                          await adminRequest(`/broadcast/${bItem.id}`, { method: "DELETE" });
                                          SonnerInfo("Đã xóa thông báo khỏi danh sách!");
                                          window.dispatchEvent(new Event("locket_broadcast_updated"));
                                          fetchAdvancedData();
                                        };
                                        handleActionWithSessionCheck(action);
                                      }}
                                      className="btn btn-xs bg-rose-950 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-bold rounded-xl h-8 px-3 flex items-center gap-1 transition-all"
                                      title="Xóa thông báo"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" /> Xóa
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section 3: Permanent IP Blacklist */}
          {advancedSubTab === "blacklist" && (
            <div className="bg-slate-950 text-slate-100 rounded-[2.5rem] p-6 sm:p-9 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] border border-slate-800/80 relative overflow-hidden animate-fade-in backdrop-blur-2xl">
              <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-rose-600/15 rounded-full blur-[140px] pointer-events-none -mt-32 -mr-32" />

              <div className="relative z-10 mb-8 pb-6 border-b border-slate-800/80">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-950/80 border border-rose-500/40 text-rose-300 text-xs font-black mb-2 shadow-sm">
                  <span>🚫 WAF FIREWALL · PERMANENT LOCKOUT</span>
                </div>
                <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-rose-300 via-white to-amber-200">
                  Cấm Cửa Địa Chỉ IP Vĩnh Viễn
                </h3>
                <p className="text-sm text-slate-400 font-medium mt-1 max-w-3xl leading-relaxed">
                  Những địa chỉ IP nằm trong danh sách đen này sẽ bị Tường Lửa Thép Huy Locket từ chối kết nối ngay tại tầng giao thức trước khi chạm vào máy chủ Node.js, vô hiệu hóa hoàn toàn mọi truy cập của tin tặc hay spammer.
                </p>
              </div>

              <div className="relative z-10 space-y-6">
                <div className="bg-slate-900/90 p-6 rounded-3xl border border-slate-800/80 shadow-inner max-w-4xl">
                  <label className="label text-xs font-black uppercase tracking-wider text-rose-300 pb-2">
                    🔒 Phong Tỏa IP Khả Nghi Vào Danh Sách Đen:
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      placeholder="Nhập địa chỉ IP (VD: 54.196.219.221)..."
                      value={banIpInput}
                      onChange={(e) => setBanIpInput(e.target.value)}
                      className="input input-bordered w-full sm:w-72 font-mono text-sm rounded-2xl h-12 bg-slate-950 text-white placeholder:text-slate-500 border-slate-800 focus:border-rose-500 shadow-sm"
                    />
                    <input
                      type="text"
                      placeholder="Lý do phong tỏa (VD: Dội bot VPS / Tấn công dò rỉ)..."
                      value={banReasonInput}
                      onChange={(e) => setBanReasonInput(e.target.value)}
                      className="input input-bordered flex-1 text-sm rounded-2xl h-12 bg-slate-950 text-white placeholder:text-slate-500 border-slate-800 focus:border-rose-500 shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!banIpInput.trim()) return SonnerInfo("Vui lòng nhập số IP hợp lệ");
                        const action = async () => {
                          await adminRequest("/ip-blacklist", {
                            method: "POST",
                            body: JSON.stringify({ ip_address: banIpInput.trim(), reason: banReasonInput.trim() || "Cấm bởi Quản Trị Viên" }),
                          });
                          SonnerInfo(`🛑 Đã cấm vĩnh viễn IP: ${banIpInput.trim()}`);
                          setBanIpInput(""); setBanReasonInput("");
                          fetchAdvancedData();
                        };
                        handleActionWithSessionCheck(action);
                      }}
                      className="btn bg-gradient-to-r from-rose-600 via-red-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-black px-8 rounded-2xl h-12 border-0 shadow-md transition-all active:scale-95 text-sm cursor-pointer"
                    >
                      🔒 Phong Tỏa Ngay
                    </button>
                  </div>
                </div>

                <div className="pt-4">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                      📋 Lịch Sử Phong Tỏa Cấm Cửa (Active Blocklist)
                    </h4>
                    <span className="badge bg-rose-950 text-rose-300 border border-rose-500/40 font-black text-xs px-3 py-2.5 rounded-xl">{blacklistedIps.length} IP Bị Cấm</span>
                  </div>

                  <div className="overflow-x-auto border border-slate-800/80 rounded-2xl bg-slate-900/90 shadow-inner max-h-96 overflow-y-auto">
                    <table className="table w-full text-sm font-medium">
                      <thead className="bg-slate-950 font-extrabold text-slate-300 uppercase text-xs tracking-wider sticky top-0 z-10 border-b border-slate-800/80">
                        <tr>
                          <th className="py-3.5 pl-5">Địa chỉ IP</th>
                          <th>Lý do Cấm Cửa</th>
                          <th>Người thao tác</th>
                          <th>Thời gian phong tỏa</th>
                          <th className="text-right pr-5">Hành động</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-slate-300">
                        {blacklistedIps.length === 0 ? (
                          <tr>
                            <td colSpan="5" className="text-center py-12 text-slate-500 font-semibold">
                              Chưa có IP nào bị phong tỏa trong cơ sở dữ liệu. Môi trường mạng đang sạch.
                            </td>
                          </tr>
                        ) : blacklistedIps.map((b) => (
                          <tr key={b.ip_address} className="hover:bg-slate-800/50 transition-colors">
                            <td className="font-mono font-black text-rose-400 text-sm py-3.5 pl-5">
                              🚫 {b.ip_address}
                            </td>
                            <td className="text-xs font-bold text-white">{b.reason || "—"}</td>
                            <td className="font-mono text-xs text-indigo-300 font-bold">{b.blocked_by || "SUPER_ADMIN"}</td>
                            <td className="font-mono text-xs text-slate-400">{formatDateTime(b.created_at)}</td>
                            <td className="text-right pr-5">
                              <button
                                type="button"
                                onClick={async () => {
                                  const action = async () => {
                                    await adminRequest(`/ip-blacklist/${encodeURIComponent(b.ip_address)}`, { method: "DELETE" });
                                    SonnerInfo(`Đã mở cửa IP: ${b.ip_address}`);
                                    fetchAdvancedData();
                                  };
                                  handleActionWithSessionCheck(action);
                                }}
                                className="btn btn-xs bg-emerald-950 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 font-extrabold rounded-xl h-8 px-4 transition-all"
                              >
                                🔓 Mở Khóa IP
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          
            {/* Section: Whitelist */}
            {advancedSubTab === "whitelist" && (
              <div className="bg-slate-950 text-slate-100 rounded-[2.5rem] p-6 sm:p-9 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] border border-slate-800/80 relative overflow-hidden animate-fade-in backdrop-blur-2xl">
                <div className="absolute top-0 right-0 w-[450px] h-[450px] bg-emerald-600/15 rounded-full blur-[140px] pointer-events-none -mt-32 -mr-32" />

                <div className="relative z-10 mb-8 pb-6 border-b border-slate-800/80">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-black mb-2 shadow-sm">
                    <span>🛡️ WAF FIREWALL BYPASS</span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-white to-teal-200">
                    Kim Bài Miễn Tử (Danh Sách Trắng)
                  </h3>
                  <p className="text-sm text-slate-400 font-medium mt-1 max-w-3xl leading-relaxed">
                    Những tài khoản hoặc địa chỉ IP nằm trong danh sách này sẽ hoàn toàn KHÔNG BỊ BAN dưới mọi hình thức. Tường lửa WAF sẽ tự động bỏ qua kiểm tra cho họ.
                  </p>
                </div>
                
                <div className="relative z-10 space-y-6 flex-1 w-full">
                  <div className="bg-slate-900/90 p-6 rounded-3xl border border-slate-800/80 shadow-inner w-full">
                    <label className="label text-xs font-black uppercase tracking-wider text-emerald-300 pb-2">
                      🛡️ Cấp Kim Bài Miễn Tử Mới:
                    </label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <select 
                        value={whitelistType}
                        onChange={(e) => setWhitelistType(e.target.value)}
                        className="select select-bordered rounded-2xl font-bold text-sm bg-slate-950 text-white border-slate-800 focus:border-emerald-500 h-12 shadow-sm"
                      >
                        <option value="email">Email Account</option>
                        <option value="ip">IP Address</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Nhập Email hoặc IP..."
                        value={whitelistInput}
                        onChange={(e) => setWhitelistInput(e.target.value)}
                        className="input input-bordered flex-1 rounded-2xl font-bold text-sm bg-slate-950 text-white border-slate-800 focus:border-emerald-500 placeholder:text-slate-600 h-12 shadow-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && whitelistInput.trim()) {
                            document.getElementById("btn-add-whitelist").click();
                          }
                        }}
                      />
                      <button
                        id="btn-add-whitelist"
                        className="btn bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black h-12 px-6 rounded-2xl border-0 shadow-lg shadow-emerald-600/20 shrink-0 transition-all active:scale-95"
                        onClick={async () => {
                          if (!whitelistInput.trim()) return;
                          try {
                            const action = async () => {
                                await adminRequest("/whitelist", {
                                method: "POST",
                                body: JSON.stringify({ identifier: whitelistInput.trim(), type: whitelistType })
                                });
                                setWhitelistInput("");
                                const res = await adminRequest(`/whitelist?_=${Date.now()}`);
                                if (res?.list) setWhitelistItems(res.list);
                                SonnerSuccess("Đã thêm vào danh sách miễn trừ!");
                            };
                            handleActionWithSessionCheck(action);
                          } catch (error) {
                            SonnerWarning(error.message || "Lỗi thêm whitelist");
                          }
                        }}
                      >
                        ➕ Thêm Miễn Trừ
                      </button>
                    </div>
                  </div>

                  <div className="pt-4 relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                        📋 Danh Sách Miễn Trừ (Whitelist)
                      </h4>
                      <span className="badge bg-slate-900 text-slate-300 border border-slate-800 font-black text-xs px-3 py-2.5 rounded-xl">{whitelistItems.length} Mục</span>
                    </div>

                    <div className="overflow-x-auto border border-slate-800/80 rounded-2xl bg-slate-900/90 shadow-inner max-h-96 overflow-y-auto">
                      <table className="table w-full text-sm font-medium">
                        <thead className="bg-slate-950 font-extrabold text-slate-300 uppercase text-xs tracking-wider sticky top-0 z-10 border-b border-slate-800/80">
                          <tr>
                            <th className="py-3.5 pl-5">Loại Phân Loại</th>
                            <th>Định Danh (Email / IP)</th>
                            <th>Ngày Thêm</th>
                            <th className="text-right pr-5">Hành Động</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-slate-300">
                          {whitelistItems.length === 0 ? (
                            <tr>
                              <td colSpan="4" className="text-center py-12 text-slate-500 font-semibold">
                                Chưa có ai trong danh sách miễn trừ.
                              </td>
                            </tr>
                          ) : (
                            whitelistItems.map((item) => (
                              <tr key={item.identifier} className="hover:bg-slate-800/50 transition-colors">
                                <td className="py-3.5 pl-5 font-bold">
                                  <span className="badge bg-emerald-950/80 text-emerald-300 border-emerald-500/30 uppercase text-[10px] font-black px-2 py-1 rounded-lg">
                                    {item.type}
                                  </span>
                                </td>
                                <td className="font-bold text-white">
                                  {item.identifier}
                                </td>
                                <td className="font-mono text-xs text-slate-400">{new Date(item.created_at).toLocaleString("vi-VN")}</td>
                                <td className="text-right pr-5">
                                  <button
                                    onClick={async () => {
                                      if (confirm(`Gỡ ${item.identifier} khỏi danh sách miễn trừ?`)) {
                                        const action = async () => {
                                            await adminRequest(`/whitelist/${encodeURIComponent(item.identifier)}`, { method: "DELETE" });
                                            const res = await adminRequest(`/whitelist?_=${Date.now()}`);
                                            if (res?.list) setWhitelistItems(res.list);
                                            SonnerSuccess("Đã gỡ khỏi danh sách miễn trừ!");
                                        };
                                        handleActionWithSessionCheck(action);
                                      }
                                    }}
                                    className="btn btn-xs bg-rose-950/60 hover:bg-rose-600/90 text-rose-300 hover:text-white border border-rose-500/30 hover:border-rose-500/0 rounded-xl transition-all duration-300"
                                  >
                                    <Trash2 size={14} className="mr-1" /> Gỡ Bỏ
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}


            {/* Section 4: Live API & Integration Heartbeat Monitor */}
          {advancedSubTab === "heartbeat" && (
            <div className="bg-slate-950 text-slate-100 rounded-[2.5rem] p-6 sm:p-9 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] border border-slate-800/80 relative overflow-hidden animate-fade-in backdrop-blur-2xl">
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-600/15 rounded-full blur-[140px] pointer-events-none -mt-32 -mr-32" />
              <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-teal-600/15 rounded-full blur-[140px] pointer-events-none -mb-32 -ml-32" />

              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4 pb-6 border-b border-slate-800/80">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-black mb-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>REAL-TIME API RADAR · LIVE PROBE</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-white to-teal-200 flex items-center gap-2.5">
                    Trạm Giám Sát Nhịp Sống & Liên Kết API
                  </h2>
                  <p className="text-sm text-slate-400 font-medium mt-1 max-w-3xl leading-relaxed">
                    Tự động phóng các xung tín hiệu trực tiếp (Live Ping Probe) tới toàn bộ các Cổng API âm nhạc, thời tiết, định vị và máy chủ trung tâm để chẩn đoán trạng thái Sống/Chết kèm giải pháp sửa chữa tức thì.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={runApiHealthCheck}
                  disabled={testingApis}
                  className="btn btn-md bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-black border-0 shadow-md rounded-2xl px-6 h-12 shrink-0 transition-all active:scale-95 cursor-pointer text-sm"
                >
                  {testingApis ? (
                    <>
                      <span className="loading loading-spinner loading-sm text-white" />
                      <span>Đang rà soát nhịp sống...</span>
                    </>
                  ) : (
                    <>
                      <Zap size={18} className="text-yellow-300 fill-yellow-300" />
                      <span>🧪 Kiểm tra ngay (Live Ping)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Heartbeat Status Grid */}
              <div className="relative z-10">
                {apiStatuses.length === 0 ? (
                  <div className="py-20 text-center flex flex-col items-center justify-center gap-4">
                    <span className="loading loading-bars loading-lg text-emerald-400"></span>
                    <p className="text-sm font-extrabold text-emerald-300 uppercase tracking-widest">Đang thực hiện cuộc rà soát Sóng liên kết lần đầu...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {apiStatuses.map((item) => {
                      const isOnline = item.status === "ONLINE";
                      return (
                        <div
                          key={item.id}
                          className={`rounded-3xl p-6 border transition-all duration-300 flex flex-col justify-between shadow-xl relative overflow-hidden group ${
                            isOnline
                              ? "bg-slate-900/90 border-slate-800/80 hover:border-emerald-500/50 shadow-xl"
                              : "bg-slate-900/95 border-rose-500/60 shadow-xl ring-1 ring-rose-500/30 animate-fade-in"
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <h3 className="font-black text-base text-white leading-snug tracking-tight flex items-center gap-2">
                                <span>{item.name}</span>
                              </h3>
                              <span
                                className={`badge font-black px-3 py-3 rounded-xl shrink-0 text-xs shadow-sm ${
                                  isOnline
                                    ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                                    : "bg-rose-950 text-rose-300 border border-rose-500/60 animate-pulse"
                                }`}
                              >
                                {isOnline ? "🟢 ONLINE" : "🔴 OFFLINE / LỖI"}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-4 font-medium">{item.desc}</p>

                            {/* AUTOMATED DIAGNOSIS & REMEDY GUIDE */}
                            <div className={`rounded-2xl p-4 mb-5 border transition-all shadow-sm ${
                              isOnline
                                ? "bg-slate-950/90 border-slate-800 text-slate-300 hover:border-slate-700"
                                : "bg-rose-950/30 border-rose-800/60 text-rose-200"
                            }`}>
                              <div className="flex items-center gap-2 text-xs font-black mb-2">
                                <span className="text-base">{isOnline ? "💡" : "🚨"}</span>
                                <span className={isOnline ? "text-indigo-300 uppercase tracking-wider text-[11px]" : "text-amber-300 uppercase tracking-wider text-xs underline decoration-rose-500 decoration-2"}>
                                  {isOnline ? "Hướng dẫn bảo trì dự phòng:" : "Chẩn đoán Lỗi & Cách xử lý ngay:"}
                                </span>
                              </div>
                              <p className="text-xs leading-relaxed mb-3 text-slate-300 font-medium">
                                <strong className={isOnline ? "text-teal-400 font-black uppercase text-[11px]" : "text-rose-400 font-black uppercase text-[11px]"}>Nguyên nhân: </strong> 
                                {item.errorHelp}
                              </p>
                              <div className="text-xs font-bold text-amber-200 bg-amber-950/60 p-3 rounded-xl border border-amber-500/40 leading-relaxed flex items-start gap-2 shadow-sm">
                                <span className="text-base shrink-0">🛠️</span>
                                <div>
                                  <strong className="text-amber-300 font-black uppercase text-[11px] block underline mb-0.5">Giải pháp chẩn đoán:</strong>
                                  <span className="text-slate-200 font-normal">{item.remedy}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono font-bold">
                            <span className="flex items-center gap-2 text-slate-400">
                              <span>⏱️ RTT Latency:</span>
                              <span className={`px-2 py-1 rounded-lg border ${
                                item.ping < 300 
                                  ? "bg-emerald-950 text-emerald-400 border-emerald-500/40 font-black" 
                                  : "bg-amber-950 text-amber-300 border-amber-500/40 font-black"
                              }`}>
                                {item.ping} ms
                              </span>
                            </span>
                            <span className={`font-black px-2.5 py-1 rounded-xl border font-mono shadow-sm ${
                              isOnline ? "text-slate-300 bg-slate-900 border-slate-800" : "text-rose-300 bg-rose-950 border-rose-500/40"
                            }`}>
                              {item.httpStatus}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="relative z-10 mt-8 bg-gradient-to-r from-emerald-950/90 via-teal-950/90 to-slate-900 border border-emerald-500/40 rounded-2xl p-4 text-xs text-slate-300 flex items-center gap-3.5 font-medium shadow-lg">
                <span className="text-2xl shrink-0">🛡️</span>
                <span className="leading-relaxed">
                  <strong className="text-emerald-300 font-black uppercase text-[11px] tracking-wider block mb-0.5">Huy Locket API Guard Note:</strong> 
                  Các dịch vụ có nhãn <code className="bg-emerald-950 px-2 py-0.5 rounded-lg text-emerald-300 font-mono font-bold border border-emerald-500/40 shadow-sm">CORS Guard</code> hoặc trả về HTTP Status (&lt; 500) đều đồng nghĩa máy chủ đầu xa đang mở cổng kết nối và phản hồi các tiến trình Locket một cách hoàn toàn bình thường theo đúng chuẩn bảo mật trình duyệt.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL CHI TIẾT USER & LỊCH SỬ ĐĂNG NHẬP */}
      {selectedUser && typeof document !== "undefined" && createPortal(
        <div className="modal modal-open modal-bottom sm:modal-middle z-[99990] overscroll-contain p-2 sm:p-4" onClick={() => setSelectedUser(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-user-detail-title"
            className="modal-box max-w-5xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-3xl p-6 sm:p-8 shadow-2xl border-2 border-primary/20 bg-base-100"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="btn btn-sm btn-circle btn-ghost absolute right-5 top-5 text-base-content/60 hover:bg-base-200" onClick={() => setSelectedUser(null)}>✕</button>
            <h3 id="admin-user-detail-title" className="font-black text-xl mb-1.5 flex items-center gap-2.5 text-base-content">
              {userName(selectedUser)}
              {roleBadge(selectedUser.role)}
            </h3>
            <p className="text-sm font-medium text-base-content/70">{selectedUser.email || selectedUser.username || "Không có email/username"}</p>
            <p className="text-xs text-base-content/40 mb-6 font-mono">UID: {selectedUser.uid}</p>

            {selectedUser.role === "super_admin" || selectedUser.email?.toLowerCase() === "buiduchuy2010qn@gmail.com" ? (
              <div className="alert alert-info bg-primary/15 border-2 border-primary/40 text-primary mb-6 text-sm rounded-2xl font-semibold shadow-inner flex items-center gap-3">
                <Shield size={24} className="shrink-0 animate-pulse text-primary" />
                <span>👑 <strong>Quyền lực Tối thượng Cố định (Immutable Super Admin)</strong>: Tài khoản này được bảo vệ ở cấp độ cao nhất. Không bất kỳ ai (kể cả chính tài khoản này) có thể tự hạ vai trò, khóa truy cập hay thu hồi phiên làm việc.</span>
              </div>
            ) : selectedUser.uid === currentUserUid ? (
              <div className="alert alert-warning bg-secondary/15 border-2 border-secondary/40 text-secondary mb-6 text-sm rounded-2xl font-semibold shadow-inner">
                <span>👤 <strong>Tài khoản chính bạn (Self Protected)</strong>: Để chống tự khóa hỏng quyền truy cập điều hành, bạn không thể tự thu hồi hay khóa tài khoản của chính mình từ giao diện này.</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 mb-6 bg-base-200/50 p-3 rounded-2xl border border-base-200">
                {currentRole !== "support" && currentRole !== "moderator" && (
                  <>
                    <button type="button" className={`btn btn-sm rounded-xl font-bold px-4 ${selectedUser.disabled ? "btn-success shadow-sm" : "btn-warning shadow-sm"}`} onClick={() => setActionModal({ type: selectedUser.disabled ? "unlock" : "lock", user: selectedUser, reason: "" })}>
                      {selectedUser.disabled ? <Unlock size={15} /> : <Lock size={15} />}
                      {selectedUser.disabled ? "Mở khóa truy cập web" : "Khóa truy cập web"}
                    </button>
                    <button type="button" className="btn btn-sm btn-outline btn-error rounded-xl font-bold px-4" onClick={() => setActionModal({ type: "revoke", user: selectedUser, reason: "" })}>
                      Thu hồi toàn bộ phiên web
                    </button>
                  </>
                )}
                {currentRole === "super_admin" && (
                  <button type="button" className="btn btn-sm btn-outline btn-secondary rounded-xl font-bold px-4" onClick={() => setActionModal({ type: "role", user: selectedUser, newRole: selectedUser.role || "user", reason: "" })}>
                    Gán vai trò RBAC
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-7 text-sm">
              <div className="bg-base-200/70 rounded-2xl p-4 border border-base-300/60 flex items-center gap-2.5"><Clock size={18} className="text-primary shrink-0" /> <span className="text-xs text-base-content/70">Đăng nhập: <strong className="text-base-content block text-sm mt-0.5">{formatDateTime(selectedUser.lastSignInTime)}</strong></span></div>
              <div className="bg-base-200/70 rounded-2xl p-4 border border-base-300/60 flex items-center gap-2.5"><Activity size={18} className="text-success shrink-0" /> <span className="text-xs text-base-content/70">Trang thái: <strong className="text-base-content block text-sm mt-0.5">{isOnline(selectedUser) ? `Đang hoạt động · ${selectedUser.activeSessions} phiên` : relativeActivity(selectedUser.lastSeenAt)}</strong></span></div>
              <div className="bg-base-200/70 rounded-2xl p-4 border border-base-300/60 flex items-center gap-2.5"><Monitor size={18} className="text-secondary shrink-0" /> <span className="text-xs text-base-content/70">Nguồn web: <strong className="text-base-content font-mono block text-sm mt-0.5">{sourceLabel(selectedUser.webSource)}</strong></span></div>
            </div>

            <div className="flex items-center justify-between gap-3 mb-3 border-b border-base-200 pb-3">
              <h4 className="font-extrabold text-base flex items-center gap-2"><Clock size={18} className="text-primary" /> Lịch sử đăng nhập & Phiên web chi tiết</h4>
              {(currentRole === "super_admin" || currentRole === "admin") && (
                <button
                  type="button"
                  className={`btn btn-xs btn-error rounded-xl font-bold px-3 h-8 gap-1.5 ${clearHistoryConfirm ? "animate-pulse btn-active shadow-md" : "btn-outline"}`}
                  onClick={async () => {
                    if (!clearHistoryConfirm) {
                      setClearHistoryConfirm(true);
                      return;
                    }
                    const fn = async () => {
                      const data = await adminRequest(`/users/${encodeURIComponent(selectedUser.uid)}/login-history`, { method: "DELETE" });
                      setHistory([]);
                      setHistoryState("empty");
                      setClearHistoryConfirm(false);
                      SonnerInfo(`Đã xóa ${data.deleted || 0} sự kiện đăng nhập`);
                    };
                    await handleActionWithSessionCheck(fn);
                  }}
                  disabled={historyState === "loading" || history.length === 0}
                >
                  <Trash2 size={14} />
                  {clearHistoryConfirm ? "Xác nhận xóa lịch sử ngay!" : "Xóa lịch sử"}
                </button>
              )}
            </div>

            {historyState === "loading" ? (
              <div className="py-12 text-center"><span className="loading loading-spinner loading-md text-primary" /></div>
            ) : historyState === "error" ? (
              <div className="alert alert-error text-sm rounded-2xl"><AlertTriangle size={16} /><span>{historyError}</span></div>
            ) : historyState === "empty" ? (
              <div className="alert text-sm bg-base-200/50 border-base-200 rounded-2xl font-medium"><Info size={16} className="text-primary" /><span>Chưa có lịch sử đăng nhập được ghi nhận từ khi bộ máy giám sát kích hoạt.</span></div>
            ) : (
              <div className="overflow-x-auto max-h-[420px] rounded-2xl border border-base-300 shadow-inner bg-base-100">
                <table className="table table-sm w-full">
                  <thead><tr className="bg-base-200 text-xs font-bold sticky top-0 z-10"><th>Thời gian</th><th>IP máy chủ</th><th>Vị trí (GPS / IP)</th><th>Trình duyệt / thiết bị</th><th>Phương thức</th><th>Build / Commit</th><th>Nguồn</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {history.map((entry) => {
                      const entryOnline = !entry.ended_at && Date.now() - new Date(entry.last_seen_at).getTime() <= onlineWindowSeconds * 1000;
                      return (
                        <tr key={entry.event_id || entry.session_id} className="hover">
                          <td className="whitespace-nowrap text-xs font-medium">{formatDateTime(entry.created_at)}</td>
                          <td className="font-mono text-xs font-bold text-primary">{entry.ip_address || UNKNOWN}</td>
                          <td><span className="inline-flex items-center font-semibold gap-1 text-xs"><MapPin size={11} className="text-secondary shrink-0" /> {entry.gps_coordinates ? "📍 Đã bật GPS (" + entry.gps_coordinates + ")" : "🌐 Vị trí IP (gần đúng): " + ([entry.city, entry.region, entry.country].filter((v) => v && v !== UNKNOWN).join(", ") || UNKNOWN)}</span></td>
                          <td><span className="font-bold text-xs">{entry.browser || UNKNOWN} {entry.browser_version && entry.browser_version !== UNKNOWN ? entry.browser_version : ""}</span><br /><span className="text-[11px] text-base-content/60">{entry.os || UNKNOWN} · {entry.device || UNKNOWN}</span></td>
                          <td><span className="badge badge-ghost font-mono badge-xs py-2 px-2">{loginMethodLabel(entry.login_method)}</span></td>
                          <td className="font-mono text-xs">{entry.web_version || "—"}<br /><span className="text-[10px] text-base-content/50">{entry.commit_hash || entry.build_id || "—"}</span></td>
                          <td><span className="badge badge-outline badge-xs font-mono font-bold py-2 px-2">{sourceLabel(entry.web_source)}</span></td>
                          <td>{entry.ended_at ? <span className="badge badge-ghost badge-xs font-medium py-2 px-2">Đã kết thúc</span> : entryOnline ? <span className="badge badge-success font-bold badge-xs text-success-content py-2 px-2 shadow-sm">Đang hoạt động</span> : <span className="badge badge-warning font-bold badge-xs py-2 px-2">Mất heartbeat</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* MODAL BẮT BUỘC NHẬP LÝ DO CHO THAO TÁC QUẢN TRỊ NHẠY CẢM */}
      {actionModal && typeof document !== "undefined" && createPortal(
        <div className="modal modal-open modal-bottom sm:modal-middle z-[100000] overscroll-contain" onClick={() => setActionModal(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-action-modal-title"
            className="modal-box max-w-lg rounded-3xl p-6 border border-base-300 shadow-2xl bg-base-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="admin-action-modal-title" className="font-black text-lg flex items-center gap-2 text-error mb-2">
              <AlertTriangle className="text-error" size={22} /> Xác nhận Thao tác Quản trị
            </h3>
            <p className="text-sm text-base-content/80 mb-5 font-medium leading-relaxed">
              Bạn đang thực hiện thao tác <strong className="uppercase text-primary font-bold">{actionModal.type}</strong> đối với tài khoản <strong>{userName(actionModal.user)}</strong> — <strong>{actionModal.user?.email || "không có email"}</strong> — UID: <strong>{actionModal.user?.uid}</strong>. Hành động này sẽ được ghi nhận vào nhật ký Audit Log vĩnh viễn.
            </p>

            {actionModal.type === "role" && (
              <div className="form-control mb-5">
                <label className="label font-extrabold text-xs tracking-wide uppercase text-base-content/70">CHỌN VAI TRÒ RBAC:</label>
                <select
                  className="select select-bordered w-full rounded-2xl font-bold text-sm h-12 border-secondary/40 focus:border-secondary"
                  value={actionModal.newRole}
                  onChange={(e) => setActionModal({ ...actionModal, newRole: e.target.value })}
                >
                  <option value="super_admin">👑 Super Admin - Toàn quyền quản trị tối cao</option>
                  <option value="admin">🛡️ Admin - Quản lý user & thu hồi phiên</option>
                  <option value="moderator">⚖️ Moderator - Chỉ xử lý nội dung vi phạm</option>
                  <option value="support">🎧 Support - Chỉ xem dữ liệu hỗ trợ cơ bản</option>
                  <option value="user">👤 User - Người dùng Locket Web thông thường</option>
                </select>
              </div>
            )}

            <div className="form-control mb-7">
              <label className="label font-extrabold text-xs tracking-wide uppercase text-base-content/70">
                <span>LÝ DO BẮT BUỘC (LƯU VÀO AUDIT LOG):</span>
              </label>
              <textarea
                className="textarea textarea-bordered h-28 rounded-2xl text-sm p-3.5 border-base-300 focus:border-primary shadow-inner font-medium"
                placeholder="Ví dụ: Phát hiện nghi vấn xâm phạm, Thay đổi nhiệm vụ nhân sự, Theo yêu cầu Super Admin..."
                value={actionModal.reason}
                onChange={(e) => setActionModal({ ...actionModal, reason: e.target.value })}
                autoFocus
              />
            </div>

            <div className="modal-action flex items-center justify-end gap-2.5 pt-2 border-t border-base-200">
              <button type="button" className="btn btn-sm btn-ghost rounded-xl px-5 font-bold" onClick={() => setActionModal(null)}>Hủy bỏ</button>
              <button
                type="button"
                className={`btn btn-sm btn-primary rounded-xl px-7 font-extrabold h-10 shadow-md ${Boolean(actionLoading) ? "loading" : ""}`}
                onClick={executeModalAction}
                disabled={Boolean(actionLoading)}
              >
                Xác nhận & Thực thi
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* MODAL XÁC MINH LẠI MÃ PIN KHI ĐÃ HẾT HẠN PHIÊN NHẠY CẢM */}
      {reauthModalOpen && (
        <div className="modal modal-open modal-bottom sm:modal-middle" onClick={() => setReauthModalOpen(false)}>
          <div className="modal-box max-w-md rounded-3xl p-6 border-2 border-primary/40 shadow-2xl bg-base-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black text-lg flex items-center gap-2 text-primary mb-2">
              🔐 Xác Minh Lại Mã PIN Quản Trị
            </h3>
            <p className="text-xs text-base-content/70 leading-relaxed mb-4 font-medium">
              Phiên thao tác quản trị 30 phút của bạn đã hết hạn. Để tiếp tục thực hiện lệnh nhạy cảm cho <strong>{currentEmail || "Tài khoản của bạn"}</strong>, vui lòng xác minh lại bằng Mã PIN số bảo mật.
            </p>

            {reauthError && (
              <div className="alert alert-error text-xs py-2 mb-4 rounded-xl font-medium">
                <AlertTriangle size={16} className="shrink-0" /> <span>{reauthError}</span>
              </div>
            )}

            <form onSubmit={handleReauthSubmit} className="space-y-4">
              <div className="form-control">
                <label className="label text-[11px] font-extrabold text-base-content/70 tracking-wider uppercase">MÃ PIN SỐ BẢO MẬT (4 - 8 SỐ)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  required
                  placeholder="Nhập mã PIN của bạn..."
                  className="input input-bordered w-full rounded-2xl pr-10 shadow-inner text-sm h-11 font-bold tracking-widest text-center text-lg border-primary/30 focus:border-primary"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value.replace(/[^0-9]/g, ""))}
                  disabled={reauthLoading}
                  autoFocus
                />
              </div>

              <div className="modal-action flex items-center justify-end gap-2 pt-3 border-t border-base-200">
                <button type="button" className="btn btn-sm btn-ghost rounded-xl px-4 font-bold" onClick={() => { setReauthModalOpen(false); setPendingCallback(null); }} disabled={reauthLoading}>Hủy bỏ</button>
                <button type="submit" className="btn btn-sm btn-primary rounded-xl px-6 font-extrabold h-10 shadow-md" disabled={reauthLoading || !reauthPassword.trim()}>
                  {reauthLoading ? <span className="loading loading-spinner loading-xs" /> : "Xác minh & Tiếp tục thao tác"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ĐỔI MÃ PIN QUẢN TRỊ VIÊN */}
      {changePinModalOpen && (
        <div className="modal modal-open modal-bottom sm:modal-middle" onClick={() => setChangePinModalOpen(false)}>
          <div className="modal-box max-w-md rounded-3xl p-6 border-2 border-primary/40 shadow-2xl bg-base-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black text-lg flex items-center gap-2 text-primary mb-2">
              🔑 Đổi Mã PIN Số Bảo Mật Quản Trị
            </h3>
            <p className="text-xs text-base-content/70 leading-relaxed mb-4 font-medium">
              Bạn có thể tự do thay đổi Mã PIN số bảo mật dành riêng cho khu vực quản trị viên tại đây.
            </p>

            {changePinError && (
              <div className="alert alert-error text-xs py-2 mb-4 rounded-xl font-medium">
                <AlertTriangle size={16} className="shrink-0" /> <span>{changePinError}</span>
              </div>
            )}

            <form onSubmit={handleChangePinSubmit} className="space-y-4">
              <div className="form-control">
                <label className="label text-[11px] font-extrabold text-base-content/70 tracking-wider uppercase">MÃ PIN HIỆN TẠI (CŨ)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  required
                  placeholder="Nhập mã PIN hiện tại..."
                  className="input input-bordered w-full rounded-2xl shadow-inner text-sm h-11 font-bold tracking-widest text-center text-lg border-base-300 focus:border-primary"
                  value={changePinOld}
                  onChange={(e) => setChangePinOld(e.target.value.replace(/[^0-9]/g, ""))}
                  disabled={changePinLoading}
                  autoFocus
                />
              </div>

              <div className="form-control">
                <label className="label text-[11px] font-extrabold text-base-content/70 tracking-wider uppercase">MÃ PIN SỐ MỚI (4 - 8 CHỮ SỐ)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  required
                  placeholder="Nhập mã PIN số mới..."
                  className="input input-bordered w-full rounded-2xl shadow-inner text-sm h-11 font-bold tracking-widest text-center text-lg border-primary/40 focus:border-primary text-primary"
                  value={changePinNew}
                  onChange={(e) => setChangePinNew(e.target.value.replace(/[^0-9]/g, ""))}
                  disabled={changePinLoading}
                />
              </div>

              <div className="modal-action flex items-center justify-end gap-2 pt-3 border-t border-base-200">
                <button type="button" className="btn btn-sm btn-ghost rounded-xl px-4 font-bold" onClick={() => setChangePinModalOpen(false)} disabled={changePinLoading}>Hủy bỏ</button>
                <button type="submit" className="btn btn-sm btn-primary rounded-xl px-6 font-extrabold h-10 shadow-md" disabled={changePinLoading || !changePinOld.trim() || !changePinNew.trim()}>
                  {changePinLoading ? <span className="loading loading-spinner loading-xs" /> : "Lưu Mã PIN Mới"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL QUẢN LÝ VÀ HỖ TRỢ KHÔI PHỤC MẬT KHẨU */}
      {passwordStatusModal && (
        <div className="modal modal-open modal-bottom sm:modal-middle" onClick={() => setPasswordStatusModal(null)}>
          <div className="modal-box max-w-lg rounded-3xl p-6 sm:p-7 shadow-2xl border-2 border-info/30 bg-base-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-base-200">
              <h3 className="font-black text-lg text-info flex items-center gap-2">🔑 Kiểm tra & Hỗ trợ Mật Khẩu</h3>
              <button type="button" className="btn btn-sm btn-circle btn-ghost" onClick={() => setPasswordStatusModal(null)}>✕</button>
            </div>
            <div className="py-4 space-y-4 text-sm">
              <div>
                <span className="text-xs text-base-content/60 font-bold uppercase block">Hồ sơ người dùng</span>
                <p className="font-bold text-base-content text-base mt-0.5">{passwordStatusModal.displayName}</p>
                <p className="text-xs font-mono text-primary mt-0.5">{passwordStatusModal.email}</p>
              </div>
              <div className="bg-base-200/70 p-3.5 rounded-2xl border border-base-300">
                <span className="text-xs text-secondary font-bold block mb-1">🛡️ Trạng Thái & Quyền Trợ Giúp:</span>
                <p className="text-xs text-base-content/80 leading-relaxed font-medium">{passwordStatusModal.policy}</p>
              </div>
              {passwordStatusModal.canResetViaFirebase ? (
                <div className="alert alert-success/20 border border-success/30 rounded-2xl py-3 text-xs font-semibold text-success-content flex items-center gap-2">
                  <span>✅ Email chính chủ hợp lệ. Bất cứ khi nào người dùng quên mật khẩu, họ có thể dùng nút Khôi Phục ở Màn Đăng Nhập hoặc liên hệ Admin gởi cổng bảo mật.</span>
                </div>
              ) : (
                <div className="alert alert-error/20 border border-error/30 rounded-2xl py-3 text-xs font-semibold text-error flex items-center gap-2">
                  <span>⚠️ Tài khoản này chưa gắn Email chuẩn. Yêu cầu liên hệ trực tiếp Admin Huy để cập nhật email trước khi reset.</span>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button type="button" onClick={() => setPasswordStatusModal(null)} className="btn btn-primary rounded-xl font-bold px-6 w-full">Đã rõ</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CÀI ĐẶT 2FA GOOGLE AUTHENTICATOR FOR ADMIN */}
      {setup2FAOpen && (
        <div className="modal modal-open modal-bottom sm:modal-middle" onClick={() => setSetup2FAOpen(false)}>
          <div className="modal-box max-w-lg rounded-3xl p-6 sm:p-7 border-2 border-emerald-500/40 shadow-2xl bg-white text-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-black text-lg text-emerald-700 flex items-center gap-2">
                <Shield className="w-6 h-6 text-emerald-600" />
                <span>Cài Đặt Xác Thực 2 Yếu Tố (2FA - Google Auth)</span>
              </h3>
              <button type="button" className="btn btn-sm btn-circle btn-ghost text-slate-500 hover:bg-slate-100" onClick={() => setSetup2FAOpen(false)}>✕</button>
            </div>

            <div className="py-4 space-y-4 text-sm">
              <div className="text-xs bg-emerald-50/90 text-emerald-900 p-4 rounded-2xl border border-emerald-200 leading-relaxed font-semibold">
                🛡️ <strong>Bảo vệ Quản Trị Viên:</strong> Tính năng này ĐỘC QUYỀN cho Admin Huy Locket. Khi bật 2FA, sau khi nhập mã PIN bạn sẽ cần nhập mã OTP 6 số trên ứng dụng <strong>Google Authenticator</strong> hoặc <strong>Authy</strong> thì mới mở được trang quản trị.
              </div>

              {setup2FAError && (
                <div className="alert bg-rose-50 border border-rose-200 text-rose-800 text-xs py-2.5 px-3.5 rounded-xl font-bold flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0 text-rose-600" />
                  <span>{setup2FAError}</span>
                </div>
              )}

              {setup2FALoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3">
                  <span className="loading loading-spinner loading-lg text-emerald-600" />
                  <span className="text-xs font-bold text-slate-500">Đang sinh mã QR Code bảo mật từ máy chủ...</span>
                </div>
              ) : setup2FAData ? (
                <section className="space-y-4">
                  {(setup2FAData.is2FAEnabled || is2FAEnabled) ? (
                    <article className="p-6 bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-400 rounded-3xl text-emerald-950 flex flex-col items-center justify-center gap-4 text-center shadow-sm">
                      <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-700 flex items-center justify-center shadow-inner">
                        <CheckCircle size={36} className="text-emerald-600 drop-shadow" />
                      </div>
                      <header className="space-y-1">
                        <h4 className="text-base font-black uppercase tracking-wider text-emerald-900">Bảo Mật 2FA Đang Hoạt Động</h4>
                        <p className="text-xs text-emerald-800 font-medium max-w-sm">
                          Tài khoản Quản Trị Viên của bạn đang được bảo vệ an toàn 100% bằng mã OTP từ <strong>Google Authenticator / Authy</strong>. Mã vạch QR đã được ẩn để đảm bảo an toàn.
                        </p>
                      </header>

                      {disable2FAConfirmMode ? (
                        <form
                          onSubmit={(e) => { e.preventDefault(); handleDisable2FA(); }}
                          className="w-full max-w-xs space-y-3 mt-1"
                        >
                          <label className="text-[11px] font-black text-rose-800 uppercase tracking-wider block text-left">
                            ⚠️ NHẬP MÃ OTP 6 SỐ ĐỂ XÁC NHẬN TẮT 2FA:
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={6}
                              placeholder="000000"
                              className="input input-bordered flex-1 rounded-2xl text-center text-xl font-mono font-black tracking-[0.4em] bg-white text-rose-950 border-rose-300 focus:border-rose-600 focus:bg-white h-11 shadow-inner"
                              value={disable2FAOtp}
                              onChange={(e) => setDisable2FAOtp(e.target.value.replace(/[^0-9]/g, ""))}
                              disabled={setup2FALoading}
                              autoFocus
                            />
                            <button
                              type="submit"
                              className="btn btn-sm bg-rose-600 hover:bg-rose-700 text-white border-0 rounded-2xl px-4 font-black shadow-md h-11"
                              disabled={setup2FALoading || disable2FAOtp.length !== 6}
                            >
                              {setup2FALoading ? "Đang xử lý..." : "Xác Nhận Tắt"}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setDisable2FAConfirmMode(false); setDisable2FAOtp(""); setSetup2FAError(null); }}
                            className="btn btn-ghost btn-xs text-slate-500 font-bold w-full"
                          >
                            Hủy bỏ
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setDisable2FAConfirmMode(true); setSetup2FAError(null); }}
                          disabled={setup2FALoading}
                          className="btn btn-sm bg-rose-600 hover:bg-rose-700 text-white border-0 rounded-2xl px-6 font-black tracking-wide shadow-md transition-transform active:scale-95 mt-2"
                        >
                          Tắt Ký Quyền 2FA
                        </button>
                      )}
                    </article>
                  ) : (
                    <section className="space-y-4">
                      <article className="flex flex-col items-center justify-center bg-slate-50 p-5 rounded-3xl border border-slate-200 shadow-inner">
                        <header className="mb-3 text-center">
                          <h4 className="text-[11px] font-black tracking-widest text-indigo-950 uppercase">1. QUÉT MÃ QR BẰNG GOOGLE AUTHENTICATOR</h4>
                        </header>
                        {setup2FAData.qrCode && (
                          <img src={setup2FAData.qrCode} alt="2FA QR Code" className="w-48 h-48 rounded-2xl shadow-sm border bg-white p-2.5 hover:scale-105 transition-transform" />
                        )}
                        <footer className="mt-3 text-center w-full max-w-xs">
                          <span className="text-xs text-slate-500 font-bold block mb-1">Hoặc nhập thủ công khóa bí mật này:</span>
                          <code className="bg-white px-3 py-2 rounded-xl border font-mono font-black text-indigo-700 text-sm tracking-widest select-all shadow-sm block text-center truncate">
                            {setup2FAData.secret}
                          </code>
                        </footer>
                      </article>

                      <form onSubmit={(e) => { e.preventDefault(); handleConfirm2FA(); }} className="space-y-2 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                        <label className="label text-[11px] font-black text-slate-700 uppercase tracking-wider block">
                          2. NHẬP MÃ OTP 6 SỐ TỪ ỨNG DỤNG ĐỂ KÍCH HOẠT:
                        </label>
                        <div className="flex gap-2.5">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6}
                            placeholder="000000"
                            className="input input-bordered flex-1 rounded-2xl text-center text-2xl font-mono font-black tracking-[0.4em] bg-slate-50 text-indigo-950 border-slate-300 focus:border-emerald-600 focus:bg-white h-12 shadow-inner"
                            value={setup2FAOtp}
                            onChange={(e) => setSetup2FAOtp(e.target.value.replace(/[^0-9]/g, ""))}
                          />
                          <button
                            type="submit"
                            className="btn bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black px-6 border-0 shadow-md h-12"
                            disabled={setup2FALoading || setup2FAOtp.length !== 6}
                          >
                            Kích Hoạt Ngay
                          </button>
                        </div>
                      </form>
                    </section>
                  )}
                </section>
              ) : null}
            </div>

            <div className="modal-action border-t border-slate-200 pt-3">
              <button type="button" onClick={() => setSetup2FAOpen(false)} className="btn btn-ghost text-slate-600 rounded-xl font-bold w-full">Đóng cửa sổ</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
