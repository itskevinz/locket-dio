const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { locketServices } = require("../config/app.config");
const { proxy } = require("../config/app.config");
const { tryDioFriendFallback } = require("./dioFriendCompat");

const proxyUrl = proxy.locketProxy;

const loginHeader = {
  "Content-Type": "application/json",
  "Accept-Language": "en-US",
  "X-Ios-Bundle-Identifier": "com.locket.Locket",
  baggage:
    "sentry-environment=production,sentry-public_key=78fa64317f434fd89d9cc728dd168f50,sentry-release=com.locket.Locket%401.121.1%2B1,sentry-trace_id=2cdda588ea0041ed93d052932b127a3e",
  "sentry-trace": "2cdda588ea0041ed93d052932b127a3e-a3e2ba7a095d4f9d-0",
  "User-Agent":
    "FirebaseAuth.iOS/10.23.1 com.locket.Locket/2.8.0 iPhone/18.0 hw/iPhone12_1",
  "X-Client-Version": "iOS/FirebaseSDK/10.23.1/FirebaseCore-iOS",
  "X-Firebase-GMPID":
    process.env.LOCKET_X_FIREBASE_GMPID ||
    "1:641029076083:ios:cc8eb46290d69b234fa606",
  "X-Firebase-Client":
    process.env.LOCKET_X_FIREBASE_CLIENT ||
    "H4sIAAAAAAAAAKtWykhNLCpJSk0sKVayio7VUSpLLSrOzM9TslIyUqoFAFyivEQfAAAA",
};

// Optional FCM / AppCheck — set via env, never hardcode live tokens.
if (process.env.LOCKET_FCM_INSTANCE_ID_TOKEN) {
  loginHeader["Firebase-Instance-ID-Token"] =
    process.env.LOCKET_FCM_INSTANCE_ID_TOKEN;
}

const instanceLocketV2 = axios.create({
  baseURL: locketServices.mainApi,
  timeout: 30000,
  headers: {
    ...loginHeader,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Interceptor: thêm token động trước mỗi request.
instanceLocketV2.interceptors.request.use(
  (config) => {
    // ✅ Proxy (áp dụng cho mọi request Locket)
    if (proxyUrl) {
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
      config.proxy = false; // 🔥 tránh axios override
    }

    // ✅ Auth token
    const token = config?.meta?.idToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // ✅ App Check token only. A DeviceCheck token is an attestation input that
    // must first be exchanged with Firebase; it is not a valid X-Firebase-AppCheck value.
    const appCheckToken =
      config?.meta?.appCheckToken || process.env.LOCKET_APP_CHECK_TOKEN || "";
    if (appCheckToken) {
      config.headers["X-Firebase-AppCheck"] = appCheckToken;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// Locket currently rejects friend/follow mutations when our self-hosted server
// has no usable App Check source. Dio's current public client routes these two
// operations through its beta backend. Reproduce that behavior server-side so
// browsers do not hit cross-origin/CORS issues. The fallback is only attempted
// after Locket itself returns 401/403 and only when explicitly enabled.
instanceLocketV2.interceptors.response.use(
  (response) => response,
  async (error) => {
    const fallbackResponse = await tryDioFriendFallback(error);
    if (fallbackResponse) return fallbackResponse;
    return Promise.reject(error);
  },
);

module.exports = { instanceLocketV2 };
