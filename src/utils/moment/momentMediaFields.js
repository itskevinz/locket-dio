function isUsableMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const url = value.trim();
  return !(
    url.startsWith("inline:") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  );
}

function uniqueUsableUrls(values) {
  return [...new Set(values.filter(isUsableMediaUrl).map((value) => value.trim()))];
}

export function getAlternateStorageHostUrl(value) {
  if (!isUsableMediaUrl(value)) return null;

  if (value.includes("https://cdn.locketcamera.com")) {
    return value.replace(
      "https://cdn.locketcamera.com",
      "https://firebasestorage.googleapis.com",
    );
  }

  if (value.includes("https://firebasestorage.googleapis.com")) {
    return value.replace(
      "https://firebasestorage.googleapis.com",
      "https://cdn.locketcamera.com",
    );
  }

  return null;
}

function withStorageHostFallbacks(values) {
  const primary = uniqueUsableUrls(values);
  return uniqueUsableUrls([
    ...primary,
    ...primary.map(getAlternateStorageHostUrl),
  ]);
}

export function getMomentImageCandidates(moment) {
  return withStorageHostFallbacks([
    moment?.thumbnail_url,
    moment?.image_url,
    moment?.thumbnailUrl,
    moment?.imageUrl,
    moment?.thumbnailCdnUrl,
    moment?.imageCdnUrl,
  ]);
}

export function getMomentVideoCandidates(moment) {
  return withStorageHostFallbacks([
    moment?.video_url,
    moment?.videoUrl,
    moment?.videoCdnUrl,
  ]);
}

/**
 * Incoming API media always wins over an IndexedDB copy, even when one side
 * uses snake_case and the other uses camelCase. This is important for old
 * signed URLs: a freshly fetched camelCase URL must replace the expired cached
 * snake_case URL.
 */
export function mergeMomentMediaFields(local, incoming) {
  const incomingImage = uniqueUsableUrls([
    incoming?.image_url,
    incoming?.imageUrl,
    incoming?.thumbnail_url,
    incoming?.thumbnailUrl,
  ])[0];
  const localImage = uniqueUsableUrls([
    local?.image_url,
    local?.imageUrl,
    local?.thumbnail_url,
    local?.thumbnailUrl,
  ])[0];
  const imageUrl = incomingImage || localImage || null;

  const incomingThumbnail = uniqueUsableUrls([
    incoming?.thumbnail_url,
    incoming?.thumbnailUrl,
    incoming?.image_url,
    incoming?.imageUrl,
  ])[0];
  const localThumbnail = uniqueUsableUrls([
    local?.thumbnail_url,
    local?.thumbnailUrl,
    local?.image_url,
    local?.imageUrl,
  ])[0];
  const thumbnailUrl = incomingThumbnail || localThumbnail || imageUrl;

  const videoUrl =
    uniqueUsableUrls([incoming?.video_url, incoming?.videoUrl])[0] ||
    uniqueUsableUrls([local?.video_url, local?.videoUrl])[0] ||
    null;

  const thumbnailCdnUrl =
    uniqueUsableUrls([
      incoming?.thumbnailCdnUrl,
      incoming?.imageCdnUrl,
      local?.thumbnailCdnUrl,
      local?.imageCdnUrl,
    ])[0] || null;
  const imageCdnUrl =
    uniqueUsableUrls([
      incoming?.imageCdnUrl,
      incoming?.thumbnailCdnUrl,
      local?.imageCdnUrl,
      local?.thumbnailCdnUrl,
    ])[0] || thumbnailCdnUrl;
  const videoCdnUrl =
    uniqueUsableUrls([incoming?.videoCdnUrl, local?.videoCdnUrl])[0] || null;

  return {
    image_url: imageUrl,
    imageUrl,
    thumbnail_url: thumbnailUrl,
    thumbnailUrl,
    video_url: videoUrl,
    videoUrl,
    thumbnailCdnUrl,
    imageCdnUrl,
    videoCdnUrl,
  };
}
