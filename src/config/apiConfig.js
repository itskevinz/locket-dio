import { CONFIG } from "./webConfig";

// Chat server host (REST + Socket). Self-host may use relative proxy "/dio-api".
export const BASE_SERVER_HOST = CONFIG.api.baseUrl;
// Socket.IO phải đi thẳng tới host hỗ trợ upgrade/polling lâu dài.
// Vercel rewrite phù hợp REST nhưng không ổn định cho kết nối realtime.
const configuredSocketHost = import.meta.env.VITE_SOCKET_API_URL;
const dedicatedVercelSocketHost =
  "https://huy-locket-api-huy-locket.vercel.app/api/socket-io";
export const SOCKET_SERVER_HOST =
  import.meta.env.PROD && (!configuredSocketHost || configuredSocketHost === "/dio-api")
    ? dedicatedVercelSocketHost
    : configuredSocketHost || BASE_SERVER_HOST;
export const BETA_SERVER_HOST = import.meta.env.VITE_BETA_API_URL;
// Namespace
export const API_NAMESPACE = {
  main: "/api",
  locket: "/locket",
  chat: "/chat",
};

/**
 * Socket.IO config.
 * - Absolute URL (official): io("https://api.locket-dio.com") path=/socket.io
 * - Relative proxy (Huy Locket): io(origin) path=/dio-api/socket.io
 *   (io("/dio-api") would be treated as a namespace and hit SPA /socket.io → broken)
 */
export function resolveSocketIoConfig(base = BASE_SERVER_HOST) {
  const raw = (base || "/dio-api").trim();
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    const prefix = parsed.pathname.replace(/\/$/, "");
    return {
      url: parsed.origin,
      path: `${prefix}/socket.io` || "/socket.io",
    };
  }
  const prefix = raw.startsWith("/") ? raw.replace(/\/$/, "") : `/${raw.replace(/\/$/, "")}`;
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return {
    url: origin || undefined,
    path: `${prefix}/socket.io`,
  };
}

// Endpoints
export const API_ENDPOINTS = {
  socketUrl: SOCKET_SERVER_HOST,
  get socketIo() {
    return resolveSocketIoConfig(SOCKET_SERVER_HOST);
  },
};


export const PUBLIC_API = {
  feeds: "v1/public/feeds",
  donations: "v1/public/donations",
  timelines: "v1/public/timelines",
  frames: "v1/public/myframes",
  backgroundList: "v1/public/getAllbackgrounds",
  celebrates: "v1/public/getAllCelebrate",
  celebratesV2: "v1/public/getAllCelebrateV2",
  notifications: "v1/public/notification",
  plans: "v1/public/dio-plans",
  themes: "v1/public/themes",
  getOverlaysV2: "v1/public/getAllOverlaysV2",
  incidents: "v1/public/getAllIncident",
  collection: "v1/public/getAllCollections"
};
