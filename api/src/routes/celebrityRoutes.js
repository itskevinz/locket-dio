const express = require("express");
const { verifyIdToken } = require("../middlewares/Auth");
const { celebrityReadLimiter } = require("../middlewares/rateLimit");
const {
  createDefaultCelebrityCatalogStore,
} = require("../services/celebrityCatalogStore");

const router = express.Router();
const catalogStore = createDefaultCelebrityCatalogStore();

function mapCelebrity(row) {
  return {
    id: String(row.id),
    uid: row.uid,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || null,
    locketUrl: row.locket_url,
    countryCode: String(row.country_code || "OTHER").trim().toUpperCase(),
  };
}

router.get("/", celebrityReadLimiter, verifyIdToken, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (!catalogStore) {
    return res.status(503).json({
      success: false,
      code: "DATABASE_UNAVAILABLE",
      message: "Cơ sở dữ liệu Celebrity chưa được cấu hình.",
    });
  }

  try {
    const refreshValue = String(req.query.refresh || "").toLowerCase();
    const rows = await catalogStore.listEnabled({
      forceSync: refreshValue === "1" || refreshValue === "true",
    });

    return res.status(200).json({
      success: true,
      data: rows.map(mapCelebrity),
    });
  } catch (error) {
    const schemaMissing = error?.code === "42P01";
    const upstreamUnavailable =
      error?.code === "CELEBRITY_UPSTREAM_UNAVAILABLE";
    console.error("[celebrity] catalog query failed", {
      code: error?.code || null,
      name: error?.name || "Error",
    });

    return res.status(schemaMissing || upstreamUnavailable ? 503 : 500).json({
      success: false,
      code: schemaMissing
        ? "CELEBRITY_SCHEMA_MISSING"
        : upstreamUnavailable
          ? "CELEBRITY_UPSTREAM_UNAVAILABLE"
          : "CELEBRITY_QUERY_FAILED",
      message: schemaMissing
        ? "Dữ liệu Celebrity chưa được khởi tạo."
        : "Không thể tải dữ liệu Celebrity.",
    });
  }
});

module.exports = router;
