module.exports = async function handler(req, res) {
  res.statusCode = 503;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    ok: false,
    code: "VERCEL_DRIVE_MIGRATION_PENDING",
    message: "Google Drive route is being migrated to Vercel"
  }));
};
