const { neon } = require("@neondatabase/serverless");

const databaseUrl = String(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "",
).trim();
const sql = databaseUrl ? neon(databaseUrl) : null;
let schemaPromise = null;

async function ensureSchema() {
  if (!sql) return false;
  if (schemaPromise) return schemaPromise;

  schemaPromise = sql`
    CREATE TABLE IF NOT EXISTS slot_notification_claims (
      channel TEXT NOT NULL,
      target TEXT NOT NULL,
      event_id TEXT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (channel, target, event_id)
    )
  `
    .then(() => true)
    .catch((error) => {
      schemaPromise = null;
      console.warn("[slot-monitor] notification claim schema failed", {
        code: error?.code || null,
      });
      return false;
    });

  return schemaPromise;
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

async function claimNotification(channel, target, eventId) {
  const normalizedChannel = clip(channel, 40).toLowerCase();
  const normalizedTarget = clip(target, 200);
  const normalizedEventId = clip(eventId, 240);
  if (!normalizedChannel || !normalizedTarget || !normalizedEventId) return true;
  if (!(await ensureSchema())) return true;

  // Giữ bảng nhỏ và cho phép cùng một event id được dùng lại sau một ngày nếu cần.
  await sql`
    DELETE FROM slot_notification_claims
    WHERE claimed_at < NOW() - INTERVAL '24 hours'
  `.catch(() => {});

  const rows = await sql`
    INSERT INTO slot_notification_claims (channel, target, event_id, claimed_at)
    VALUES (${normalizedChannel}, ${normalizedTarget}, ${normalizedEventId}, NOW())
    ON CONFLICT (channel, target, event_id) DO NOTHING
    RETURNING event_id
  `;

  return rows.length > 0;
}

async function releaseNotificationClaim(channel, target, eventId) {
  if (!sql) return;
  const normalizedChannel = clip(channel, 40).toLowerCase();
  const normalizedTarget = clip(target, 200);
  const normalizedEventId = clip(eventId, 240);
  if (!normalizedChannel || !normalizedTarget || !normalizedEventId) return;

  await sql`
    DELETE FROM slot_notification_claims
    WHERE channel = ${normalizedChannel}
      AND target = ${normalizedTarget}
      AND event_id = ${normalizedEventId}
  `.catch(() => {});
}

module.exports = {
  claimNotification,
  releaseNotificationClaim,
};
