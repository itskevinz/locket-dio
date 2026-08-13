const { neon } = require("@neondatabase/serverless");

const databaseUrl = String(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "",
).trim();
const client = databaseUrl ? neon(databaseUrl) : null;
let schemaPromise = null;

function isAvailable() {
  return Boolean(process.env.VERCEL && client);
}

async function ensureSchema() {
  if (!isAvailable()) throw new Error("Draft database is not configured");
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await client`
        CREATE TABLE IF NOT EXISTS huy_locket_drafts (
          owner_uid TEXT NOT NULL,
          draft_id TEXT NOT NULL,
          payload JSONB NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (owner_uid, draft_id)
        )
      `;
      await client`
        CREATE INDEX IF NOT EXISTS huy_locket_drafts_owner_updated_idx
        ON huy_locket_drafts (owner_uid, updated_at DESC)
      `;
      await client`
        CREATE TABLE IF NOT EXISTS huy_locket_draft_media (
          owner_uid TEXT NOT NULL,
          draft_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size_bytes BIGINT NOT NULL,
          data_base64 TEXT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (owner_uid, draft_id, role)
        )
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function payloadOf(value) {
  if (!value) return null;
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function listDrafts(ownerUid) {
  await ensureSchema();
  const rows = await client`
    SELECT payload
    FROM huy_locket_drafts
    WHERE owner_uid = ${String(ownerUid)}
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => payloadOf(row.payload)).filter(Boolean);
}

async function getDraft(ownerUid, draftId) {
  await ensureSchema();
  const rows = await client`
    SELECT payload
    FROM huy_locket_drafts
    WHERE owner_uid = ${String(ownerUid)} AND draft_id = ${String(draftId)}
    LIMIT 1
  `;
  return payloadOf(rows[0]?.payload);
}

async function upsertDraft(row) {
  await ensureSchema();
  const payload = JSON.stringify(row);
  await client`
    INSERT INTO huy_locket_drafts (owner_uid, draft_id, payload, updated_at)
    VALUES (${String(row.ownerUid)}, ${String(row.id)}, ${payload}::jsonb, ${Number(row.updatedAt || Date.now())})
    ON CONFLICT (owner_uid, draft_id) DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at
  `;
}

async function putMedia({ ownerUid, draftId, role, contentType, buffer }) {
  await ensureSchema();
  const dataBase64 = buffer.toString("base64");
  const updatedAt = Date.now();
  await client`
    INSERT INTO huy_locket_draft_media
      (owner_uid, draft_id, role, content_type, size_bytes, data_base64, updated_at)
    VALUES
      (${String(ownerUid)}, ${String(draftId)}, ${String(role)}, ${String(contentType)}, ${buffer.length}, ${dataBase64}, ${updatedAt})
    ON CONFLICT (owner_uid, draft_id, role) DO UPDATE SET
      content_type = EXCLUDED.content_type,
      size_bytes = EXCLUDED.size_bytes,
      data_base64 = EXCLUDED.data_base64,
      updated_at = EXCLUDED.updated_at
  `;
}

async function getMedia(ownerUid, draftId, role) {
  await ensureSchema();
  const rows = await client`
    SELECT content_type, size_bytes, data_base64
    FROM huy_locket_draft_media
    WHERE owner_uid = ${String(ownerUid)}
      AND draft_id = ${String(draftId)}
      AND role = ${String(role)}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const buffer = Buffer.from(row.data_base64, "base64");
  return {
    buffer,
    contentType: row.content_type || "application/octet-stream",
    size: Number(row.size_bytes || buffer.length),
  };
}

async function deleteMedia(ownerUid, draftId) {
  await ensureSchema();
  await client`
    DELETE FROM huy_locket_draft_media
    WHERE owner_uid = ${String(ownerUid)} AND draft_id = ${String(draftId)}
  `;
}

module.exports = {
  isAvailable,
  listDrafts,
  getDraft,
  upsertDraft,
  putMedia,
  getMedia,
  deleteMedia,
};
