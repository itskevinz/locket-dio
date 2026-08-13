const express = require("express");
const crypto = require("crypto");
const path = require("path");

const router = express.Router();
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://duchi.vercel.app").replace(/\/$/, "");
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.COOKIE_SECRET || process.env.LOCKETDIO_SIGNATURE_SECRET || crypto.createHash("sha256").update("huy-locket-vercel-drive").digest("hex");
const ADMIN_EMAILS = new Set(String(process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || "buiduchuy2010qn@gmail.com").split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean));
const ADMIN_IDS = new Set(String(process.env.ADMIN_LOCAL_IDS || process.env.VITE_ADMIN_LOCAL_IDS || "y82fIv1QyDXLrMZ012MKYoYmAVz2").split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean));

let sqlClient = null;
let driveConfigCache = null;
let accessTokenCache = { token: "", exp: 0 };
let folderCache = { root: "", image: "", video: "" };

function dbUrl() {
  const raw = String(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.searchParams.delete("channel_binding");
    if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "require");
    return url.toString();
  } catch {
    return raw;
  }
}

async function sql() {
  if (sqlClient) return sqlClient;
  const url = dbUrl();
  if (!url) throw new Error("Thiếu DATABASE_URL/NEON_DATABASE_URL trên Vercel");
  const { neon } = await import("@neondatabase/serverless");
  sqlClient = neon(url);
  await sqlClient`
    CREATE TABLE IF NOT EXISTS gdrive_config (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      folder_id TEXT,
      oauth_client_id TEXT,
      oauth_client_secret TEXT,
      oauth_refresh_token TEXT,
      oauth_email TEXT,
      service_account_json JSONB,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT
    )`;
  return sqlClient;
}

async function readConfig(force = false) {
  if (driveConfigCache && !force) return driveConfigCache;
  const db = await sql();
  const rows = await db`SELECT * FROM gdrive_config WHERE id = 1 LIMIT 1`;
  const row = rows?.[0];
  driveConfigCache = row ? {
    folderId: row.folder_id || "",
    oauth: {
      clientId: row.oauth_client_id || "",
      clientSecret: row.oauth_client_secret || "",
      refreshToken: row.oauth_refresh_token || "",
      email: row.oauth_email || "",
    },
    serviceAccount: row.service_account_json || undefined,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || "",
  } : {};
  return driveConfigCache;
}

async function saveConfig(cfg) {
  const db = await sql();
  const serviceAccountJson = cfg.serviceAccount ? JSON.stringify(cfg.serviceAccount) : null;
  await db`
    INSERT INTO gdrive_config (
      id, folder_id, oauth_client_id, oauth_client_secret, oauth_refresh_token,
      oauth_email, service_account_json, updated_at, updated_by
    ) VALUES (
      1, ${String(cfg.folderId || "")}, ${String(cfg.oauth?.clientId || "")},
      ${String(cfg.oauth?.clientSecret || "")}, ${String(cfg.oauth?.refreshToken || "")},
      ${String(cfg.oauth?.email || "")}, ${serviceAccountJson}::jsonb, NOW(),
      ${String(cfg.updatedBy || "vercel")}
    )
    ON CONFLICT (id) DO UPDATE SET
      folder_id = EXCLUDED.folder_id,
      oauth_client_id = EXCLUDED.oauth_client_id,
      oauth_client_secret = EXCLUDED.oauth_client_secret,
      oauth_refresh_token = EXCLUDED.oauth_refresh_token,
      oauth_email = EXCLUDED.oauth_email,
      service_account_json = EXCLUDED.service_account_json,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by`;
  driveConfigCache = cfg;
  accessTokenCache = { token: "", exp: 0 };
  folderCache = { root: "", image: "", video: "" };
  return cfg;
}

function isAdmin(req) {
  const email = String(req.headers["x-user-email"] || req.headers["x-email"] || "").trim().toLowerCase();
  const id = String(req.headers["x-local-id"] || req.headers["x-userid"] || "").trim();
  return (email && ADMIN_EMAILS.has(email)) || (id && ADMIN_IDS.has(id));
}

function b64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signState(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + 60 * 60_000 }));
  const sig = crypto.createHmac("sha256", STATE_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(state) {
  try {
    const [body, sig] = String(state || "").split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", STATE_SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

async function getAccessToken(cfg) {
  if (accessTokenCache.token && Date.now() < accessTokenCache.exp - 60_000) return accessTokenCache.token;
  const oauth = cfg?.oauth || {};
  if (!oauth.clientId || !oauth.clientSecret || !oauth.refreshToken) throw new Error("Google Drive OAuth chưa sẵn sàng");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: oauth.clientId, client_secret: oauth.clientSecret, refresh_token: oauth.refreshToken, grant_type: "refresh_token" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "OAuth refresh failed");
  accessTokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

async function ensureRootFolder(token, preferredId) {
  if (preferredId) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(preferredId)}?fields=id,name,mimeType,trashed`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (r?.ok) {
      const m = await r.json();
      if (m.id && !m.trashed && String(m.mimeType).includes("folder")) return m.id;
    }
  }
  const q = "name='Huy Locket Web' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents";
  const list = await fetch(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,name)", pageSize: "5", spaces: "drive" })}`, { headers: { authorization: `Bearer ${token}` } });
  const listed = await list.json().catch(() => ({}));
  if (list.ok && listed.files?.[0]?.id) return listed.files[0].id;
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Huy Locket Web", mimeType: "application/vnd.google-apps.folder" }),
  });
  const created = await create.json().catch(() => ({}));
  if (!create.ok || !created.id) throw new Error(created?.error?.message || "Không tạo được folder Drive");
  return created.id;
}

async function ensureSubfolder(token, rootId, name) {
  if (folderCache.root === rootId && folderCache[name === "Video" ? "video" : "image"]) return folderCache[name === "Video" ? "video" : "image"];
  const q = `name='${name}' and '${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await fetch(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,name)", pageSize: "5" })}`, { headers: { authorization: `Bearer ${token}` } });
  const data = await list.json().catch(() => ({}));
  let id = list.ok ? data.files?.[0]?.id : "";
  if (!id) {
    const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [rootId] }),
    });
    const made = await create.json().catch(() => ({}));
    if (!create.ok || !made.id) throw new Error(made?.error?.message || `Không tạo được folder ${name}`);
    id = made.id;
  }
  folderCache.root = rootId;
  folderCache[name === "Video" ? "video" : "image"] = id;
  return id;
}

async function uploadBuffer(token, rootId, buffer, contentType, filename, mediaType) {
  const isVideo = mediaType === "video" || String(contentType).startsWith("video/");
  const parentId = await ensureSubfolder(token, rootId, isVideo ? "Video" : "Ảnh");
  const boundary = `----HuyLocket${Date.now()}`;
  const metadata = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: filename, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([metadata, buffer, tail]);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,parents", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Drive upload HTTP ${response.status}`);
  return { ...data, folder: isVideo ? "Video" : "Ảnh" };
}

router.get("/drive-status", async (req, res) => {
  try {
    const cfg = await readConfig();
    const configured = Boolean(cfg.folderId && cfg.oauth?.clientId && cfg.oauth?.clientSecret && cfg.oauth?.refreshToken);
    if (!isAdmin(req)) return res.json({ configured, enabled: configured, isAdmin: false, adminOnly: true });
    return res.json({
      configured,
      enabled: configured,
      isAdmin: true,
      adminOnly: true,
      authMode: cfg.oauth?.refreshToken ? "oauth" : "none",
      folderId: cfg.folderId || null,
      folderUrl: cfg.folderId ? `https://drive.google.com/drive/folders/${cfg.folderId}` : null,
      oauthEmail: cfg.oauth?.email || null,
      hasOauthClient: Boolean(cfg.oauth?.clientId && cfg.oauth?.clientSecret),
      hasRefreshToken: Boolean(cfg.oauth?.refreshToken),
      neon: true,
      source: "neon",
      oauthCallbackUrl: `${PUBLIC_URL}/api/drive-oauth-callback`,
      host: "vercel",
    });
  } catch (e) {
    return res.status(503).json({ configured: false, enabled: false, neon: false, host: "vercel", error: e.message });
  }
});

router.post("/drive-config", express.json({ limit: "1mb" }), async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Chỉ admin mới cấu hình được Google Drive" });
  try {
    const prev = await readConfig();
    const body = req.body || {};
    const cfg = {
      ...prev,
      folderId: String(body.folderId || prev.folderId || "").trim().replace(/^.*\/folders\//, "").replace(/[?#].*$/, ""),
      oauth: {
        clientId: String(body.clientId || body.oauthClientId || prev.oauth?.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim(),
        clientSecret: String(body.clientSecret || body.oauthClientSecret || prev.oauth?.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim(),
        refreshToken: String(body.refreshToken || prev.oauth?.refreshToken || process.env.GOOGLE_OAUTH_REFRESH_TOKEN || "").trim(),
        email: String(prev.oauth?.email || "").trim(),
      },
      updatedBy: String(req.headers["x-user-email"] || req.headers["x-local-id"] || "admin"),
    };
    if (!cfg.oauth.clientId || !cfg.oauth.clientSecret) return res.status(400).json({ error: "Thiếu OAuth Client ID / Secret" });
    await saveConfig(cfg);
    const ready = Boolean(cfg.folderId && cfg.oauth.refreshToken);
    return res.json({ ok: true, configured: ready, needOauthLogin: !cfg.oauth.refreshToken, neon: true, host: "vercel" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

async function oauthStart(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: "Chỉ admin" });
  try {
    let cfg = await readConfig();
    if (req.method === "POST" && req.body) {
      cfg = {
        ...cfg,
        folderId: String(req.body.folderId || cfg.folderId || "").trim().replace(/^.*\/folders\//, "").replace(/[?#].*$/, ""),
        oauth: {
          ...cfg.oauth,
          clientId: String(req.body.clientId || cfg.oauth?.clientId || "").trim(),
          clientSecret: String(req.body.clientSecret || cfg.oauth?.clientSecret || "").trim(),
        },
        updatedBy: "oauth-start",
      };
      await saveConfig(cfg);
    }
    const clientId = cfg.oauth?.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || "";
    const clientSecret = cfg.oauth?.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
    if (!clientId || !clientSecret) return res.status(400).json({ error: "Thiếu OAuth Client ID / Secret" });
    const redirectUri = `${PUBLIC_URL}/api/drive-oauth-callback`;
    const state = signState({ clientId, clientSecret, folderId: cfg.folderId || "" });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent", state })}`;
    if (req.method === "POST") return res.json({ ok: true, url, redirectUri });
    return res.redirect(url);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
router.get("/drive-oauth-start", oauthStart);
router.post("/drive-oauth-start", express.json({ limit: "1mb" }), oauthStart);

router.get("/drive-oauth-callback", async (req, res) => {
  const fail = (message) => res.status(400).send(`<!doctype html><meta charset="utf-8"><title>Google Drive</title><h2>OAuth thất bại</h2><p>${String(message).replace(/[<>]/g, "")}</p><p><a href="${PUBLIC_URL}/admin/google-drive">Về Huy Locket</a></p>`);
  try {
    if (req.query.error) return fail(req.query.error);
    const ctx = verifyState(req.query.state);
    if (!ctx || !req.query.code) return fail("State hết hạn hoặc thiếu authorization code");
    const redirectUri = `${PUBLIC_URL}/api/drive-oauth-callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: req.query.code, client_id: ctx.clientId, client_secret: ctx.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.refresh_token) return fail(token.error_description || token.error || "Không nhận được refresh token");
    let email = "";
    try {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } });
      email = (await userRes.json()).email || "";
    } catch {}
    const rootId = await ensureRootFolder(token.access_token, ctx.folderId);
    await ensureSubfolder(token.access_token, rootId, "Ảnh");
    await ensureSubfolder(token.access_token, rootId, "Video");
    const prev = await readConfig();
    await saveConfig({ ...prev, folderId: rootId, oauth: { clientId: ctx.clientId, clientSecret: ctx.clientSecret, refreshToken: token.refresh_token, email }, updatedBy: email || "oauth" });
    return res.send(`<!doctype html><meta charset="utf-8"><title>Google Drive</title><h2>Đã bật Google Drive trên Vercel</h2><p>${email || "OAuth OK"}</p><p><a href="${PUBLIC_URL}/admin/google-drive">Về Huy Locket</a></p><script>setTimeout(()=>location.href=${JSON.stringify(`${PUBLIC_URL}/admin/google-drive`)},1800)</script>`);
  } catch (e) {
    return fail(e.message);
  }
});

router.post("/drive-backup", express.raw({ type: "*/*", limit: "4mb" }), async (req, res) => {
  try {
    const cfg = await readConfig();
    if (!cfg.folderId || !cfg.oauth?.refreshToken) return res.status(503).json({ error: "Drive not configured" });
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (!buffer.length) return res.status(400).json({ error: "Empty file" });
    let filename = "locketdio.bin";
    try { filename = decodeURIComponent(req.headers["x-filename"] || filename); } catch {}
    filename = path.basename(filename).replace(/[^\w.\-()+[\]\s]/g, "_") || "locketdio.bin";
    const token = await getAccessToken(cfg);
    const result = await uploadBuffer(token, cfg.folderId, buffer, req.headers["content-type"] || "application/octet-stream", filename, String(req.headers["x-media-type"] || "").toLowerCase());
    return res.json({ ok: true, id: result.id, name: result.name, webViewLink: result.webViewLink, folder: result.folder, host: "vercel" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});

router.all("/media-download", async (req, res) => {
  try {
    const target = String(req.query.url || req.body?.url || req.body?.mediaUrl || "");
    const url = new URL(target);
    const h = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || h === "localhost" || h === "127.0.0.1" || h.startsWith("10.") || h.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return res.status(400).send("Invalid url");
    const upstream = await fetch(url, { redirect: "follow", headers: { "user-agent": "HuyLocketVercel/1.0", accept: "*/*" } });
    if (!upstream.ok) return res.status(502).send(`Upstream ${upstream.status}`);
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") || "application/octet-stream");
    res.setHeader("cache-control", "private, max-age=300");
    const bytes = Buffer.from(await upstream.arrayBuffer());
    return res.send(bytes);
  } catch (e) {
    return res.status(400).send(e.message || "Invalid url");
  }
});

module.exports = router;
