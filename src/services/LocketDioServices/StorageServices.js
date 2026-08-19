import { CONFIG } from "@/config/webConfig";
import { instanceBaseStorage } from "@/libs";
import { backupToDriveInBackground } from "@/utils/googleDrive";

/** File → base64 (không data: prefix) */
async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const hasDedicatedStorageOrigin = () =>
  /^https?:\/\//i.test(String(CONFIG.api.storage || "").trim());

function resolveUploadUrl(data) {
  const raw = data?.uploadUrl || "";

  // Khi storage đã tách sang Render/R2 bridge, phải dùng URL tuyệt đối mà
  // storage API trả về. Không ép quay lại /dio-api của web/Vercel, nếu không
  // backend sẽ tự gọi qua WAF và cloud IP có thể bị chặn 403.
  if (hasDedicatedStorageOrigin() && /^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (typeof window !== "undefined" && data?.proxyUploadUrl) {
    return data.proxyUploadUrl.startsWith("http")
      ? data.proxyUploadUrl
      : `${window.location.origin}${data.proxyUploadUrl}`;
  }

  if (typeof window !== "undefined" && raw) {
    try {
      const u = new URL(raw, window.location.origin);
      if (u.pathname.includes("/api/media-upload/")) {
        return `${window.location.origin}/dio-api${u.pathname}${u.search}`;
      }
    } catch {
      /* keep */
    }
  }
  return raw;
}

function resolvePublicUrl(data) {
  const raw = data?.publicUrl || data?.url || data?.downloadURL || "";

  // Dedicated storage host (Render) owns media-temp. Preserve that absolute URL
  // so postMoment on Vercel downloads from Render instead of calling itself.
  if (hasDedicatedStorageOrigin() && /^https?:\/\//i.test(raw)) {
    return raw;
  }

  const pathId = data?.path || data?.key;
  if (typeof window !== "undefined" && pathId) {
    return `${window.location.origin}/dio-api/api/media-temp/${pathId}`;
  }
  return raw;
}

/**
 * Upload media:
 * - Ưu tiên presigned + PUT cho cả ảnh và video để media đi qua R2.
 * - Ảnh nhỏ chỉ dùng base64 inline như fallback khi PUT/verify thực sự lỗi.
 */
export const uploadFileAndGetInfoR2 = async (
  file,
  previewType = "other",
  localId,
) => {
  if (!file) throw new Error("No file provided");
  if (!file.size) throw new Error("File rỗng — hãy chụp/chọn lại");

  const safeType = String(previewType || "other").toLowerCase();
  const timestamp = Date.now();
  const extension = file.name?.split(".").pop() || (safeType === "video" ? "mp4" : "jpg");
  const fileName = `huylocket_${timestamp}_${localId}_cli${CONFIG.app.clientVersion}.${extension}`;
  const contentType = file.type || (safeType === "video" ? "video/mp4" : "image/jpeg");

  // Tự động sao lưu ngầm lên Google Drive cho mọi ảnh/video
  try {
    backupToDriveInBackground(file, { fileName, mediaType: safeType });
  } catch (e) {
    console.warn("[gdrive] auto backup error:", e);
  }

  // Chỉ dùng inline làm đường lui nếu R2 upload/verify lỗi.
  const INLINE_MAX = 4.5 * 1024 * 1024; // JSON 20MB limit, base64 ~1.33x

  // ── Presign + PUT qua API → private R2 ──
  const body = {
    filename: fileName,
    contentType,
    type: safeType,
    size: file.size,
    uploadedAt: new Date().toISOString(),
  };

  const res = await instanceBaseStorage.post("/api/presignedV3", body);
  const data = res.data?.data;
  if (!data) throw new Error("presignedV3: no data");

  const uploadUrl = resolveUploadUrl(data);
  if (!uploadUrl) throw new Error("presignedV3: missing uploadUrl");

  const ab = await file.arrayBuffer();
  if (!ab.byteLength) throw new Error("File buffer rỗng");

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(ab.byteLength),
    },
    body: ab,
  });

  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => "");
    // Safety fallback: ảnh nhỏ vẫn đăng được nếu R2 tạm thời lỗi.
    if (safeType === "image" && file.size <= INLINE_MAX) {
      const mediaBase64 = await fileToBase64(file);
      return {
        path: data.path || data.key,
        key: data.key || data.path,
        name: fileName,
        size: file.size,
        type: safeType,
        contentType,
        mediaBase64,
        mediaEncoding: "base64",
        url: "inline://local",
        publicUrl: "inline://local",
        publicURL: "inline://local",
        downloadURL: "inline://local",
        // Inline: không dùng temp signature (tránh fail verify trên API)
        mediaSignature: null,
        inline: true,
      };
    }
    throw new Error(
      `Upload media failed (${uploadRes.status})${t ? `: ${t.slice(0, 100)}` : ""}`,
    );
  }

  const pathId = data.path || data.key;
  const publicUrl = resolvePublicUrl(data);

  // Verify file landed
  try {
    const check = await fetch(publicUrl, { method: "GET", cache: "no-store" });
    if (!check.ok) {
      throw new Error(`verify GET ${check.status}`);
    }
    const verified = await check.arrayBuffer();
    if (!verified.byteLength) {
      throw new Error("verify empty");
    }
    if (verified.byteLength < 32) {
      throw new Error(`verify too small: ${verified.byteLength}`);
    }
  } catch (e) {
    console.warn("temp media verify failed, try inline fallback:", e.message);
    if (safeType === "image" && file.size <= INLINE_MAX) {
      const mediaBase64 = await fileToBase64(file);
      return {
        path: pathId,
        key: pathId,
        name: fileName,
        size: file.size,
        type: safeType,
        contentType,
        mediaBase64,
        mediaEncoding: "base64",
        url: publicUrl,
        publicUrl,
        publicURL: publicUrl,
        downloadURL: publicUrl,
        mediaSignature: null,
        inline: true,
      };
    }
    throw new Error(
      "Upload temp media không lưu được file. Thử lại hoặc chụp ảnh nhỏ hơn.",
    );
  }

  return {
    ...data,
    path: pathId,
    key: pathId,
    name: fileName,
    size: file.size,
    type: safeType,
    contentType,
    url: publicUrl,
    publicUrl,
    publicURL: publicUrl,
    downloadURL: publicUrl,
  };
};
