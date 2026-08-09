/**
 * Chuẩn hoá moment từ Firestore / API response.
 * Giữ overlays đầy đủ (type, payload, icon) để music/poll/review hiển thị.
 */

const NON_TEXT_OVERLAY_TYPES = new Set([
  "music",
  "poll",
  "review",
  "color_palette",
  "streak",
  "locket_count",
  "weather",
  "location",
  "battery",
  "time",
  "heart",
  "special",
  "decorative",
  "template",
  "image_icon",
  "image_gif",
  "caption_gif",
  "caption_image",
  "star_sign",
]);

function hasObjectContent(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0,
  );
}

/**
 * API đăng bài đôi khi trả overlay caption chỉ có icon/background nhưng thiếu
 * text trong vài nhịp đầu. Với caption standard/default, icon không đủ để coi
 * overlay là hoàn chỉnh vì nó sẽ chặn caption local trong upload queue.
 */
function hasMeaningfulOverlayContent(overlay) {
  if (!overlay || typeof overlay !== "object") return false;

  const text = overlay.text || overlay.caption;
  const hasText = typeof text === "string" && text.trim();
  const type = String(overlay.type || "").toLowerCase();
  const overlayId = String(overlay.overlay_id || "").toLowerCase();
  const isPlainCaption =
    !type ||
    type === "caption" ||
    type === "standard" ||
    type === "default" ||
    overlayId === "caption:standard" ||
    overlayId === "standard";

  if (isPlainCaption) return Boolean(hasText);
  if (hasText) return true;
  if (NON_TEXT_OVERLAY_TYPES.has(type)) return true;

  return hasObjectContent(overlay.payload) || hasObjectContent(overlay.icon);
}

export function normalizeMoment(data) {
  if (!data || typeof data !== "object") return null;

  const {
    canonical_uid,
    id,
    user,
    userUid,
    image_url,
    imageUrl,
    video_url = null,
    videoUrl,
    thumbnail_url,
    thumbnailUrl,
    thumbnailCdnUrl,
    imageCdnUrl,
    videoCdnUrl,
    overlays = null,
    caption,
    md5,
    sent_to_all,
    show_personally,
    date,
    createTime,
    group_id,
    groupId,
  } = data;

  const momentId = canonical_uid || id || null;

  let dateVNString = null;
  let createTimeMs =
    typeof createTime === "number" && Number.isFinite(createTime)
      ? createTime
      : 0;

  const safeLocale = (ms) => {
    try {
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    } catch {
      return null;
    }
  };

  const sec =
    date?._seconds ??
    date?.seconds ??
    (typeof date === "object" && typeof date?.toMillis === "function"
      ? null
      : null);

  if (typeof sec === "number" && Number.isFinite(sec)) {
    createTimeMs = createTimeMs || sec * 1000;
    dateVNString = safeLocale(sec * 1000);
  } else if (typeof date?.toMillis === "function") {
    try {
      const ms = date.toMillis();
      if (Number.isFinite(ms)) {
        createTimeMs = createTimeMs || ms;
        dateVNString = safeLocale(ms);
      }
    } catch {
      /* ignore */
    }
  } else if (typeof date === "number" && Number.isFinite(date)) {
    // seconds (~1e9) vs ms (~1e12)
    const ms = date < 1e12 && date > 1e9 ? date * 1000 : date;
    createTimeMs = createTimeMs || ms;
    dateVNString = safeLocale(ms);
  } else if (typeof date === "string" && date.trim()) {
    const parsed = Date.parse(date);
    if (!Number.isNaN(parsed)) {
      createTimeMs = createTimeMs || parsed;
      dateVNString = safeLocale(parsed);
    } else {
      // Đã là chuỗi hiển thị (vi-VN) — giữ text, không gán createTime
      dateVNString = date;
    }
  }

  // createTime có thể là seconds
  if (
    createTimeMs > 0 &&
    createTimeMs < 1e12 &&
    createTimeMs > 1e9
  ) {
    createTimeMs = createTimeMs * 1000;
  }

  const legacyCaption =
    typeof caption === "string" && caption.trim() ? caption.trim() : "";

  // Normalize overlays → object shape used by OverlayRenderer
  // (API simplifyMoment already returns object; Locket raw is array)
  let overlayObj = null;
  if (overlays && typeof overlays === "object" && !Array.isArray(overlays)) {
    const oid = overlays.overlay_id || overlays.id || null;
    let resolvedType = overlays.type || null;
    if (
      !resolvedType ||
      resolvedType === "caption" ||
      resolvedType === "standard"
    ) {
      if (oid === "caption:music" || oid === "music") resolvedType = "music";
      else if (oid === "caption:review" || oid === "review")
        resolvedType = "review";
      else if (oid === "caption:color_palette") resolvedType = "color_palette";
      else if (overlays.payload?.isrc || overlays.payload?.song_title)
        resolvedType = "music";
      else resolvedType = resolvedType || "caption";
    }
    const overlayText =
      overlays.text || overlays.caption || legacyCaption || "";
    overlayObj = {
      ...overlays,
      overlay_id: oid,
      type: resolvedType,
      text: overlayText,
      caption: overlayText,
      payload: overlays.payload || {},
      icon: overlays.icon || {},
    };
  } else if (Array.isArray(overlays) && overlays.length > 0) {
    const first = overlays.find((o) => o?.overlay_type || o?.data) || overlays[0];
    const d = first?.data || first || {};
    const oid =
      first?.overlay_id || d.overlay_id || d.type || "caption:standard";
    let resolvedType = d.type || null;
    if (!resolvedType || resolvedType === "caption") {
      if (oid === "caption:music" || oid === "music") resolvedType = "music";
      else if (d.payload?.isrc || d.payload?.song_title) resolvedType = "music";
      else resolvedType = "caption";
    }
    const overlayText = d.text || first.alt_text || legacyCaption || "";
    overlayObj = {
      overlay_id: oid,
      overlay_type: first?.overlay_type || "caption",
      type: resolvedType,
      text: overlayText,
      caption: overlayText,
      text_color: d.text_color,
      max_lines: d.max_lines,
      background: d.background || {},
      icon: d.icon || {},
      payload: d.payload || {},
    };
  }

  if (overlayObj && !hasMeaningfulOverlayContent(overlayObj)) {
    overlayObj = null;
  }

  const captions = [];
  const displayCaption = overlayObj?.text || legacyCaption;
  if (displayCaption) {
    captions.push({
      text: displayCaption,
      text_color: overlayObj?.text_color || "#FFFFFF",
      icon: overlayObj?.icon || null,
      background: overlayObj?.background || {
        material_blur: "ultra_thin",
        colors: [],
      },
      type: overlayObj?.type || "caption",
      payload: overlayObj?.payload || {},
    });
  }

  return {
    id: momentId,
    user: user || userUid || null,
    userUid: userUid || user || null,
    image_url: image_url || imageUrl || null,
    imageUrl: imageUrl || image_url || null,
    video_url: video_url || videoUrl || null,
    videoUrl: videoUrl || video_url || null,
    thumbnail_url: thumbnail_url || thumbnailUrl || image_url || imageUrl || null,
    thumbnailUrl: thumbnailUrl || thumbnail_url || imageUrl || image_url || null,
    thumbnailCdnUrl: thumbnailCdnUrl || imageCdnUrl || null,
    imageCdnUrl: imageCdnUrl || thumbnailCdnUrl || null,
    videoCdnUrl: videoCdnUrl || null,
    date: dateVNString,
    createTime: createTimeMs,
    md5: md5 || null,
    sent_to_all: !!sent_to_all,
    show_personally: !!show_personally,
    group_id: group_id || groupId || null,
    caption: displayCaption || "",
    captions,
    overlays: overlayObj,
  };
}

/**
 * Build overlay object from post optionsData (local, after upload success).
 */
export function overlayFromOptionsData(optionsData) {
  if (!optionsData || typeof optionsData !== "object") return null;
  const type = optionsData.type || "default";
  if (type === "default" && !optionsData.caption && !optionsData.text) {
    return null;
  }
  const payload = optionsData.payload || optionsData.music || {};
  let text = optionsData.text || optionsData.caption || "";
  if (!text && type === "music") {
    text = [payload.song_title || payload.song_name, payload.artist]
      .filter(Boolean)
      .join(" - ");
  }
  let icon = optionsData.icon || {};
  if (type === "music" && !icon?.data) {
    const cover = payload.image_url || payload.image || "";
    if (cover) {
      icon = { type: "image", data: cover, source: "url" };
    }
  }
  const overlayId =
    type === "music"
      ? "caption:music"
      : type === "locket_count"
        ? "caption:lockets"
        : type === "streak"
          ? "caption:streak"
          : optionsData.overlay_id || type;

  return {
    overlay_id: overlayId,
    overlay_type: "caption",
    type: type === "default" ? "caption" : type,
    text,
    caption: text,
    text_color: optionsData.text_color || "#FFFFFFE6",
    background: optionsData.background || {
      material_blur: "ultra_thin",
      colors: [],
    },
    icon,
    payload,
    platform: optionsData.platform || (type === "music" ? "spotify" : undefined),
  };
}
