/**
 * Huy Locket API — backend chính (từ Server-Locket-Dio)
 */
const dotenv = require("dotenv");
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const isVercel = Boolean(process.env.VERCEL);
const isProd = process.env.NODE_ENV === "production";
dotenv.config({ path: isProd ? ".env.production" : ".env.development" });
dotenv.config();

const { logInfo, logGroupWrapper } = require("./src/utils/logEventUtils.js");
const routes = require("./src/routes");
const initChatSocket = require("./src/socket");
const errorHandler = require("./src/middlewares/errorHandler.js");
const { printServerBanner } = require("./src/utils/printServerBanner.js");
const { antiBotMiddleware, globalDDoSShield, wafSecurityShield } = require("./src/middlewares/antiBot.js");
const { securityHeaders } = require("./src/middlewares/securityHeaders.js");
const { requireJsonContentType, sanitizeBodyStrings, validateUploadBuffer, ALLOWED_IMAGE_MIMES, ALLOWED_VIDEO_MIMES } = require("./src/middlewares/payloadValidation.js");
const { startSlotMonitorWorker } = require("./src/modules/slotMonitor");
const { deepHealthController } = require("./src/controllers/systemController.js");

const allowedMediaMimes = new Set([...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES]);

const {
  connectRedis,
  pubClient,
  subClient,
} = require("./src/clients/redis/socketRedis.js");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

const extraOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
  /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
  /^https?:\/\/(\w+\.)*locket-dio\.space$/,
  /^https?:\/\/(\w+\.)*locket-dio\.com$/,
  /^https?:\/\/([\w-]+\.)*web\.app$/,
  /^https?:\/\/([\w-]+\.)*onrender\.com$/,
  /^https?:\/\/([\w-]+\.)*up\.railway\.app$/,
  /^https?:\/\/([\w-]+\.)*railway\.app$/,
  /^https?:\/\/([\w-]+\.)*huy-locket\./,
  /^https?:\/\/([\w-]+\.)*vercel\.app$/,
];

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (extraOrigins.includes(origin)) return true;
  return allowedOriginPatterns.some((re) => re.test(origin));
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true);
    console.warn("[CORS] blocked:", origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Api-Key",
    "x-api-key",
    "X-App-Name",
    "x-app-name",
    "X-App-Author",
    "x-app-author",
    "X-App-Client",
    "x-app-client",
    "X-App-Api",
    "x-app-api",
    "X-App-Env",
    "x-app-env",
    "X-LocketDio-Member",
    "x-locketdio-member",
    "X-Local-Id",
    "X-User-Email",
    "X-Admin-Session",
    "X-Trust-Device-Token",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const io = new Server(server, {
  path: "/socket.io/",
  cors: corsOptions,
});

(async () => {
  try {
    if (!process.env.REDIS_URL && isProd) {
      console.warn("[Redis] REDIS_URL chưa set — Socket.IO chạy single-instance (không multi-node).");
    }
    await connectRedis();
    try {
      const { createAdapter } = require("@socket.io/redis-adapter");
      io.adapter(createAdapter(pubClient, subClient));
      console.log("✅ Socket.IO Redis adapter connected");
    } catch (e) {
      console.warn("[Redis] adapter skip:", e.message);
    }
  } catch (err) {
    if (err?.code === "REDIS_OPTIONAL_SKIP") {
      console.log("ℹ️ Redis: optional skip (single-instance socket)");
    } else {
      console.error("❌ Redis failed (server vẫn chạy, socket single-node):", err.message || err);
    }
  }
})();

io.use((socket, next) => {
  const ip = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
  console.log(`🔌 Socket connection from ${ip}`);
  next();
});
initChatSocket(io);

app.use(globalDDoSShield);
app.get("/health/deep", deepHealthController);
app.use(antiBotMiddleware);
app.use(securityHeaders);
app.use(cookieParser());

const {
  mediaUpload,
  mediaTempGet,
} = require("./src/modules/storage/storage.controller");
app.put(
  "/api/media-upload/:id",
  express.raw({ type: "*/*", limit: "25mb" }),
  validateUploadBuffer({ maxBytes: 25 * 1024 * 1024, allowedMimes: allowedMediaMimes }),
  mediaUpload,
);
app.get("/api/media-temp/:id", mediaTempGet);

const { verifyIdToken } = require("./src/middlewares/Auth");
const {
  draftsController,
  draftUploadLimiter,
} = require("./src/modules/drafts");
app.put(
  "/api/drafts/:id/media/:role",
  express.raw({ type: "*/*", limit: "95mb" }),
  validateUploadBuffer({ maxBytes: 95 * 1024 * 1024, allowedMimes: allowedMediaMimes }),
  verifyIdToken,
  draftUploadLimiter,
  draftsController.uploadMedia,
);

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));
app.use(requireJsonContentType);
app.use(sanitizeBodyStrings);
app.use(wafSecurityShield);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      success: false,
      status: 400,
      error: {
        code: "INVALID_JSON",
        message: "Body JSON không hợp lệ",
        path: req.originalUrl,
      },
    });
  }
  next(err);
});

app.use(logGroupWrapper);
app.get("/api/meta", (_req, res) => {
  res.json({
    status: "success",
    name: "Huy Locket API",
    version: "1.0.0",
    env: process.env.NODE_ENV || "development",
    host: isVercel ? "vercel" : "node",
  });
});

routes(app);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5007;

if (!isVercel) {
  server.listen(PORT, "0.0.0.0", () => {
    logInfo("SERVER", `🚀 Huy Locket API đang chạy tại http://0.0.0.0:${PORT}`);
    printServerBanner({
      isProd: process.env.NODE_ENV === "production",
      PORT,
    });
    startSlotMonitorWorker();
  });

  process.on("unhandledRejection", (err) => {
    console.error("[unhandledRejection]", err?.message || err);
  });

  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err?.message || err);
  });
}

function applyVercelForwardedPath(req) {
  if (!isVercel) return;
  const parsed = new URL(req.url || "/", "http://vercel.local");
  const forwarded = parsed.searchParams.get("__path");
  if (!forwarded) return;
  parsed.searchParams.delete("__path");
  const query = parsed.searchParams.toString();
  req.url = `${forwarded.startsWith("/") ? forwarded : `/${forwarded}`}${query ? `?${query}` : ""}`;
}

function vercelHandler(req, res) {
  applyVercelForwardedPath(req);
  return app(req, res);
}

module.exports = isVercel ? vercelHandler : { app, server };
