const { neon } = require("@neondatabase/serverless");

let schemaPromise = null;

function getDatabaseUrl() {
  return [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim() || null;
}

function getSql() {
  const databaseUrl = getDatabaseUrl();
  return databaseUrl ? neon(databaseUrl) : null;
}

function clean(value, maxLength = 500) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

async function ensureAccountLockSchema() {
  const sql = getSql();
  if (!sql) {
    const error = new Error("User activity database is not configured");
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS web_account_locks (
        uid TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        locked_by TEXT,
        locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS web_account_locks_locked_at_idx ON web_account_locks (locked_at DESC)`;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

async function setAccountLock(uid, { reason, lockedBy = null } = {}) {
  const targetUid = clean(uid, 160);
  const lockReason = clean(reason, 500);
  if (!targetUid || !lockReason) {
    throw new Error("Missing account lock uid or reason");
  }
  await ensureAccountLockSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO web_account_locks (uid, reason, locked_by, locked_at, updated_at)
    VALUES (${targetUid}, ${lockReason}, ${clean(lockedBy, 160)}, NOW(), NOW())
    ON CONFLICT (uid) DO UPDATE SET
      reason = EXCLUDED.reason,
      locked_by = EXCLUDED.locked_by,
      locked_at = NOW(),
      updated_at = NOW()
    RETURNING uid, reason, locked_by, locked_at
  `;
  return rows[0] || null;
}

async function clearAccountLock(uid) {
  const targetUid = clean(uid, 160);
  if (!targetUid) return false;
  await ensureAccountLockSchema();
  const sql = getSql();
  await sql`DELETE FROM web_account_locks WHERE uid = ${targetUid}`;
  return true;
}

async function getAccountLock(uid) {
  const targetUid = clean(uid, 160);
  if (!targetUid) return null;
  await ensureAccountLockSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT uid, reason, locked_by, locked_at
    FROM web_account_locks
    WHERE uid = ${targetUid}
    LIMIT 1
  `;
  return rows[0] || null;
}

module.exports = {
  clearAccountLock,
  ensureAccountLockSchema,
  getAccountLock,
  setAccountLock,
};
