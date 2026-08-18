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

    // Prefer reliable local path first; fall back to old scrapers
    try {
      const data = await fetchMusicApi(url, platform);
      if (data) {
        logSuccess("getInfoMusic", "✅ Lấy info thành công (local reliable)");
        return res.status(200).json({
          status: "success",
          message: "ok",
          data,
        });
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
        title: meta.title || [meta.name || info.name, meta.artist || info.artist].filter(Boolean).join(" - "),
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
        spotify_url: meta.spotify_url || info.spotify_url || info.spotifyLink || url,
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

    return res.status(200).json({
      status: "success",
      message: "ok",
      data,
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

/**
 * V3 used by client route POST /api/getInfoMusicV2.
 * Uses local reliable providers (oEmbed + song.link + optional Spotify API).
 * Does NOT depend on api-beta.locket-dio.com.
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

function buildMashupSearchVariants(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];

  const hasSeparator = /\s(?:x|×|✕|✖)\s/i.test(raw);
  const hasMashupWord = /\bmash[\s-]?up\b/i.test(raw);
  if (!hasSeparator && !hasMashupWord) return [raw];

  const normalizedX = raw
    .replace(/\s*(?:×|✕|✖)\s*/g, " x ")
    .replace(/\s+[xX]\s+/g, " x ")
    .replace(/\s+/g, " ")
    .trim();

  const combined = normalizedX
    .replace(/\s+x\s+/gi, " ")
    .replace(/\bmash[\s-]?up\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [
    ...new Set(
      [
        raw,
        normalizedX,
        combined ? `${combined} mashup` : "",
      ].filter((value) => value && value.length >= 2),
    ),
  ].slice(0, 3);
}

function musicResultKey(track) {
  if (!track) return "";
  if (track.isrc) return `isrc:${String(track.isrc).toUpperCase()}`;
  if (track.spotify_url) return `spotify:${track.spotify_url}`;
  if (track.apple_music_url) return `apple:${track.apple_music_url}`;
  if (track.deezer_url) return `deezer:${track.deezer_url}`;

  const title = String(
    track.song_title || track.song_name || track.name || track.title || "",
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const artist = String(track.artist || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return title || artist ? `ta:${title}|${artist}` : "";
}

function mergeMashupSearchResults(resultLists, limit) {
  const merged = new Map();

  const quality = (track) =>
    (track?.isrc ? 8 : 0) +
    (track?.spotify_url || track?.apple_music_url ? 4 : 0) +
    (track?.preview_url ? 2 : 0) +
    (track?.image_url ? 1 : 0);

  for (const list of resultLists) {
    for (const track of Array.isArray(list) ? list : []) {
      const key = musicResultKey(track);
      if (!key) continue;

      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, track);
        continue;
      }

      if (quality(track) >= quality(prev)) {
        merged.set(key, {
          ...prev,
          ...track,
          isrc: track.isrc || prev.isrc,
          spotify_url: track.spotify_url || prev.spotify_url,
          apple_music_url: track.apple_music_url || prev.apple_music_url,
          preview_url: track.preview_url || prev.preview_url,
          image_url: track.image_url || prev.image_url,
        });
      } else {
        merged.set(key, {
          ...prev,
          isrc: prev.isrc || track.isrc,
          spotify_url: prev.spotify_url || track.spotify_url,
          apple_music_url: prev.apple_music_url || track.apple_music_url,
          preview_url: prev.preview_url || track.preview_url,
          image_url: prev.image_url || track.image_url,
        });
      }
    }
  }

  return [...merged.values()].slice(0, limit);
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
    const variants = buildMashupSearchVariants(query);
    const isMashupSearch = variants.length > 1;

    logInfo(
      "searchMusic",
      `🔍 Search: ${String(query).slice(0, 80)}${
        isMashupSearch ? ` | mashup variants=${variants.length}` : ""
      }`,
    );

    let list;
    if (!isMashupSearch) {
      list = await searchMusicByQuery(query, searchLimit);
    } else {
      // Chỉ mở rộng khi query có dấu hiệu mashup. Search thường giữ nguyên hành vi cũ.
      // Giới hạn mỗi biến thể để tránh flood Deezer/iTunes/Spotify và giữ latency ổn định.
      const perVariantLimit = Math.min(searchLimit, 24);
      const settled = await Promise.allSettled(
        variants.map((variant) => searchMusicByQuery(variant, perVariantLimit)),
      );
      const resultLists = settled
        .filter((item) => item.status === "fulfilled")
        .map((item) => item.value);

      list = mergeMashupSearchResults(resultLists, searchLimit);
      logInfo(
        "searchMusic",
        `🎚️ Mashup variants: ${variants.join(" | ")} -> ${list.length} merged`,
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
