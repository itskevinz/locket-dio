const URL_FIELD_RE = /(url|uri|media|image|video|main|asset|file|source|original|download|playback|cdn)/i;
const THUMB_FIELD_RE = /(thumb|preview|poster)/i;
const NON_MEDIA_FIELD_RE = /(avatar|profile|user|author)/i;

/**
 * Find media URL fields in nested Rollcall payloads while excluding profile
 * photos. Locket has shipped both flat and nested/wrapped response shapes.
 */
export function collectNestedRollcallUrls(item, kind) {
  const found = [];
  const seen = new Set();

  function add(value) {
    const normalized = value.trim();
    if (!found.includes(normalized)) found.push(normalized);
  }

  function visit(value, path = [], depth = 0) {
    if (value == null || depth > 5) return;
    if (typeof value === "string") {
      if (!/^https?:\/\//i.test(value.trim())) return;
      const fieldPath = path.join(".");
      const isThumbnail = THUMB_FIELD_RE.test(fieldPath);
      const looksLikeMedia = URL_FIELD_RE.test(fieldPath);
      const looksLikeIdentity = NON_MEDIA_FIELD_RE.test(fieldPath);
      if (
        looksLikeMedia &&
        !looksLikeIdentity &&
        ((kind === "thumbnail" && isThumbnail) ||
          (kind === "main" && !isThumbnail))
      ) {
        add(value);
      }
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, path, depth + 1));
      return;
    }
    Object.entries(value).forEach(([key, entry]) =>
      visit(entry, [...path, key], depth + 1),
    );
  }

  visit(item);
  return found;
}
