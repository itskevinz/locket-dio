const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { locketServices, proxy } = require("../config/app.config");

const defaultBaseUrl =
  locketServices?.mainApi || "https://api.locketcamera.com";
const proxyUrl = proxy?.locketProxy || process.env.LOCKET_HTTP_PROXY;

const getDirectHeaders = ({ idToken, appCheckToken } = {}) => {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Language": "en-US",
    "X-Ios-Bundle-Identifier": "com.locket.Locket",
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

  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  if (appCheckToken) {
    headers["X-Firebase-AppCheck"] = appCheckToken;
  }

  return headers;
};

const createDirectClient = (customConfig = {}) => {
  const axiosConfig = {
    baseURL: customConfig.baseURL || defaultBaseUrl,
    timeout: customConfig.timeout || 30000,
    ...customConfig,
  };

  if (proxyUrl) {
    axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
    axiosConfig.proxy = false;
  }

  const rawAxios = axios.create(axiosConfig);

  return {
    async post(endpoint, body, options = {}) {
      const idToken = options?.meta?.idToken;
      const appCheckToken = options?.meta?.appCheckToken;
      const headers = {
        ...getDirectHeaders({ idToken, appCheckToken }),
        ...(options?.headers || {}),
      };

      const {
        meta: _meta,
        idToken: _id,
        appCheckToken: _app,
        ...restOptions
      } = options || {};

      const requestOptions = {
        ...restOptions,
        headers,
      };

      return rawAxios.post(endpoint, body, requestOptions);
    },

    async get(endpoint, options = {}) {
      const idToken = options?.meta?.idToken;
      const appCheckToken = options?.meta?.appCheckToken;
      const headers = {
        ...getDirectHeaders({ idToken, appCheckToken }),
        ...(options?.headers || {}),
      };

      const {
        meta: _meta,
        idToken: _id,
        appCheckToken: _app,
        ...restOptions
      } = options || {};

      const requestOptions = {
        ...restOptions,
        headers,
      };

      return rawAxios.get(endpoint, requestOptions);
    },
  };
};

const instanceLocketDirect = createDirectClient();

module.exports = {
  instanceLocketDirect,
  createDirectClient,
  getDirectHeaders,
};
