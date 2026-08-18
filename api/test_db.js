const { neon } = require("@neondatabase/serverless");

const databaseUrl = String(process.env.DATABASE_URL || "").trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is not configured.");
  process.exitCode = 1;
} else {
  const sql = neon(databaseUrl);
  sql`SELECT * FROM admin_roles`
    .then(console.log)
    .catch((error) => {
      console.error("Database test failed:", error?.message || error);
      process.exitCode = 1;
    });
}
