// config/app.config.js

const serverConfig = {
  appConfig: { port: process.env.PORT || 5000 },

  supabaseConfig: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "locket-4252a",
    // Locket Identity Toolkit key — set FIREBASE_API_KEY in Railway/Render/.env (never commit).
    apiKey: process.env.FIREBASE_API_KEY || "",
    apiBase: {
      appCheck:
        process.env.FIREBASE_APPCHECK_API_BASE ||
        "https://firebaseappcheck.googleapis.com",
      auth:
        process.env.FIREBASE_AUTH_API_BASE ||
        "https://www.googleapis.com/identitytoolkit/v3/relyingparty",
      firestore:
        process.env.FIREBASE_FIRESTORE_API_BASE ||
        "https://firestore.googleapis.com/v1/projects/locket-4252a/databases",
      secureToken:
        process.env.FIREBASE_SECURETOKEN_API_BASE ||
        "https://securetoken.googleapis.com",
    },
  },

  firebaseStorage: {
    buckets: {
      image: "locket-img",
      video: "locket-video",
    },
    baseUrl: "https://firebasestorage.googleapis.com/v0/b",
  },

  security: {
    cookieSecret: process.env.COOKIE_SECRET,
    jwtSecret: process.env.LOCKETDIO_JWT_SECRET,
    signatureSecret: process.env.LOCKETDIO_SIGNATURE_SECRET,
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    },
  },

  integrations: {
    weatherApiKey: process.env.WEATHER_API_KEY,
  },

  services: {
    storageUrl: process.env.STORAGE_API_URL || "https://storage.locket-dio.com",
    redisUrl: process.env.REDIS_URL,
  },

  locketServices: {
    mainApi: process.env.LOCKET_API_BASE || "https://api.locketcamera.com",
  },

  limits: {
    maxUploadSize: Number(process.env.MAX_UPLOAD_SIZE) || 150, // MB
    maxVideoSizeMB: Number(process.env.MAX_VIDEO_SIZE_MB) || 5,
    maxVideoSizeBytes:
      (Number(process.env.MAX_VIDEO_SIZE_MB) || 5) * 1024 * 1024,
    // Generic large-media fallback. Images use the dedicated 10 MB cap below.
    maxSizeAllowedFree: Number(process.env.MAX_SIZE_ALLOWED_FREE) || 24,
    maxImageSize: Number(process.env.MAX_IMAGE_SIZE) || 10, // MB per source image
  },

  cache: {
    user: Number(process.env.CACHE_USER_TTL) || 300,
  },

  proxy: {
    locketProxy: process.env.LOCKET_HTTP_PROXY,
  },

  deviceToken: {
    appcheckToken: process.env.LOCKET_APP_CHECK_DEVICE_TOKEN,
    deviceId: process.env.LOCKET_APP_CHECK_DEVICE_ID,
  }
};

module.exports = serverConfig;
