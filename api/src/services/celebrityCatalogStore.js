const { neon } = require("@neondatabase/serverless");

function getCelebrityDatabaseUrl() {
  const candidates = [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL];
  return candidates.find((value) => value?.trim())?.trim() || null;
}

function createCelebrityCatalogStore(sql) {
  if (typeof sql !== "function") {
    throw new TypeError("Celebrity catalog requires a database client");
  }

  let schemaPromise = null;

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

  async function listEnabled() {
    await ensureSchema();
    return sql`
      SELECT id, uid, username, display_name, avatar_url, locket_url,
             country_code
      FROM celebrity_profiles
      WHERE enabled = TRUE
      ORDER BY sort_order ASC, display_name ASC, id ASC
    `;
  }

  return { ensureSchema, listEnabled };
}

function createDefaultCelebrityCatalogStore() {
  const databaseUrl = getCelebrityDatabaseUrl();
  return databaseUrl ? createCelebrityCatalogStore(neon(databaseUrl)) : null;
}

module.exports = {
  createCelebrityCatalogStore,
  createDefaultCelebrityCatalogStore,
  getCelebrityDatabaseUrl,
};
