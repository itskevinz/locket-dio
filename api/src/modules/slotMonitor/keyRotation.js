const crypto = require("node:crypto");
const { neon } = require("@neondatabase/serverless");

function clean(value, max = 10000) {
  return String(value || "").trim().slice(0, max);
}

function legacySecret() {
  return clean(
    process.env.SLOT_MONITOR_ENCRYPTION_KEY
      || process.env.COOKIE_SECRET
      || process.env.JWT_SECRET
      || process.env.LOCKETDIO_JWT_SECRET,
  );
}

function nextSecret() {
  return clean(process.env.SLOT_MONITOR_ENCRYPTION_KEY_NEXT);
}

function deriveKey(secret) {
  const value = clean(secret);
  if (value.length < 16) return null;
  return crypto.createHash("sha256").update(value).digest();
}

function decryptWithKey(payload, key) {
  const [ivPart, tagPart, dataPart] = String(payload || "").split(".");
  if (!ivPart || !tagPart || !dataPart) throw new Error("Invalid encrypted Slot Monitor session");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptWithKey(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value || ""), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

async function rotateSlotMonitorEncryptionKey() {
  const next = nextSecret();
  if (!next) return { skipped: true, reason: "NEXT_KEY_NOT_SET", migrated: 0, alreadyMigrated: 0 };

  const old = legacySecret();
  const oldKey = deriveKey(old);
  const nextKey = deriveKey(next);
  if (!oldKey) throw new Error("Current Slot Monitor encryption key is unavailable");
  if (!nextKey) throw new Error("Next Slot Monitor encryption key must be at least 16 characters");
  if (old === next) return { skipped: true, reason: "KEY_UNCHANGED", migrated: 0, alreadyMigrated: 0 };

  const databaseUrl = clean(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL, 20000);
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Slot Monitor key rotation");
  const sql = neon(databaseUrl);

  const tableRows = await sql`SELECT to_regclass('public.slot_monitor_sessions') AS table_name`;
  if (!tableRows?.[0]?.table_name) {
    return { skipped: true, reason: "SESSION_TABLE_MISSING", migrated: 0, alreadyMigrated: 0 };
  }

  const rows = await sql`
    SELECT user_uid, refresh_token_enc
    FROM slot_monitor_sessions
    WHERE refresh_token_enc IS NOT NULL AND refresh_token_enc <> ''
    ORDER BY user_uid
  `;

  let migrated = 0;
  let alreadyMigrated = 0;
  for (const row of rows) {
    const payload = String(row.refresh_token_enc || "");
    try {
      decryptWithKey(payload, nextKey);
      alreadyMigrated += 1;
      continue;
    } catch {
      // Not using the next key yet; decrypt with the currently-active key below.
    }

    const plain = decryptWithKey(payload, oldKey);
    const rotated = encryptWithKey(plain, nextKey);
    await sql`
      UPDATE slot_monitor_sessions
      SET refresh_token_enc = ${rotated}, updated_at = NOW()
      WHERE user_uid = ${String(row.user_uid)}
    `;
    migrated += 1;
  }

  return {
    skipped: false,
    migrated,
    alreadyMigrated,
    total: rows.length,
  };
}

module.exports = { rotateSlotMonitorEncryptionKey };
