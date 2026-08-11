/**
 * Rollcall media helpers — URL resolve, progressive preload, safe net logs.
 * Never log tokens, cookies, or full signed URLs.
 */

import { replaceFirebaseWithCDN } from "@/utils/replace/replaceFirebaseWithCDN";
import { getImageSrc } from "@/utils/replace/replaceUrl";
import { collectNestedRollcallUrls } from "./rollcallUrlFields";

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)(\?|#|$)/i;
const FIREBASE_HOST = "https://firebasestorage.googleapis.com";
const LOCKET_CDN_HOST = "https://cdn.locketcamera.com";

/** In-flight preload promises keyed by media id / url host+path (no query). */
const preloadInflight = new Map();
/** Soft memory of preloaded keys this session. */
const preloadedOk = new Set();

export function logRollcallNet(entry) {
  try {
    // Only timing / status / type — no secrets
    console.info("[rollcall:net]", {
      type: entry.type,
      status: entry.status ?? null,
      ms: entry.ms ?? null,
      mediaKind: entry.mediaKind ?? null,
      index: entry.index ?? null,
      count: entry.count ?? null,
      week: entry.week ?? null,
      year: entry.year ?? null,
      fromCache: entry.fromCache ?? null,
      candidate: entry.candidate ?? null,
    });
  } catch {
    /* ignore */
  }
}

/** Host + path only (strip query/hash so signed tokens never log). */
export function mediaPathKey(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url, window?.location?.origin || "https://huy-locket.local");
    return `${u.host}${u.pathname}`;
  } catch {
    return String(url).split("?")[0].split("#")[0];
  }
}

/**
 * Detect expired Google / Firebase signed URL from query params.
 * Returns true when token expired or past expiry number.
 */
export function isSignedUrlExpired(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const expires = u.searchParams.get("Expires") || u.searchParams.get("X-Goog-Expires");
    if (expires && /^\d+$/.test(expires)) {
      const expSec = Number(expires);
      if (expSec > 1e9) return Date.now() / 1000 > expSec - 30;
    }
    const googDate = u.searchParams.get("X-Goog-Date");
    const googExp = u.searchParams.get("X-Goog-Expires");
    if (googDate && googExp) {
      const m = googDate.match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      );
      if (m) {
        const start = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        const lifetimeMs = Number(googExp) * 1000;
        return Date.now() > start + lifetimeMs - 30_000;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function stringValues(values) {
  return values
    .flat(Infinity)
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
}

function mainRawUrls(item) {
  if (!item || typeof item !== "object") return [];
  return stringValues([
    item.main_url,
    item.mainUrl,
    item.video_url,
    item.videoUrl,
    item.media_url,
    item.mediaUrl,
    item.image_url,
    item.imageUrl,
    item.download_url,
    item.downloadUrl,
    item.url,
    item.media?.main_url,
    item.media?.mainUrl,
    item.media?.video_url,
    item.media?.videoUrl,
    item.media?.image_url,
    item.media?.imageUrl,
    item.media?.url,
    item.asset?.url,
    item.file?.url,
    collectNestedRollcallUrls(item, "main"),
  ]);
}

function thumbnailRawUrls(item) {
  if (!item || typeof item !== "object") return [];
  return stringValues([
    item.thumbnail_url,
    item.thumbnailUrl,
    item.thumb_url,
    item.thumbUrl,
    item.preview_url,
    item.previewUrl,
    item.poster_url,
    item.posterUrl,
    item.media?.thumbnail_url,
    item.media?.thumbnailUrl,
    item.media?.preview_url,
    item.media?.previewUrl,
    item.media?.poster_url,
    item.media?.posterUrl,
    collectNestedRollcallUrls(item, "thumbnail"),
  ]);
}

function addUnique(list, value) {
  if (!value || typeof value !== "string") return;
  if (!list.includes(value)) list.push(value);
}

function addDirectVariants(list, rawUrl) {
  if (!rawUrl) return;

  // Keep the exact API URL first. Rewriting signed URLs can break some Rollcalls.
  addUnique(list, getImageSrc(rawUrl));

  const cdnUrl = replaceFirebaseWithCDN(rawUrl);
  if (cdnUrl && cdnUrl !== rawUrl) {
    addUnique(list, getImageSrc(cdnUrl));
  }

  // Some cached records already contain the CDN host. Try Firebase as a reverse fallback.
  if (rawUrl.startsWith(LOCKET_CDN_HOST)) {
    addUnique(
      list,
      getImageSrc(rawUrl.replace(LOCKET_CDN_HOST, FIREBASE_HOST)),
    );
  }
}

function appendSameOriginProxy(list) {
  const direct = [...list];
  direct.forEach((url) => {
    if (!/^https?:\/\//i.test(url)) return;
    addUnique(list, `/api/media-download?url=${encodeURIComponent(url)}`);
  });
}

export function isVideoMedia(itemOrUrl) {
  if (!itemOrUrl) return false;
  if (typeof itemOrUrl === "string") return VIDEO_EXT.test(itemOrUrl);

  if (
    itemOrUrl.video_url ||
    itemOrUrl.videoUrl ||
    itemOrUrl.media?.video_url ||
    itemOrUrl.media?.videoUrl ||
    itemOrUrl.is_video === true
  ) {
    return true;
  }

  const mime =
    itemOrUrl.mime_type ||
    itemOrUrl.mimeType ||
    itemOrUrl.content_type ||
    itemOrUrl.contentType ||
    itemOrUrl.media_type ||
    itemOrUrl.mediaType ||
    itemOrUrl.type ||
    itemOrUrl.media?.mime_type ||
    itemOrUrl.media?.content_type ||
    itemOrUrl.media?.type ||
    "";

  if (typeof mime === "string" && mime.toLowerCase().includes("video")) {
    return true;
  }

  return mainRawUrls(itemOrUrl).some(
    (url) => VIDEO_EXT.test(url) && !IMAGE_EXT.test(url),
  );
}

/**
 * Ordered main-media candidates:
 * raw API URL → CDN alternate → reverse Firebase alternate → same-origin proxy.
 */
export function getRollcallMainCandidates(item, { includeProxy = true } = {}) {
  const candidates = [];
  mainRawUrls(item).forEach((url) => addDirectVariants(candidates, url));
  if (includeProxy) appendSameOriginProxy(candidates);
  return candidates;
}

/** Ordered thumbnail/poster candidates with the same fallback strategy. */
export function getRollcallThumbnailCandidates(
  item,
  { includeProxy = true } = {},
) {
  const candidates = [];
  thumbnailRawUrls(item).forEach((url) => addDirectVariants(candidates, url));
  if (includeProxy) appendSameOriginProxy(candidates);
  return candidates;
}

/**
 * Direct URL for callers that only need one value.
 */
export function resolveRollcallMediaUrl(rawUrl) {
  if (!rawUrl) return "";
  const candidates = [];
  addDirectVariants(candidates, rawUrl);
  return candidates[0] || "";
}

export function getRollcallThumbnailUrl(item) {
  return getRollcallThumbnailCandidates(item, { includeProxy: false })[0] || "";
}

export function getRollcallMainUrl(item) {
  return getRollcallMainCandidates(item, { includeProxy: false })[0] || "";
}

export function mediaIdOf(item, index = 0) {
  return item?.uid || item?.id || `idx-${index}-${mediaPathKey(getRollcallMainUrl(item))}`;
}

/** Whether this slide should mount real media (current ± 1). */
export function shouldLoadMediaIndex(index, activeIndex) {
  return Math.abs(index - activeIndex) <= 1;
}

/** Preload image into browser cache (deduped). No-op for video / empty. */
export function preloadRollcallImage(url, { id, priority = "low" } = {}) {
  if (!url || typeof window === "undefined") return Promise.resolve(false);
  if (isVideoMedia(url)) return Promise.resolve(false);

  const key = id || mediaPathKey(url);
  if (preloadedOk.has(key)) return Promise.resolve(true);
  if (preloadInflight.has(key)) return preloadInflight.get(key);

  const t0 = performance.now();
  const p = new Promise((resolve) => {
    const img = new Image();
    try {
      if ("fetchPriority" in img) img.fetchPriority = priority;
    } catch {
      /* ignore */
    }
    img.decoding = "async";
    img.onload = () => {
      preloadedOk.add(key);
      preloadInflight.delete(key);
      logRollcallNet({
        type: "preload_image",
        status: 200,
        ms: Math.round(performance.now() - t0),
        mediaKind: "image",
      });
      resolve(true);
    };
    img.onerror = () => {
      preloadInflight.delete(key);
      logRollcallNet({
        type: "preload_image",
        status: "error",
        ms: Math.round(performance.now() - t0),
        mediaKind: "image",
      });
      resolve(false);
    };
    img.src = url;
  });

  preloadInflight.set(key, p);
  return p;
}

/** Limited concurrency queue for warm preloads (neighbors only — callers decide). */
export async function preloadRollcallNeighbors(
  items,
  activeIndex,
  { concurrency = 2 } = {},
) {
  if (!Array.isArray(items) || !items.length) return;

  const targets = [activeIndex, activeIndex + 1, activeIndex - 1]
    .filter((i, idx, arr) => arr.indexOf(i) === idx && i >= 0 && i < items.length)
    .map((i) => ({ i, item: items[i] }));

  const ordered = targets.sort((a, b) => {
    if (a.i === activeIndex) return -1;
    if (b.i === activeIndex) return 1;
    return a.i - b.i;
  });

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, ordered.length) },
    async () => {
      while (cursor < ordered.length) {
        const my = ordered[cursor++];
        if (!my) break;
        if (isVideoMedia(my.item)) continue;
        const url = getRollcallMainCandidates(my.item, {
          includeProxy: false,
        })[0];
        if (!url) continue;
        await preloadRollcallImage(url, {
          id: mediaIdOf(my.item, my.i),
          priority: my.i === activeIndex ? "high" : "low",
        });
      }
    },
  );
  await Promise.allSettled(workers);
}

/** Module-level fetch dedupe for getRollcallPosts(week, year). */
const listFetchInflight = new Map();

export function getListFetchKey(week, year) {
  return `${year}-W${week}`;
}

export function getInflightListFetch(key) {
  return listFetchInflight.get(key);
}

export function setInflightListFetch(key, promise) {
  listFetchInflight.set(key, promise);
  const clear = () => {
    if (listFetchInflight.get(key) === promise) listFetchInflight.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}
