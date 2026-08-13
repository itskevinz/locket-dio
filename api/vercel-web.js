import backendHandler from "../backend/app.js";

export default function vercelWeb(req, res) {
  try {
    return backendHandler(req, res);
  } catch (error) {
    console.error("[vercel-backend-request]", error?.stack || error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: false,
      code: "BACKEND_REQUEST_FAILED",
      message: error?.message || String(error),
    }));
  }
}
