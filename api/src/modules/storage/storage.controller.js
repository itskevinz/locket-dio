const { tokenUltils } = require("../../utils");
const tempMedia = require("./tempMediaStore");
const publishedMedia = require("./publishedMediaStore");
const { logInfo, logError } = require("../../utils/logEventUtils");

/**
 * POST /api/presignedV3 — self-host temp media.
 * Trả uploadUrl + publicUrl. Client PUT binary; postMoment đọc lại.
 */
const presignedV3 = async (req, res) => {
  try {
    const { filename, contentType, type, size } = req.body || {};
    const uid = req.user?.localId || req.user?.uid;
    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = tempMedia.createSlot({
      contentType,
      name: filename,
      size,
      uid,
    });

    const mediaSignature = tokenUltils.signature.generateSignature(id);

    // Ưu tiên PUBLIC_API_URL (Render API) → tránh host web proxy thiếu /api
    const envBase = (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || "")
      .toString()
      .replace(/\/$/, "");

    const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
      .toString()
      .split(",")[0]
      .trim();
    const host = (
      req.headers["x-forwarded-host"] ||
      req.headers.host ||
      "localhost"
    )
      .toString()
      .split(",")[0]
      .trim();

    // Nếu request qua web proxy (host khác API), client nên dùng same-origin /dio-api
    const viaProxyHint = Boolean(
      req.headers["x-forwarded-host"] &&
        process.env.RENDER_EXTERNAL_URL &&
        !String(req.headers["x-forwarded-host"]).includes(
          String(new URL(process.env.RENDER_EXTERNAL_URL).hostname || ""),
        ),
    );

    let base = envBase || `${proto}://${host}`;
    // Khi client gọi qua /dio-api, trả URL relative-friendly cho browser
    const publicPath = `/api/media-temp/${id}`;
    const uploadPath = `/api/media-upload/${id}?sig=${mediaSignature}`;

    const publicUrl = `${base}${publicPath}`;
    const uploadUrl = `${base}${uploadPath}`;

    // Same-origin proxy path (web server.mjs → /dio-api)
    const proxyPublicUrl = `/dio-api${publicPath}`;
    const proxyUploadUrl = `/dio-api${uploadPath}`;

    logInfo(
      "presignedV3",
      `Temp slot ${id} for ${uid} (${type || "file"}) base=${base}`,
    );

    return res.status(200).json({
      success: true,
      data: {
        url: publicUrl,
        publicUrl,
        publicURL: publicUrl,
        downloadURL: publicUrl,
        uploadUrl,
        // Client ưu tiên nếu same-origin
        proxyUploadUrl,
        proxyPublicUrl,
        viaProxy: viaProxyHint,
        key: id,
        path: id,
        name: filename || id,
        size: Number(size) || 0,
        contentType: contentType || "application/octet-stream",
        type: type || "image",
        mediaSignature,
        expiresIn: Math.floor(tempMedia.TTL_MS / 1000),
      },
    });
  } catch (err) {
    logError("presignedV3", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "presigned failed",
    });
  }
};

/**
 * Đọc body binary: express.raw() → req.body là Buffer.
 * KHÔNG stream lại req (đã bị middleware consume → buffer rỗng).
 */
async function readBinaryBody(req) {
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return req.body;
  }
  // Một số parser bọc Buffer
  if (req.body && req.body.type === "Buffer" && Array.isArray(req.body.data)) {
    return Buffer.from(req.body.data);
  }
  if (typeof req.body === "string" && req.body.length) {
    return Buffer.from(req.body, "binary");
  }

  // Fallback stream (khi không dùng express.raw)
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * PUT /api/media-upload/:id?sig=
 */
const mediaUpload = async (req, res) => {
  try {
    const { id } = req.params;
    const sig = req.query.sig || "";
    if (!id || !sig) {
      return res.status(400).send("Missing id or sig");
    }
    if (!tokenUltils.signature.verifySignature(id, String(sig))) {
      return res.status(403).send("Invalid signature");
    }

    const buffer = await readBinaryBody(req);

    if (!buffer || buffer.length === 0) {
      logError("mediaUpload", `Empty body for ${id}`);
      return res.status(400).send("empty body");
    }

    const result = tempMedia.putBuffer(
      id,
      buffer,
      req.headers["content-type"],
    );
    if (!result.ok) {
      const code =
        result.error === "not_found"
          ? 404
          : result.error === "too_large"
            ? 413
            : 400;
      return res.status(code).send(result.error || "upload failed");
    }

    logInfo("mediaUpload", `Stored ${id} (${buffer.length} bytes)`);
    return res.status(200).send("OK");
  } catch (err) {
    logError("mediaUpload", err.message);
    return res.status(500).send("upload error");
  }
};

/**
 * GET /api/media-temp/:id
 */
const mediaTempGet = async (req, res) => {
  try {
    const item = tempMedia.get(req.params.id);
    if (!item || !item.ready || !item.buffer || !item.buffer.length) {
      return res.status(404).send("Not found");
    }
    res.setHeader(
      "Content-Type",
      item.contentType || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Length", String(item.buffer.length));
    return res.status(200).send(item.buffer);
  } catch (err) {
    logError("mediaTempGet", err.message);
    return res.status(500).send("error");
  }
};

/**
 * GET /api/published-media/:filename
 * Public, unguessable and durable media URL used only when Locket Firebase Storage rejects writes.
 */
const publishedMediaGet = async (req, res) => {
  try {
    const item = publishedMedia.readPublished(req.params.filename);
    if (!item || !item.buffer || !item.buffer.length) {
      return res.status(404).send("Not found");
    }
    res.setHeader("Content-Type", item.contentType || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", String(item.buffer.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(item.buffer);
  } catch (err) {
    logError("publishedMediaGet", err.message);
    return res.status(500).send("error");
  }
};

module.exports = {
  presignedV3,
  mediaUpload,
  mediaTempGet,
  publishedMediaGet,
};
