const { replaceFirebaseWithCDN } = require("../replace/replaceFirebaseWithCDN");

function parseFirestoreValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.mapValue !== undefined) {
    const fields = v.mapValue.fields || {};
    const obj = {};
    for (const key in fields) {
      obj[key] = parseFirestoreValue(fields[key]);
    }
    return obj;
  }
  if (v.arrayValue !== undefined) {
    return (v.arrayValue.values || []).map(parseFirestoreValue);
  }
  return null;
}

function hasObjectContent(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0,
  );
}

function isMeaningfulOverlay({
  overlayCount,
  overlayId,
  dataType,
  captionText,
  icon,
  payload,
}) {
  if (captionText) return true;
  if (!overlayCount) return false;

  const normalizedType = String(dataType || "").toLowerCase();
  const isPlainCaption =
    !normalizedType ||
    normalizedType === "caption" ||
    normalizedType === "standard" ||
    normalizedType === "default";

  // Plain caption without text is the empty object that used to overwrite the
  // local caption about half a second after posting.
  if (isPlainCaption) return false;

  return Boolean(
    overlayId ||
      normalizedType ||
      hasObjectContent(icon) ||
      hasObjectContent(payload),
  );
}

// 🔹 Chuẩn hoá 1 moment từ Firestore doc
function normalizeMoment(doc) {
  if (!doc || !doc.fields) return null;

  const f = doc.fields;
  const overlays = f.overlays?.arrayValue?.values || [];

  // chỉ lấy overlay đầu tiên (nếu có)
  const overlay = overlays[0]?.mapValue?.fields || {};
  const overlayData = overlay.data?.mapValue?.fields || {};

  const backgroundFields = overlayData.background?.mapValue?.fields || {};
  const captionText =
    overlayData.text?.stringValue ||
    overlay.alt_text?.stringValue ||
    f.caption?.stringValue ||
    "";

  const getIsPublic = (fields) => {
    const sentToAll = parseFirestoreValue(fields.sent_to_all);
    const sentToSelfOnly = parseFirestoreValue(fields.sent_to_self_only);

    // Ưu tiên sent_to_self_only nếu có true
    if (sentToSelfOnly) return false;
    if (sentToAll) return true;
    return false;
  };

  // type thật nằm trong data.type (music/poll/review/...),
  // overlay_type luôn là "caption" → nếu lấy nhầm sẽ mất MusicOverlay trên web
  const overlayId = overlay.overlay_id?.stringValue || null;
  const dataType =
    overlayData.type?.stringValue ||
    (overlayId === "caption:music" ? "music" : null) ||
    overlay.overlay_type?.stringValue ||
    null;
  const icon = parseFirestoreValue(overlayData.icon);
  const payload = parseFirestoreValue(overlayData.payload) || {};

  const normalizedOverlay = isMeaningfulOverlay({
    overlayCount: overlays.length,
    overlayId,
    dataType,
    captionText,
    icon,
    payload,
  })
    ? {
        id: overlayId,
        overlay_id: overlayId,
        overlay_type: overlay.overlay_type?.stringValue || "caption",
        type: dataType,
        // Một số bài Locket chỉ có alt_text/top-level caption, còn data.text rỗng.
        text: captionText || null,
        caption: captionText || null,
        text_color: overlayData.text_color?.stringValue || null,
        textColor: overlayData.text_color?.stringValue || null,
        maxLines: overlayData.max_lines?.integerValue
          ? parseInt(overlayData.max_lines.integerValue, 10)
          : null,
        background: {
          material_blur:
            overlayData.background?.mapValue?.fields?.material_blur
              ?.stringValue || null,
          materialBlur:
            overlayData.background?.mapValue?.fields?.material_blur
              ?.stringValue || null,
          colors: parseFirestoreValue(backgroundFields.colors) || [],
        },
        icon,
        payload,
      }
    : null;

  const rawThumbnailUrl = f.thumbnail_url?.stringValue || null;
  const rawImageUrl = f.image_url?.stringValue || null;
  const rawVideoUrl = f.video_url?.stringValue || null;
  const resolvedImageUrl = rawThumbnailUrl || rawImageUrl || null;
  const resolvedVideoUrl = rawVideoUrl || null;

  return {
    id: f.canonical_uid?.stringValue || doc.name.split("/").pop(),
    caption: captionText,
    user: f.user?.stringValue || null,

    // Signed Firebase URLs must stay primary. Host-only replacement can make a
    // valid signed URL return 403 on the CDN host.
    thumbnailUrl: resolvedImageUrl,
    thumbnail_url: resolvedImageUrl,
    imageUrl: resolvedImageUrl,
    image_url: resolvedImageUrl,
    videoUrl: resolvedVideoUrl,
    video_url: resolvedVideoUrl,

    // Keep CDN versions only as optional fallbacks.
    thumbnailCdnUrl: replaceFirebaseWithCDN(resolvedImageUrl),
    imageCdnUrl: replaceFirebaseWithCDN(resolvedImageUrl),
    videoCdnUrl: replaceFirebaseWithCDN(resolvedVideoUrl),

    md5: f.md5?.stringValue || null,
    date: f.date?.timestampValue || doc.createTime || null,
    isPublic: getIsPublic(f),
    // Null lets MomentStores keep the richer local overlay instead of replacing
    // it with a truthy-but-empty API object during the first feed sync.
    overlays: normalizedOverlay,
    createTime: doc.createTime || null,
    updateTime: doc.updateTime || null,
  };
}

module.exports = {
  normalizeMoment,
  parseFirestoreValue,
};
