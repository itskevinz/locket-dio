const axios = require("axios");
const { getDioPublicApiKey } = require("../config/dioPublicApi");

const DEFAULT_CELEBRITY_CATALOG_URL =
  "https://data.locket-dio.com/v1/public/getAllCelebrateV2";
const FALLBACK_CELEBRITY_CATALOG_URL =
  "https://data.locket-dio.com/v1/public/getAllCelebrate";
const CATALOG_TIMEOUT_MS = 12000;
const MAX_ADDITIONAL_SOURCES = 8;

function catalogError(message, cause = null) {
  const error = new Error(message);
  error.code = "CELEBRITY_UPSTREAM_UNAVAILABLE";
  if (cause) error.cause = cause;
  return error;
}

function requiredText(value) {
  return String(value || "").trim();
}

function flattenCatalogResponse(payload) {
  if (Array.isArray(payload)) {
    return payload.map((record) => ({ record, category: null }));
  }

  if (!payload || typeof payload !== "object") {
    throw catalogError("Celebrity catalog response is not a list or category map");
  }

  const flattened = [];
  for (const [category, records] of Object.entries(payload)) {
    if (!Array.isArray(records)) continue;
    records.forEach((record) => flattened.push({ record, category }));
  }

  return flattened;
}

function normalizeUpstreamCatalog(payload) {
  const flattened = flattenCatalogResponse(payload);
  const seenUids = new Set();
  const seenUsernames = new Set();
  const normalized = [];

  for (const { record, category } of flattened) {
    if (record?.active !== true) continue;

    const uid = requiredText(record.uid);
    const username = requiredText(record.username);
    const usernameKey = username.toLowerCase();
    if (!uid || !username || seenUids.has(uid) || seenUsernames.has(usernameKey)) {
      continue;
    }

    const countryCode = (
      requiredText(record.country_code) || requiredText(category) || "OTHER"
    )
      .toUpperCase()
      .slice(0, 8);

    // TEST rows are upstream fixtures, not real public Celebrity profiles.
    if (countryCode === "TEST") continue;

    seenUids.add(uid);
    seenUsernames.add(usernameKey);
    normalized.push({
      uid,
      username,
      display_name: requiredText(record.note || record.display_name) || username,
      avatar_url: requiredText(record.avatar_url) || null,
      locket_url:
        requiredText(record.locket_url) ||
        `https://locket.cam/${encodeURIComponent(username)}`,
      country_code: countryCode || "OTHER",
      sort_order: normalized.length,
    });
  }

  if (flattened.length > 0 && normalized.length === 0) {
    throw catalogError("Celebrity catalog contained no valid active profiles");
  }

  return normalized;
}

function getCelebrityCatalogUrl() {
  return (
    String(process.env.DIO_CELEBRITY_CATALOG_URL || "").trim() ||
    DEFAULT_CELEBRITY_CATALOG_URL
  );
}

function getAdditionalCelebrityCatalogUrls() {
  const configured = String(process.env.CELEBRITY_CATALOG_URLS || "");
  const unique = new Set();

  for (const rawUrl of configured.split(/[\r\n,]+/)) {
    const value = rawUrl.trim();
    if (!value) continue;

    try {
      const url = new URL(value);
      if (url.protocol !== "https:") continue;
      unique.add(url.toString());
    } catch {
      // Ignore malformed operator configuration instead of breaking the catalog.
    }

    if (unique.size >= MAX_ADDITIONAL_SOURCES) break;
  }

  return [...unique];
}

function mergeVerifiedCatalogs(catalogs) {
  const seenUids = new Set();
  const seenUsernames = new Set();
  const merged = [];

  for (const catalog of catalogs) {
    for (const profile of catalog) {
      const usernameKey = profile.username.toLowerCase();
      if (seenUids.has(profile.uid) || seenUsernames.has(usernameKey)) continue;
      seenUids.add(profile.uid);
      seenUsernames.add(usernameKey);
      merged.push({ ...profile, sort_order: merged.length });
    }
  }

  return merged;
}

function isDioCatalogUrl(value) {
  try {
    return new URL(value).hostname === "data.locket-dio.com";
  } catch {
    return false;
  }
}

function createCelebrityCatalogSource(http = axios) {
  if (!http || typeof http.get !== "function") {
    throw new TypeError("Celebrity catalog source requires an HTTP client");
  }

  async function fetchCatalog(url) {
    const headers = { Accept: "application/json" };
    if (isDioCatalogUrl(url)) {
      Object.assign(headers, {
        "x-api-key": getDioPublicApiKey(),
        "x-app-author": "dio",
        "x-app-name": "locketdio",
        "x-app-client": "Web",
        "x-app-api": "v1",
        "x-app-env": "production",
      });
    }

    let response;
    try {
      response = await http.get(url, {
        headers,
        timeout: CATALOG_TIMEOUT_MS,
        validateStatus: () => true,
      });
    } catch (error) {
      throw catalogError("Celebrity catalog request failed", error);
    }

    if (response.status < 200 || response.status >= 300) {
      const error = catalogError("Celebrity catalog request was rejected");
      error.status = response.status;
      throw error;
    }

    return normalizeUpstreamCatalog(response.data);
  }

  async function fetchPrimaryCatalog() {
    const primaryUrl = getCelebrityCatalogUrl();
    try {
      return await fetchCatalog(primaryUrl);
    } catch (primaryError) {
      if (primaryUrl === FALLBACK_CELEBRITY_CATALOG_URL) throw primaryError;
      return fetchCatalog(FALLBACK_CELEBRITY_CATALOG_URL);
    }
  }

  async function fetchVerified() {
    const requests = [fetchPrimaryCatalog()];
    for (const url of getAdditionalCelebrityCatalogUrls()) {
      requests.push(fetchCatalog(url));
    }

    const results = await Promise.allSettled(requests);
    const successful = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (successful.length === 0) {
      const firstFailure = results.find((result) => result.status === "rejected");
      throw firstFailure?.reason || catalogError("All Celebrity sources failed");
    }

    return mergeVerifiedCatalogs(successful);
  }

  return { fetchVerified };
}

module.exports = {
  createCelebrityCatalogSource,
  getAdditionalCelebrityCatalogUrls,
  getCelebrityCatalogUrl,
  mergeVerifiedCatalogs,
  normalizeUpstreamCatalog,
};
