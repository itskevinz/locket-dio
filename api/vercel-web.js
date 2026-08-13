import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let cachedHandler = null;

export default function vercelWeb(req, res) {
  try {
    if (!cachedHandler) cachedHandler = require("./app.js");
    return cachedHandler(req, res);
  } catch (error) {
    console.error("[vercel-backend-startup]", error?.stack || error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: false,
      code: "BACKEND_STARTUP_FAILED",
      message: error?.message || String(error),
    }));
  }
}
