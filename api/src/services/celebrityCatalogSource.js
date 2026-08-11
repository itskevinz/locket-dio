const axios = require("axios");
const { getDioPublicApiKey } = require("../config/dioPublicApi");

const DEFAULT_CELEBRITY_CATALOG_URL =
  "https://data.locket-dio.com/v1/public/getAllCelebrate";
const CATALOG_TIMEOUT_MS = 12000;

function catalogError(message, cause = null) {
  const error = new Error(message);
  error.code = "CELEBRITY_UPSTREAM_UNAVAILABLE";
  if (cause) error.cause = cause;
  return error;
}

function requiredText(value) {
  return String(value || "").trim();
}

function normalizeUpstreamCatalog(records) {
  if (!Array.isArray(records)) {
    throw catalogError("Celebrity catalog response is not an array");
  }

  const seenUids = new Set();
  const normalized = [];

  for (const record of records) {
    if (record?.active !== true) continue;

    const uid = requiredText(record.uid);
    const username = requiredText(record.username);
    if (!uid || !username || seenUids.has(uid)) continue;

    seenUids.add(uid);
    const displayName = requiredText(record.note) || username;
    const countryCode =
      requiredText(record.country_code).toUpperCase().slice(0, 8) || "OTHER";

    normalized.push({
      uid,
      username,
      display_name: displayName,
      avatar_url: null,
      locket_url: `https://locket.cam/${encodeURIComponent(username)}`,
      country_code: countryCode,
      sort_order: normalized.length,
    });
  }

  if (records.length > 0 && normalized.length === 0) {
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

function createCelebrityCatalogSource(http = axios) {
  if (!http || typeof http.get !== "function") {
    throw new TypeError("Celebrity catalog source requires an HTTP client");
  }

  async function fetchVerified() {
    let response;
    try {
      response = await http.get(getCelebrityCatalogUrl(), {
        headers: {
          Accept: "application/json",
          "x-api-key": getDioPublicApiKey(),
          "x-app-author": "dio",
          "x-app-name": "locketdio",
          "x-app-client": "Web",
          "x-app-api": "v1",
          "x-app-env": "production",
        },
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

  return { fetchVerified };
}

module.exports = {
  createCelebrityCatalogSource,
  getCelebrityCatalogUrl,
  normalizeUpstreamCatalog,
};
