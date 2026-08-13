/**
 * Local upload stats (when Supabase is not configured).
 * Persists per-user counters so Pricing "Thống kê tải lên" shows real data.
 */
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

const STATS_DIR = path.resolve(process.cwd(), "data", "upload-stats");
const STATS_FILE = path.join(STATS_DIR, "stats.json");
const databaseUrl = String(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "",
).trim();
const database = databaseUrl ? neon(databaseUrl) : null;
let schemaPromise = null;

function useDatabase() {
  return Boolean(process.env.VERCEL && database);
}

async function ensureDatabase() {
  if (!useDatabase()) throw new Error("Upload stats database is not configured");
  if (!schemaPromise) {
    schemaPromise = database`
      CREATE TABLE IF NOT EXISTS huy_locket_upload_stats (
        owner_uid TEXT PRIMARY KEY,
        image_uploaded BIGINT NOT NULL DEFAULT 0,
        video_uploaded BIGINT NOT NULL DEFAULT 0,
        total_storage_used_bytes BIGINT NOT NULL DEFAULT 0,
        error_count BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `.catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function databaseRow(row) {
  if (!row) return emptyStats();
  return normalize({
    image_uploaded: Number(row.image_uploaded || 0),
    video_uploaded: Number(row.video_uploaded || 0),
    total_storage_used_bytes: Number(row.total_storage_used_bytes || 0),
    error_count: Number(row.error_count || 0),
    updated_at: row.updated_at || null,
  });
}

function ensureStore() {
  try {
    if (!fs.existsSync(STATS_DIR)) {
      fs.mkdirSync(STATS_DIR, { recursive: true });
    }
    if (!fs.existsSync(STATS_FILE)) {
      fs.writeFileSync(STATS_FILE, "{}", "utf8");
    }
  } catch (e) {
    console.warn("[localUploadStats] ensureStore:", e.message);
  }
}

function readAll() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STATS_FILE, "utf8");
    return JSON.parse(raw || "{}") || {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureStore();
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.warn("[localUploadStats] writeAll:", e.message);
  }
}

function emptyStats() {
  return {
    image_uploaded: 0,
    video_uploaded: 0,
    total_uploads: 0,
    total_storage_used_mb: 0,
    total_storage_used_bytes: 0,
    error_count: 0,
    updated_at: null,
  };
}

/**
 * Normalize any legacy / mixed shapes to UI field names.
 */
function normalize(raw = {}) {
  const base = emptyStats();
  const image =
    Number(raw.image_uploaded ?? raw.image_uploads ?? raw.images ?? 0) || 0;
  const video =
    Number(raw.video_uploaded ?? raw.video_uploads ?? raw.videos ?? 0) || 0;
  const bytes =
    Number(raw.total_storage_used_bytes ?? 0) ||
    Math.round(
      (Number(raw.total_storage_used_mb ?? raw.storage_used_mb ?? 0) || 0) *
        1024 *
        1024,
    );
  const errors = Number(raw.error_count ?? raw.errors ?? 0) || 0;
  const mb = Math.round((bytes / (1024 * 1024)) * 100) / 100;
  return {
    ...base,
    image_uploaded: image,
    video_uploaded: video,
    total_uploads: image + video,
    // aliases for older UI
    image_uploads: image,
    video_uploads: video,
    total_storage_used_bytes: bytes,
    total_storage_used_mb: mb,
    error_count: errors,
    updated_at: raw.updated_at || null,
  };
}

async function getUserStats(uid) {
  if (!uid) return emptyStats();
  if (useDatabase()) {
    await ensureDatabase();
    const rows = await database`
      SELECT image_uploaded, video_uploaded, total_storage_used_bytes,
             error_count, updated_at
      FROM huy_locket_upload_stats
      WHERE owner_uid = ${String(uid)}
      LIMIT 1
    `;
    return databaseRow(rows[0]);
  }
  const all = readAll();
  return normalize(all[String(uid)] || {});
}

/** Overwrite stats (e.g. after client sync from published posts). */
async function setUserStats(uid, stats = {}) {
  if (!uid) return emptyStats();
  const next = normalize({
    ...emptyStats(),
    ...stats,
    updated_at: new Date().toISOString(),
  });
  if (useDatabase()) {
    await ensureDatabase();
    const rows = await database`
      INSERT INTO huy_locket_upload_stats
        (owner_uid, image_uploaded, video_uploaded, total_storage_used_bytes,
         error_count, updated_at)
      VALUES
        (${String(uid)}, ${next.image_uploaded}, ${next.video_uploaded},
         ${next.total_storage_used_bytes}, ${next.error_count}, ${next.updated_at})
      ON CONFLICT (owner_uid) DO UPDATE SET
        image_uploaded = EXCLUDED.image_uploaded,
        video_uploaded = EXCLUDED.video_uploaded,
        total_storage_used_bytes = EXCLUDED.total_storage_used_bytes,
        error_count = EXCLUDED.error_count,
        updated_at = EXCLUDED.updated_at
      RETURNING image_uploaded, video_uploaded, total_storage_used_bytes,
                error_count, updated_at
    `;
    return databaseRow(rows[0]);
  }
  const all = readAll();
  all[String(uid)] = next;
  writeAll(all);
  return next;
}

/**
 * @param {{ uid: string, mediaType?: 'image'|'video'|null, sizeInBytes?: number, isError?: boolean }} opts
 */
async function incrementUserStats({
  uid,
  mediaType = null,
  sizeInBytes = 0,
  isError = false,
}) {
  if (!uid) return emptyStats();
  if (useDatabase()) {
    await ensureDatabase();
    const imageDelta = isError || mediaType === "video" ? 0 : 1;
    const videoDelta = !isError && mediaType === "video" ? 1 : 0;
    const bytesDelta = isError ? 0 : Math.max(0, Number(sizeInBytes) || 0);
    const errorDelta = isError ? 1 : 0;
    const updatedAt = new Date().toISOString();
    const rows = await database`
      INSERT INTO huy_locket_upload_stats
        (owner_uid, image_uploaded, video_uploaded, total_storage_used_bytes,
         error_count, updated_at)
      VALUES
        (${String(uid)}, ${imageDelta}, ${videoDelta}, ${bytesDelta},
         ${errorDelta}, ${updatedAt})
      ON CONFLICT (owner_uid) DO UPDATE SET
        image_uploaded = huy_locket_upload_stats.image_uploaded + EXCLUDED.image_uploaded,
        video_uploaded = huy_locket_upload_stats.video_uploaded + EXCLUDED.video_uploaded,
        total_storage_used_bytes = huy_locket_upload_stats.total_storage_used_bytes + EXCLUDED.total_storage_used_bytes,
        error_count = huy_locket_upload_stats.error_count + EXCLUDED.error_count,
        updated_at = EXCLUDED.updated_at
      RETURNING image_uploaded, video_uploaded, total_storage_used_bytes,
                error_count, updated_at
    `;
    return databaseRow(rows[0]);
  }
  const all = readAll();
  const key = String(uid);
  const cur = normalize(all[key] || {});

  if (isError) {
    cur.error_count += 1;
  } else {
    const size = Math.max(0, Number(sizeInBytes) || 0);
    if (mediaType === "image") {
      cur.image_uploaded += 1;
    } else if (mediaType === "video") {
      cur.video_uploaded += 1;
    } else {
      // unknown type — count as image
      cur.image_uploaded += 1;
    }
    cur.total_storage_used_bytes += size;
  }

  cur.total_uploads = cur.image_uploaded + cur.video_uploaded;
  cur.total_storage_used_mb =
    Math.round((cur.total_storage_used_bytes / (1024 * 1024)) * 100) / 100;
  cur.image_uploads = cur.image_uploaded;
  cur.video_uploads = cur.video_uploaded;
  cur.updated_at = new Date().toISOString();

  all[key] = cur;
  writeAll(all);
  return cur;
}

module.exports = {
  getUserStats,
  setUserStats,
  incrementUserStats,
  normalize,
  emptyStats,
};
