const crypto = require("crypto");

const SERVICE = "s3";
const DEFAULT_REGION = "auto";
const DEFAULT_PREFIX = "huy-locket/temp";

function clean(value) {
  return String(value || "").trim();
}

function getConfig() {
  const accountId = clean(process.env.R2_ACCOUNT_ID);
  const accessKeyId = clean(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(process.env.R2_SECRET_ACCESS_KEY);
  const bucket = clean(process.env.R2_BUCKET);
  const region = clean(process.env.R2_REGION) || DEFAULT_REGION;
  const endpoint = (
    clean(process.env.R2_ENDPOINT) ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")
  ).replace(/\/$/, "");
  const prefix = (clean(process.env.R2_PREFIX) || DEFAULT_PREFIX)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
    endpoint,
    prefix,
  };
}

function isConfigured() {
  const cfg = getConfig();
  return Boolean(
    cfg.endpoint &&
      cfg.accessKeyId &&
      cfg.secretAccessKey &&
      cfg.bucket,
  );
}

function encodeSegment(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectKey(key) {
  return String(key)
    .split("/")
    .filter(Boolean)
    .map(encodeSegment)
    .join("/");
}

function objectKey(id) {
  const cfg = getConfig();
  const safeId = String(id || "").replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safeId) throw new Error("R2 object id is required");
  return cfg.prefix ? `${cfg.prefix}/${safeId}` : safeId;
}

function buildObjectUrl(key) {
  const cfg = getConfig();
  if (!cfg.endpoint || !cfg.bucket) {
    throw new Error("R2 endpoint/bucket is not configured");
  }

  const endpoint = new URL(cfg.endpoint);
  const basePath = endpoint.pathname.replace(/\/$/, "");
  endpoint.pathname = `${basePath}/${encodeSegment(cfg.bucket)}/${encodeObjectKey(key)}`;
  endpoint.search = "";
  return endpoint;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function signingKey(secret, dateStamp, region) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

function formatAmzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function signRequest(method, key, payloadHash) {
  const cfg = getConfig();
  if (!isConfigured()) throw new Error("R2 is not configured");

  const url = buildObjectUrl(key);
  const { amzDate, dateStamp } = formatAmzDate();
  const scope = `${dateStamp}/${cfg.region}/${SERVICE}/aws4_request`;
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaderNames = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(cfg.secretAccessKey, dateStamp, cfg.region),
    stringToSign,
    "hex",
  );

  return {
    url: url.toString(),
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  };
}

async function putBuffer(id, buffer, contentType = "application/octet-stream") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("R2 upload buffer is empty");
  }

  const key = objectKey(id);
  const signed = signRequest("PUT", key, sha256Hex(buffer));
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: {
      ...signed.headers,
      "Content-Type": contentType || "application/octet-stream",
    },
    body: buffer,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `R2 PUT failed (${response.status})${text ? `: ${text.slice(0, 160)}` : ""}`,
    );
  }

  return { key, size: buffer.length, contentType };
}

async function getBuffer(id) {
  const key = objectKey(id);
  const emptyHash = sha256Hex(Buffer.alloc(0));
  const signed = signRequest("GET", key, emptyHash);
  const response = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `R2 GET failed (${response.status})${text ? `: ${text.slice(0, 160)}` : ""}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return {
    buffer,
    size: buffer.length,
    contentType:
      response.headers.get("content-type") || "application/octet-stream",
    key,
  };
}

async function deleteObject(id) {
  const key = objectKey(id);
  const emptyHash = sha256Hex(Buffer.alloc(0));
  const signed = signRequest("DELETE", key, emptyHash);
  const response = await fetch(signed.url, {
    method: "DELETE",
    headers: signed.headers,
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `R2 DELETE failed (${response.status})${text ? `: ${text.slice(0, 160)}` : ""}`,
    );
  }

  return { success: true, key, missing: response.status === 404 };
}

module.exports = {
  isConfigured,
  objectKey,
  putBuffer,
  getBuffer,
  deleteObject,
};
