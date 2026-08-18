const {
  logInfo,
  logError,
  logSuccess,
} = require("../../../utils/logEventUtils");
const {
  fetchMusicApi,
  searchMusicByQuery,
} = require("../services/fetchMusicApi");
const {
  getAppleMusicMeta,
  getSpotifyTrackInfo,
} = require("../services/getMusicInfoV1");
const {
  getAppleMusicInfo,
  getSpotifyInfo,
} = require("../services/getMusicInfoV2");

/**
 * V2 (legacy scrapers): keep for /getInfoMusicV3 callers that still want scrape path.
 */
const getInfoMusicControllerV2 = async (req, res, next) => {
  const { url, platform } = req.body;

  try {
    logInfo("getInfoMusic", `🎵 [V2 scrape] Lấy info từ ${platform}...`);

    try {
      const data = await fetchMusicApi(url, platform);
      if (data) {
        logSuccess("getInfoMusic", "✅ Lấy info thành công (local reliable)");
        return res.status(200).json({ status: "success", message: "ok", data });
      }
    } catch (localErr) {
      logInfo(
        "getInfoMusic",
        `Local reliable failed, try scrapers: ${localErr.message}`,
      );
    }

    let data = null;

    if (platform === "apple") {
      const meta = (await getAppleMusicMeta(url).catch(() => null)) || {};
      const info = (await getAppleMusicInfo(url).catch(() => null)) || {};

      data = {
        artist: meta.artist || info.artist,
        image_url: meta.image || info.image,
        isrc: info.isrc,
        preview_url: meta.previewUrl,
        song_name: meta.name || info.name,
        apple_music_url: meta.appleMusicUrl || info.appleLink,
        title:
          meta.title ||
          [meta.name || info.name, meta.artist || info.artist]
            .filter(Boolean)
            .join(" - "),
        song_title: meta.name || info.name,
        album: meta.album,
        platform: "apple",
      };
    } else if (platform === "spotify") {
      const meta = (await getSpotifyTrackInfo(url).catch(() => null)) || {};
      const info = (await getSpotifyInfo(url).catch(() => null)) || {};

      data = {
        artist: meta.artist || info.artist,
        image_url: meta.image || info.image_url,
        isrc: info.isrc,
        preview_url: meta.previewUrl || meta.preview_url,
        song_name: meta.name || info.song_name || info.name,
        spotify_url:
          meta.spotify_url || info.spotify_url || info.spotifyLink || url,
        title:
          meta.title ||
          [meta.name || info.song_name, meta.artist || info.artist]
            .filter(Boolean)
            .join(" - "),
        song_title: meta.name || info.song_name,
        album: meta?.album,
        platform: "spotify",
      };

      if (!data.song_name && !data.title) data = null;
    } else {
      return res.status(400).json({
        status: "error",
        message: "Nền tảng không được hỗ trợ! (apple | spotify)",
      });
    }

    if (!data || (!data.song_name && !data.title)) {
      logError("getInfoMusic", "❌ Không tìm thấy thông tin bài hát!");
      return res.status(404).json({
        status: "error",
        message: "Không tìm thấy thông tin bài hát!",
      });
    }

    logSuccess("getInfoMusic", "✅ Lấy thông tin bài hát thành công!");
    return res.status(200).json({ status: "success", message: "ok", data });
  } catch (error) {
    logError("getInfoMusic", "❌ Lỗi khi lấy thông tin bài hát", error.message);
    if (error.status === 400 || error.status === 404) {
      return res.status(error.status).json({
        status: "error",
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * V3 used by client route POST /api/getInfoMusicV2.
 * Uses local reliable providers (oEmbed + song.link + optional Spotify API).
 */
const getInfoMusicControllerV3 = async (req, res, next) => {
  const { url, platform } = req.body;

  try {
    if (!url || !platform) {
      return res.status(400).json({
        status: "error",
        message: "Thiếu url hoặc platform",
      });
    }

    logInfo(
      "getInfoMusic",
      `🎵 [V2 route/local] Lấy info từ ${platform}: ${String(url).slice(0, 80)}`,
    );

    const info = await fetchMusicApi(url, platform);
    if (!info) {
      logError("getInfoMusic", "❌ Không tìm thấy thông tin bài hát!");
      return res.status(404).json({
        status: "error",
        message: "Không tìm thấy thông tin bài hát!",
      });
    }

    logSuccess(
      "getInfoMusic",
      `✅ Lấy info OK: ${info.title} (${info.source || "local"})`,
    );
    return res.status(200).json({
      status: "success",
      message: "ok",
      data: info,
    });
  } catch (error) {
    logError("getInfoMusic", "❌ Lỗi khi lấy thông tin bài hát", error.message);
    if (error.status === 400 || error.status === 404) {
      return res.status(error.status).json({
        status: "error",
        message: error.message,
      });
    }
    next(error);
  }
};

function normalizeMusicText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nhận diện query mashup và tạo hai tầng tìm kiếm:
 * - primary: thử đúng tên mashup trước.
 * - fallback: nếu primary ít/rỗng, tách từng vế để catalog vẫn trả kết quả liên quan.
 */
function buildMashupSearchPlan(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return { isMashup: false, primary: [], fallback: [], parts: [] };
  }

  const hasSeparator = /\s(?:x|×|✕|✖)\s/i.test(raw);
  const hasMashupWord = /\bmash[\s-]?up\b/i.test(raw);
  if (!hasSeparator && !hasMashupWord) {
    return { isMashup: false, primary: [raw], fallback: [], parts: [] };
  }

  const normalizedX = raw
    .replace(/\s*(?:×|✕|✖)\s*/g, " x ")
    .replace(/\s+[xX]\s+/g, " x ")
    .replace(/\s+/g, " ")
    .trim();

  const withoutMashupWord = normalizedX
    .replace(/\bmash[\s-]?up\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = withoutMashupWord
    .split(/\s+x\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 3);

  const combined = (parts.length >= 2
    ? parts.join(" ")
    : withoutMashupWord.replace(/\s+x\s+/gi, " "))
    .replace(/\s+/g, " ")
    .trim();

  const primary = [
    ...new Set(
      [raw, combined ? `${combined} mashup` : ""].filter(
        (value) => value && value.length >= 2,
      ),
    ),
  ].slice(0, 2);

  const primarySet = new Set(primary.map((value) => value.toLowerCase()));
  const fallback = [
    ...new Set(
      [combined, ...parts]
        .filter((value) => value && value.length >= 2)
        .filter((value) => !primarySet.has(value.toLowerCase())),
    ),
  ].slice(0, 4);

  return {
    isMashup: true,
    primary,
    fallback,
    parts,
  };
}

function musicResultKey(track) {
  if (!track) return "";
  if (track.isrc) return `isrc:${String(track.isrc).toUpperCase()}`;
  if (track.spotify_url) return `spotify:${track.spotify_url}`;
  if (track.apple_music_url) return `apple:${track.apple_music_url}`;
  if (track.deezer_url) return `deezer:${track.deezer_url}`;

  const title = normalizeMusicText(
    track.song_title || track.song_name || track.name || track.title || "",
  );
  const artist = normalizeMusicText(track.artist || "");
  return title || artist ? `ta:${title}|${artist}` : "";
}

function trackQuality(track) {
  return (
    (track?.isrc ? 8 : 0) +
    (track?.spotify_url || track?.apple_music_url ? 4 : 0) +
    (track?.preview_url ? 2 : 0) +
    (track?.image_url ? 1 : 0)
  );
}

/**
 * Đẩy bản có dấu hiệu chứa cả hai vế mashup lên đầu.
 * Nếu catalog không có mashup thật, các bài gốc của từng vế vẫn còn phía dưới.
 */
function mashupAffinity(track, parts) {
  const title = normalizeMusicText(
    track?.song_title || track?.song_name || track?.name || track?.title || "",
  );
  const artist = normalizeMusicText(track?.artist || "");
  const blob = `${title} ${artist}`.trim();
  const normalizedParts = (parts || []).map(normalizeMusicText).filter(Boolean);

  let matchedParts = 0;
  for (const part of normalizedParts) {
    if (part && blob.includes(part)) matchedParts += 1;
  }

  let score = matchedParts * 100;
  if (matchedParts >= 2) score += 350;
  if (/\b(mashup|medley|remix|mix)\b/.test(blob)) score += 80;
  return score;
}

function mergeMashupSearchResults(resultLists, limit, parts = []) {
  const merged = new Map();
  let order = 0;

  for (const list of resultLists) {
    for (const track of Array.isArray(list) ? list : []) {
      const key = musicResultKey(track);
      if (!key) continue;

      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { track, order: order++ });
        continue;
      }

      const prevTrack = prev.track;
      const better = trackQuality(track) >= trackQuality(prevTrack);
      const next = better
        ? {
            ...prevTrack,
            ...track,
            isrc: track.isrc || prevTrack.isrc,
            spotify_url: track.spotify_url || prevTrack.spotify_url,
            apple_music_url: track.apple_music_url || prevTrack.apple_music_url,
            preview_url: track.preview_url || prevTrack.preview_url,
            image_url: track.image_url || prevTrack.image_url,
          }
        : {
            ...prevTrack,
            isrc: prevTrack.isrc || track.isrc,
            spotify_url: prevTrack.spotify_url || track.spotify_url,
            apple_music_url: prevTrack.apple_music_url || track.apple_music_url,
            preview_url: prevTrack.preview_url || track.preview_url,
            image_url: prevTrack.image_url || track.image_url,
          };

      merged.set(key, { track: next, order: prev.order });
    }
  }

  return [...merged.values()]
    .sort((a, b) => {
      const affinityDiff =
        mashupAffinity(b.track, parts) - mashupAffinity(a.track, parts);
      if (affinityDiff !== 0) return affinityDiff;
      const qualityDiff = trackQuality(b.track) - trackQuality(a.track);
      if (qualityDiff !== 0) return qualityDiff;
      return a.order - b.order;
    })
    .slice(0, limit)
    .map((item) => item.track);
}

async function searchVariants(variants, perVariantLimit) {
  const settled = await Promise.allSettled(
    variants.map((variant) => searchMusicByQuery(variant, perVariantLimit)),
  );
  return settled
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value);
}

/**
 * Tìm nhạc theo tên (không cần liên kết Spotify user).
 * POST /api/searchMusic { query, limit? }
 */
const searchMusicController = async (req, res, next) => {
  try {
    const query = req.body?.query || req.body?.q || req.query?.q;
    const limit = req.body?.limit || req.query?.limit || 40;
    if (!query || !String(query).trim()) {
      return res.status(400).json({
        status: "error",
        message: "Thiếu từ khóa tìm kiếm",
      });
    }

    const searchLimit = Math.min(Math.max(Number(limit) || 40, 1), 50);
    const plan = buildMashupSearchPlan(query);

    logInfo(
      "searchMusic",
      `🔍 Search: ${String(query).slice(0, 80)}${
        plan.isMashup
          ? ` | mashup primary=${plan.primary.length} fallback=${plan.fallback.length}`
          : ""
      }`,
    );

    let list;
    if (!plan.isMashup) {
      list = await searchMusicByQuery(query, searchLimit);
    } else {
      const perVariantLimit = Math.min(searchLimit, 18);
      const primaryLists = await searchVariants(plan.primary, perVariantLimit);
      let allLists = [...primaryLists];
      let primaryMerged = mergeMashupSearchResults(
        primaryLists,
        searchLimit,
        plan.parts,
      );

      // Chỉ mở rộng sang từng vế khi tìm đúng mashup chưa đủ kết quả.
      if (primaryMerged.length < 3 && plan.fallback.length) {
        const fallbackLists = await searchVariants(
          plan.fallback,
          perVariantLimit,
        );
        allLists = [...allLists, ...fallbackLists];
      }

      list = mergeMashupSearchResults(allLists, searchLimit, plan.parts);
      logInfo(
        "searchMusic",
        `🎚️ Mashup search: primary=[${plan.primary.join(" | ")}] fallback=[${
          plan.fallback.join(" | ")
        }] parts=[${plan.parts.join(" + ")}] -> ${list.length} merged`,
      );
    }

    logSuccess("searchMusic", `✅ ${list.length} kết quả`);
    return res.status(200).json({
      status: "success",
      message: "ok",
      data: list,
    });
  } catch (error) {
    logError("searchMusic", error.message);
    if (error.status === 400) {
      return res.status(400).json({ status: "error", message: error.message });
    }
    next(error);
  }
};

module.exports = {
  getInfoMusicControllerV2,
  getInfoMusicControllerV3,
  searchMusicController,
};
