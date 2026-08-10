const { neon } = require("@neondatabase/serverless");
const userActivityStore = require("./userActivityStore");

function getSql() {
  const databaseUrl = [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim();
  return databaseUrl ? neon(databaseUrl) : null;
}

async function healIpLocationInDb(ipAddress, { city, region, country } = {}) {
  if (
    !ipAddress ||
    ipAddress === "Không xác định" ||
    !city ||
    city === "Không xác định"
  ) {
    return;
  }

  const sql = getSql();
  if (!sql) return;

  try {
    const imprecise = [
      "Không xác định",
      "",
      "Unknown",
      "Hanoi",
      "Hà Nội",
      "Ho Chi Minh City",
      "Hồ Chí Minh",
      "Ho Chi Minh",
    ];

    // login_history is the canonical source for per-login IP/location data.
    // user_sessions intentionally stores only presence/session lifecycle fields,
    // so querying user_sessions.ip_address/city/region/country caused production
    // schema errors even though the admin response itself was otherwise healthy.
    await sql`
      UPDATE login_history
      SET city = ${city}, region = ${region}, country = ${country}
      WHERE ip_address = ${ipAddress}
        AND (city IS NULL OR city = ANY(${imprecise}))
    `;
  } catch (error) {
    console.warn("Failed healing IP location in login history:", error?.message || error);
  }
}

// Patch the exported function before adminRoutes destructures it. This keeps the
// current store API stable while avoiding an unnecessary user_sessions schema
// expansion just for location metadata that is already stored in login_history.
userActivityStore.healIpLocationInDb = healIpLocationInDb;

module.exports = { healIpLocationInDb };
