const {
  parseFirestoreValue,
  getString,
  timestampToMillis,
  getBoolean,
  timestampToSeconds,
} = require("../utils/firestoreConverts");
const { replaceFirebaseWithCDN } = require("../utils/replaceFirebaseWithCDN");

function simplifyMoment(data) {
  const document = data.document_change?.document;
  const fields = document?.fields;

  if (!document || !fields) return null;

  const overlays = fields.overlays?.array_value?.values || [];
  const overlay = overlays[0]?.map_value?.fields || {};
  const overlayData = overlay.data?.map_value?.fields || {};
  const backgroundFields = overlayData.background?.map_value?.fields || {};

  const topLevelCaption = fields.caption?.string_value || "";
  const altText = overlay.alt_text?.string_value || "";
  const overlayText = getString(overlayData.text) || altText || topLevelCaption || "";

  const getIsPublic = (momentFields) => {
    const sentToAll = parseFirestoreValue(momentFields.sent_to_all);
    const sentToSelfOnly = parseFirestoreValue(momentFields.sent_to_self_only);

    if (sentToSelfOnly) return false;
    if (sentToAll) return true;
    return true;
  };

  // Older history entries are not fully consistent with newer Locket entries:
  // some only have image_url (no thumbnail_url), and a few do not expose
  // canonical_uid. Keep aliases on the response so both old and new clients can
  // render the same record instead of silently dropping its media.
  const documentId = document.name?.split("/").pop() || null;
  const canonicalUid = getString(fields.canonical_uid) || documentId;

  const rawThumbnailUrl = getString(fields.thumbnail_url);
  const rawImageUrl = getString(fields.image_url);
  const rawVideoUrl = getString(fields.video_url);

  const resolvedImageUrl = replaceFirebaseWithCDN(
    rawThumbnailUrl || rawImageUrl,
  );
  const resolvedVideoUrl = replaceFirebaseWithCDN(rawVideoUrl);

  const moment = {
    id: canonicalUid,
    canonical_uid: canonicalUid,
    group_id: getString(fields.group_id) || null,
    caption: topLevelCaption || altText || overlayText,
    user: fields.user?.string_value || null,

    // Preserve both camelCase and snake_case names because history/cache code
    // contains both shapes. Most importantly, fall back to image_url for legacy
    // moments where thumbnail_url was never written.
    thumbnailUrl: resolvedImageUrl,
    thumbnail_url: resolvedImageUrl,
    imageUrl: resolvedImageUrl,
    image_url: resolvedImageUrl,
    videoUrl: resolvedVideoUrl,
    video_url: resolvedVideoUrl,

    md5: getString(fields.md5) || null,
    date: timestampToMillis(fields.date?.timestamp_value) || 0,
    isPublic: getIsPublic(fields),
    overlays: {
      overlay_id: getString(overlay.overlay_id),
      overlay_type: getString(overlay.overlay_type),
      type: getString(overlayData.type),
      text: overlayText,
      caption: overlayText,
      text_color: getString(overlayData.text_color),
      max_lines: overlayData.max_lines?.integer_value
        ? parseInt(overlayData.max_lines.integer_value, 10)
        : null,
      background: {
        material_blur: parseFirestoreValue(backgroundFields?.material_blur) || null,
        colors: parseFirestoreValue(backgroundFields?.colors) || [],
        image: parseFirestoreValue(backgroundFields?.image) || {},
      },
      icon: parseFirestoreValue(overlayData.icon) || {},
      payload: parseFirestoreValue(overlayData.payload) || {},
    },
    isCelebrity: getBoolean(fields.from_celebrity) || false,
    from_celebrity: getBoolean(fields.from_celebrity) || false,
    createTime: timestampToSeconds(document.create_time) || 0,
    updateTime: timestampToSeconds(document.update_time) || 0,
  };

  return moment;
}

function simplifyReactions(data) {
  const document = data.document_change?.document || data;
  const fields = document?.fields;

  if (!document || !fields) return null;

  return {
    id: document.name.split("/").pop(),
    user: parseFirestoreValue(fields.user),
    emoji: parseFirestoreValue(fields.string),
    intensity: parseFirestoreValue(fields.intensity) ?? 0,
    createdAt: parseFirestoreValue(fields.created_at),
    createTime: timestampToSeconds(document.create_time),
    updateTime: timestampToSeconds(document.update_time),
  };
}

module.exports = { simplifyMoment, simplifyReactions };
