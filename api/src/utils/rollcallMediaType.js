const DECLARED_MEDIA_TYPE = /^(image|video)\/[a-z0-9.+-]+$/i;

function normalizedDeclaredType(value) {
  const type = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return DECLARED_MEDIA_TYPE.test(type) ? type : "";
}

function ascii(buffer, start, length) {
  if (!Buffer.isBuffer(buffer) || buffer.length < start + length) return "";
  return buffer.toString("ascii", start, start + length);
}

/**
 * Determine a browser-safe Rollcall media type from the response bytes.
 * Firebase/CDN occasionally labels valid uploads as application/octet-stream,
 * so the proxy cannot rely on Content-Type alone.
 */
function sniffRollcallMediaType(value, declaredType = "") {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (ascii(buffer, 0, 6) === "GIF87a" || ascii(buffer, 0, 6) === "GIF89a") {
    return "image/gif";
  }
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (ascii(buffer, 0, 2) === "BM") return "image/bmp";

  if (ascii(buffer, 4, 4) === "ftyp") {
    const brand = ascii(buffer, 8, 4).toLowerCase();
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
    return "video/mp4";
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return "video/webm";
  }

  // SVG has no fixed binary signature. Only trust an explicit upstream type;
  // unknown HTML/JSON/octet-stream data remains blocked.
  return normalizedDeclaredType(declaredType);
}

module.exports = {
  sniffRollcallMediaType,
};
