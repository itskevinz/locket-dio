const path = require("path");
const store = require("../store/musicJsonStore");
const musicDatabase = require("../store/musicDatabase");
const {
  uploadPersistentMedia,
  downloadPersistentMedia,
} = require("../../vercelDrive");
const { supabase, isSupabaseConfigured } = require("../../../config/supabase");

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
]);

function validateAudioFile({ mimetype, size, originalname }) {
  const mime = String(mimetype || "").toLowerCase();
  const name = String(originalname || "").toLowerCase();
  const okMime =
    ALLOWED_MIME.has(mime) ||
    /\.(mp3|m4a|aac|wav|ogg|webm|flac)$/i.test(name);
  if (!okMime) {
    const err = new Error(
      "Định dạng nhạc không hỗ trợ (mp3, m4a, aac, wav, ogg, flac)",
    );
    err.status = 400;
    throw err;
  }
  if (size > MAX_AUDIO_BYTES) {
    const err = new Error("File nhạc tối đa 15MB");
    err.status = 400;
    throw err;
  }
}

function toPublicTrack(row, baseUrl = "") {
  if (!row) return null;
  let audioUrl = row.audioUrl || row.audio_url || "";
  // Local file path → public API URL
  if (audioUrl.startsWith("file:") || audioUrl.startsWith("audio/")) {
    const fname = path.basename(audioUrl.replace(/^file:/, ""));
    audioUrl = `${baseUrl}/api/music/audio/${fname}`;
  } else if (audioUrl.startsWith("gdrive:")) {
    const fileId = audioUrl.slice("gdrive:".length);
    audioUrl = `${baseUrl}/api/music/audio/drive/${encodeURIComponent(fileId)}`;
  }
  return {
    id: row.id,
    title: row.title,
    artist: row.artist || "",
    audioUrl,
    duration: Number(row.duration || row.duration_ms / 1000 || 0),
    coverUrl: row.coverUrl || row.cover_url || "",
    source: row.source || "upload",
    isPublic: row.isPublic !== false && row.is_public !== false,
    createdByUserId: row.createdByUserId || row.created_by_user_id || null,
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at,
  };
}

async function listLibraryTracks({ userId, baseUrl } = {}) {
  if (musicDatabase.isAvailable()) {
    const rows = await musicDatabase.listTracks({ userId });
    return rows.map((row) => toPublicTrack(row, baseUrl));
  }
  // Prefer Supabase if table exists
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from("music_tracks")
        .select("*")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!error && Array.isArray(data) && data.length) {
        return data.map((r) =>
          toPublicTrack(
            {
              id: r.id,
              title: r.title,
              artist: r.artist,
              audioUrl: r.audio_url,
              duration: r.duration,
              coverUrl: r.cover_url,
              source: r.source,
              isPublic: r.is_public,
              createdByUserId: r.created_by_user_id,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            },
            baseUrl,
          ),
        );
      }
    } catch {
      /* fall through to file store */
    }
  }
  return store.listTracks({ userId }).map((t) => toPublicTrack(t, baseUrl));
}

async function searchLibraryTracks(q, { limit, userId, baseUrl } = {}) {
  if (musicDatabase.isAvailable()) {
    const rows = String(q || "").trim()
      ? await musicDatabase.searchTracks(q, { limit, userId })
      : await musicDatabase.listTracks({ limit, userId });
    return rows.map((row) => toPublicTrack(row, baseUrl));
  }
  if (isSupabaseConfigured) {
    try {
      const term = `%${String(q || "").trim()}%`;
      let query = supabase
        .from("music_tracks")
        .select("*")
        .eq("is_public", true)
        .limit(Math.min(100, Number(limit) || 30));
      if (q) {
        query = query.or(`title.ilike.${term},artist.ilike.${term}`);
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        return data.map((r) =>
          toPublicTrack(
            {
              id: r.id,
              title: r.title,
              artist: r.artist,
              audioUrl: r.audio_url,
              duration: r.duration,
              coverUrl: r.cover_url,
              source: r.source,
              isPublic: r.is_public,
              createdByUserId: r.created_by_user_id,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            },
            baseUrl,
          ),
        );
      }
    } catch {
      /* file store */
    }
  }
  return store
    .searchTracks(q, { limit, userId })
    .map((t) => toPublicTrack(t, baseUrl));
}

async function uploadLibraryTrack({
  buffer,
  mimetype,
  originalname,
  size,
  title,
  artist,
  duration,
  coverUrl,
  userId,
  baseUrl,
}) {
  validateAudioFile({ mimetype, size, originalname });
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error("File rỗng");
    err.status = 400;
    throw err;
  }

  const ext =
    (originalname && originalname.split(".").pop()) ||
    (mimetype && mimetype.split("/").pop()) ||
    "mp3";

  if (musicDatabase.isAvailable()) {
    const saved = await uploadPersistentMedia({
      buffer,
      contentType: mimetype,
      filename: originalname || `track.${ext}`,
      mediaType: "audio",
    });
    const row = await musicDatabase.createTrack({
      title: title || originalname || "Uploaded track",
      artist: artist || "",
      audioUrl: `gdrive:${saved.id}`,
      duration: Number(duration) || 0,
      coverUrl: coverUrl || "",
      source: "upload",
      isPublic: true,
      createdByUserId: userId || null,
    });
    return toPublicTrack(row, baseUrl);
  }

  const saved = store.saveAudioFile(buffer, ext);
  const audioUrl = `audio/${saved.filename}`;

  const row = store.createTrack({
    title: title || originalname || "Uploaded track",
    artist: artist || "",
    audioUrl,
    duration: Number(duration) || 0,
    coverUrl: coverUrl || "",
    source: "upload",
    isPublic: true,
    createdByUserId: userId || null,
  });

  // Best-effort Supabase mirror
  if (isSupabaseConfigured) {
    try {
      await supabase.from("music_tracks").insert({
        id: row.id,
        title: row.title,
        artist: row.artist,
        audio_url: `${baseUrl}/api/music/audio/${saved.filename}`,
        duration: row.duration,
        cover_url: row.coverUrl,
        source: "upload",
        is_public: true,
        created_by_user_id: userId || null,
      });
    } catch {
      /* optional */
    }
  }

  return toPublicTrack(row, baseUrl);
}

async function attachMomentMusic({
  momentId,
  musicTrackId,
  startTime,
  endTime,
  volume,
  originalVideoVolume,
  baseUrl,
}) {
  const row = musicDatabase.isAvailable()
    ? await musicDatabase.upsertMomentMusic({
        momentId,
        musicTrackId,
        startTime,
        endTime,
        volume,
        originalVideoVolume,
      })
    : store.upsertMomentMusic({
        momentId,
        musicTrackId,
        startTime,
        endTime,
        volume,
        originalVideoVolume,
      });

  if (isSupabaseConfigured) {
    try {
      await supabase.from("moment_music").upsert({
        moment_id: momentId,
        music_track_id: musicTrackId,
        start_time: row.startTime,
        end_time: row.endTime,
        volume: row.volume,
        original_video_volume: row.originalVideoVolume,
        updated_at: new Date().toISOString(),
      });
    } catch {
      /* optional */
    }
  }

  return {
    id: row.id,
    momentId: row.momentId,
    musicTrackId: row.musicTrackId,
    startTime: row.startTime,
    endTime: row.endTime,
    volume: row.volume,
    originalVideoVolume: row.originalVideoVolume,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    track: toPublicTrack(row.track, baseUrl),
  };
}

async function getMomentMusic(momentId, baseUrl) {
  const row = musicDatabase.isAvailable()
    ? await musicDatabase.getMomentMusic(momentId)
    : store.getMomentMusic(momentId);
  if (!row) return null;
  return {
    id: row.id,
    momentId: row.momentId,
    musicTrackId: row.musicTrackId,
    startTime: row.startTime,
    endTime: row.endTime,
    volume: row.volume,
    originalVideoVolume: row.originalVideoVolume,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    track: toPublicTrack(row.track, baseUrl),
  };
}

async function removeMomentMusic(momentId) {
  return musicDatabase.isAvailable()
    ? musicDatabase.deleteMomentMusic(momentId)
    : store.deleteMomentMusic(momentId);
}

function resolveAudioFile(filename) {
  return store.getAudioAbsolutePath(filename);
}

async function resolvePersistentAudio(fileId) {
  return downloadPersistentMedia(fileId);
}

module.exports = {
  listLibraryTracks,
  searchLibraryTracks,
  uploadLibraryTrack,
  attachMomentMusic,
  getMomentMusic,
  removeMomentMusic,
  resolveAudioFile,
  resolvePersistentAudio,
  validateAudioFile,
  MAX_AUDIO_BYTES,
  toPublicTrack,
};
