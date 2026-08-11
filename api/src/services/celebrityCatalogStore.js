const { neon } = require("@neondatabase/serverless");
const {
  createCelebrityCatalogSource,
} = require("./celebrityCatalogSource");

const DEFAULT_UPSTREAM_SYNC_INTERVAL_MS = 5 * 60 * 1000;

function getUpstreamSyncIntervalMs() {
  const configured = Number(process.env.CELEBRITY_SYNC_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 10_000
    ? configured
    : DEFAULT_UPSTREAM_SYNC_INTERVAL_MS;
}

function getCelebrityDatabaseUrl() {
  const candidates = [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL];
  return candidates.find((value) => value?.trim())?.trim() || null;
}

function createCelebrityCatalogStore(
  sql,
  {
    catalogSource = null,
    syncIntervalMs = getUpstreamSyncIntervalMs(),
    now = Date.now,
  } = {},
) {
  if (typeof sql !== "function") {
    throw new TypeError("Celebrity catalog requires a database client");
  }

  let schemaPromise = null;
  let upstreamSyncPromise = null;
  let lastSuccessfulSyncAt = 0;

  async function ensureSchema() {
    if (!schemaPromise) {
      schemaPromise = (async () => {
        await sql`
          CREATE TABLE IF NOT EXISTS celebrity_profiles (
            id BIGSERIAL PRIMARY KEY,
            uid TEXT NOT NULL,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            avatar_url TEXT,
            locket_url TEXT NOT NULL,
            country_code VARCHAR(8) NOT NULL DEFAULT 'OTHER',
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT celebrity_profiles_uid_unique UNIQUE (uid),
            CONSTRAINT celebrity_profiles_username_unique UNIQUE (username),
            CONSTRAINT celebrity_profiles_locket_url_unique UNIQUE (locket_url)
          )
        `;

        // Older runtime-created copies of this table did not include updated_at.
        await sql`
          ALTER TABLE celebrity_profiles
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        `;

        await sql`
          CREATE INDEX IF NOT EXISTS celebrity_profiles_enabled_order
          ON celebrity_profiles (enabled, sort_order, display_name, id)
        `;

        const legacyTable = await sql`
          SELECT to_regclass('public.locket_idols') AS table_name
        `;

        if (legacyTable[0]?.table_name) {
          // Preserve the verified legacy catalog when upgrading an older database.
          // The new table remains authoritative once a UID has been migrated.
          await sql`
            INSERT INTO celebrity_profiles (
              uid, username, display_name, avatar_url, locket_url,
              country_code, enabled, sort_order
            )
            SELECT uid, username, display_name, avatar_url, locket_url,
                   country_code, enabled, sort_order
            FROM locket_idols
            ON CONFLICT DO NOTHING
          `;
        }
      })().catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }

    return schemaPromise;
  }

  async function importVerifiedUpstreamCatalog({ force = false } = {}) {
    if (!catalogSource) return 0;
    if (
      !force &&
      lastSuccessfulSyncAt > 0 &&
      now() - lastSuccessfulSyncAt < syncIntervalMs
    ) {
      return 0;
    }

    if (!upstreamSyncPromise) {
      upstreamSyncPromise = (async () => {
        const profiles = await catalogSource.fetchVerified();
        if (profiles.length === 0) {
          lastSuccessfulSyncAt = now();
          return 0;
        }

        const changed = await sql`
          INSERT INTO celebrity_profiles (
            uid, username, display_name, avatar_url, locket_url,
            country_code, enabled, sort_order
          )
          SELECT source.uid, source.username, source.display_name,
                 source.avatar_url, source.locket_url, source.country_code,
                 TRUE, source.sort_order
          FROM jsonb_to_recordset(${JSON.stringify(profiles)}::jsonb) AS source(
            uid TEXT,
            username TEXT,
            display_name TEXT,
            avatar_url TEXT,
            locket_url TEXT,
            country_code TEXT,
            sort_order INTEGER
          )
          ON CONFLICT (uid) DO UPDATE SET
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            avatar_url = COALESCE(EXCLUDED.avatar_url, celebrity_profiles.avatar_url),
            locket_url = EXCLUDED.locket_url,
            country_code = EXCLUDED.country_code,
            enabled = TRUE,
            sort_order = EXCLUDED.sort_order,
            updated_at = NOW()
          RETURNING id
        `;

        lastSuccessfulSyncAt = now();
        return changed.length;
      })().finally(() => {
        upstreamSyncPromise = null;
      });
    }

    return upstreamSyncPromise;
  }

  async function selectEnabled() {
    return sql`
      SELECT id, uid, username, display_name, avatar_url, locket_url,
             country_code
      FROM celebrity_profiles
      WHERE enabled = TRUE AND country_code <> 'TEST'
      ORDER BY sort_order ASC, display_name ASC, id ASC
    `;
  }

  async function listEnabled({ forceSync = false } = {}) {
    await ensureSchema();
    const rows = await selectEnabled();
    if (!catalogSource) return rows;

    try {
      const inserted = await importVerifiedUpstreamCatalog({
        force: forceSync || rows.length === 0,
      });
      return inserted > 0 || rows.length === 0 ? selectEnabled() : rows;
    } catch (error) {
      // A temporary source outage must not hide the last verified catalog.
      if (rows.length > 0) return rows;
      throw error;
    }
  }

  return { ensureSchema, importVerifiedUpstreamCatalog, listEnabled };
}

function createDefaultCelebrityCatalogStore() {
  const databaseUrl = getCelebrityDatabaseUrl();
  return databaseUrl
    ? createCelebrityCatalogStore(neon(databaseUrl), {
        catalogSource: createCelebrityCatalogSource(),
      })
    : null;
}

module.exports = {
  createCelebrityCatalogStore,
  createDefaultCelebrityCatalogStore,
  getUpstreamSyncIntervalMs,
  getCelebrityDatabaseUrl,
};
