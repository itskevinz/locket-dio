const axios = require("axios");
const constants = require("../../../utils/constants");
const { firebase } = require("../../../config/app.config");

/**
 * Axios client instance for interacting with standard Firestore REST APIs.
 */
const instanceFirestore = axios.create({
  baseURL: firebase.apiBase.firestore,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": constants.USER_AGENT,
    "X-Ios-Bundle-Identifier": constants.IOS_BUNDLE_ID,
  },
});

instanceFirestore.interceptors.request.use((config) => {
  if (config.meta?.idToken) {
    config.headers.Authorization = `Bearer ${config.meta.idToken}`;
  }
  return config;
});

/**
 * Axios client instance for uploading file buffers to Firebase Storage via resumable upload URLs.
 */
const instanceFirestoreUpload = axios.create({
  headers: {
    "content-type": "application/octet-stream",
    "x-goog-upload-protocol": "resumable",
    "x-goog-upload-offset": "0",
    "x-goog-upload-command": "upload, finalize",
    "upload-incomplete": "?0",
    "upload-draft-interop-version": "3",
    "user-agent": "com.locket.Locket/2.8.0 iPhone/17.7 hw/iPhone15_3 (GTMSUF/1)",
  },
});

/**
 * Axios client instance for initiating resumable upload sessions to Firebase Storage.
 */
const instanceFirestoreInit = axios.create({
  headers: {
    "content-type": "application/json; charset=UTF-8",
    "x-goog-upload-protocol": "resumable",
    accept: "*/*",
    "x-goog-upload-command": "start",
    "accept-language": "vi-VN,vi;q=0.9",
    "x-firebase-storage-version": "ios/10.13.0",
    "user-agent": "com.locket.Locket/2.8.0 iPhone/17.3 hw/iPhone15_3 (GTMSUF/1)",
    "x-firebase-gmpid": "1:641029076083:ios:cc8eb46290d69b234fa609",
  },
});

instanceFirestoreInit.interceptors.request.use((config) => {
  if (config.meta?.idToken) {
    config.headers.Authorization = `Bearer ${config.meta.idToken}`;
  }
  if (config.meta?.fileSize) {
    config.headers["x-goog-upload-content-length"] = config.meta.fileSize;
  }
  if (config.meta?.contentType) {
    config.headers["x-goog-upload-content-type"] = config.meta.contentType;
  }
  return config;
});

/**
 * Axios client instance for fetching metadata/download tokens of uploaded files from Firebase Storage.
 */
const instanceFirestoreGet = axios.create({
  headers: {
    "content-type": "application/json; charset=UTF-8",
    baggage: "sentry-environment=production,sentry-public_key=78fa64317f434fd89d9cc728dd168f50,sentry-release=com.locket.Locket%401.121.1%2B1,sentry-trace_id=2cdda588ea0041ed93d052932b127a3e",
    accept: "*/*",
    "accept-language": "vi-VN,vi;q=0.9",
    "user-agent": "com.locket.Locket/1.43.1 iPhone/17.3 hw/iPhone15_3 (GTMSUF/1)",
    "x-firebase-gmpid": "1:641029076083:ios:cc8eb46290d69b234fa609",
  },
});

instanceFirestoreGet.interceptors.request.use((config) => {
  if (config.meta?.idToken) {
    config.headers.Authorization = `Bearer ${config.meta.idToken}`;
  }
  return config;
});

module.exports = {
  instanceFirestore,
  instanceFirestoreInit,
  instanceFirestoreUpload,
  instanceFirestoreGet,
};
