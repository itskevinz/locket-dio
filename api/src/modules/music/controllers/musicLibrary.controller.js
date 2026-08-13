const path = require("path");
const {
  listLibraryTracks,
  searchLibraryTracks,
  uploadLibraryTrack,
  attachMomentMusic,
  getMomentMusic,
  removeMomentMusic,
  resolveAudioFile,
  resolvePersistentAudio,
  MAX_AUDIO_BYTES,
} = require("../services/musicLibrary.service");
const { searchMusicByQuery } = require("../services/fetchMusicApi");
const { logInfo, logError, logSuccess } = require("../../../utils/logEventUtils");

function baseUrl(req) {
  const host = req.get("x-forwarded-host") || req.get("host");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${host}`;
}

/** GET /api/music/tracks */
async function listTracksController(req, res, next) {
  try {
    const userId = req.user?.user_id || req.user?.uid || null;
    const data = await listLibraryTracks({
      userId,
      baseUrl: baseUrl(req),
    });
    return res.status(200).json({ status: "success", data });
  } catch (e) {
    logError("music.tracks", e.message);
    next(e);
  }
}

/**
 * GET /api/music/search?q=
 * Merges local library + Spotify/Deezer search.
 */
async function searchTracksController(req, res, next) {
  try {
    const q = req.query?.q || req.query?.query || req.body?.q || req.body?.query || "";
    const limit = Number(req.query?.limit || req.body?.limit || 40);
    const userId = req.user?.user_id || req.user?.uid || null;
    const base = baseUrl(req);

    const [local, external] = await Promise.all([
      searchLibraryTracks(q, { limit, userId, baseUrl: base }),
      String(q).trim().length >= 1
        ? searchMusicByQuery(q, Math.min(40, limit)).catch(() => [])
        : Promise.resolve([]),
    ]);

    // Map external Spotify hits into MusicTrack-like shape for UI
    const externalMapped = (external || []).map((t) => ({
      id: t.id || t.spotify_url,
      title: t.song_title || t.song_name || t.name || "",
      artist: t.artist || "",
      audioUrl: t.preview_url || "",
      duration: (t.duration_ms || 0) / 1000,
      coverUrl: t.image_url || "",
      source: t.source || "spotify",
      isPublic: true,
      spotify_url: t.spotify_url || null,
      preview_url: t.preview_url || null,
      isrc: t.isrc || null,
      platform: t.platform || "spotify",
      // keep raw for Locket caption attach
      _raw: t,
    }));

    // Local first, then external (dedupe by title+artist)
    const seen = new Set();
    const merged = [];
    for (const t of [...local, ...externalMapped]) {
      const key = `${String(t.title || "").toLowerCase()}|${String(t.artist || "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }

    logSuccess("music.search", `${merged.length} results for "${String(q).slice(0, 40)}"`);
    return res.status(200).json({
      status: "success",
      data: merged.slice(0, Math.min(50, limit)),
    });
  } catch (e) {
    logError("music.search", e.message);
    if (e.status === 400) {
      return res.status(400).json({ status: "error", message: e.message });
    }
    next(e);
  }
}

/** POST /api/music/upload  multipart: file, title?, artist?, duration? */
async function uploadTrackController(req, res, next) {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        status: "error",
        message: "Thiếu file nhạc (field: file)",
      });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return res.status(400).json({
        status: "error",
        message: "File nhạc tối đa 15MB",
      });
    }

    const userId = req.user?.user_id || req.user?.uid || null;
    const track = await uploadLibraryTrack({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      size: file.size,
      title: req.body?.title || file.originalname,
      artist: req.body?.artist || "",
      duration: req.body?.duration,
      coverUrl: req.body?.coverUrl || "",
      userId,
      baseUrl: baseUrl(req),
    });

    logSuccess("music.upload", `uploaded ${track.id} ${track.title}`);
    return res.status(201).json({ status: "success", data: track });
  } catch (e) {
    logError("music.upload", e.message);
    if (e.status === 400) {
      return res.status(400).json({ status: "error", message: e.message });
    }
    next(e);
  }
}

/** GET /api/music/audio/:filename — stream local audio */
async function streamAudioController(req, res) {
  const filePath = resolveAudioFile(req.params.filename);
  if (!filePath) {
    return res.status(404).json({ status: "error", message: "File not found" });
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
  };
  res.setHeader("Content-Type", types[ext] || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Accept-Ranges", "bytes");
  return res.sendFile(filePath);
}

async function streamPersistentAudioController(req, res) {
  try {
    const item = await resolvePersistentAudio(req.params.id);
    if (!item?.buffer?.length) {
      return res.status(404).json({ status: "error", message: "File not found" });
    }
    res.setHeader("Content-Type", item.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(item.buffer.length));
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Accept-Ranges", "bytes");
    return res.status(200).send(item.buffer);
  } catch (error) {
    logError("music.audio", error.message);
    return res.status(error.status || 502).json({
      status: "error",
      message: "Không thể tải file nhạc",
    });
  }
}

/** POST /api/moments/:id/music */
async function attachMomentMusicController(req, res, next) {
  try {
    const momentId = req.params.id;
    const {
      musicTrackId,
      startTime,
      endTime,
      volume,
      originalVideoVolume,
    } = req.body || {};

    if (!musicTrackId) {
      return res.status(400).json({
        status: "error",
        message: "musicTrackId required",
      });
    }

    const data = await attachMomentMusic({
      momentId,
      musicTrackId,
      startTime,
      endTime,
      volume,
      originalVideoVolume,
      baseUrl: baseUrl(req),
    });

    logInfo("moment.music", `attached ${musicTrackId} → ${momentId}`);
    return res.status(200).json({ status: "success", data });
  } catch (e) {
    logError("moment.music", e.message);
    if (e.status) {
      return res.status(e.status).json({ status: "error", message: e.message });
    }
    next(e);
  }
}

/** GET /api/moments/:id/music */
async function getMomentMusicController(req, res, next) {
  try {
    const data = await getMomentMusic(req.params.id, baseUrl(req));
    if (!data) {
      return res.status(404).json({ status: "error", message: "No music" });
    }
    return res.status(200).json({ status: "success", data });
  } catch (e) {
    next(e);
  }
}

/** DELETE /api/moments/:id/music */
async function deleteMomentMusicController(req, res, next) {
  try {
    const result = await removeMomentMusic(req.params.id);
    return res.status(200).json({ status: "success", data: result });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listTracksController,
  searchTracksController,
  uploadTrackController,
  streamAudioController,
  streamPersistentAudioController,
  attachMomentMusicController,
  getMomentMusicController,
  deleteMomentMusicController,
};
