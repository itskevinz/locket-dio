const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const databaseUrl = String(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "",
).trim();
const database = databaseUrl ? neon(databaseUrl) : null;
let schemaPromise = null;

function isAvailable() {
  return Boolean(process.env.VERCEL && database);
}

async function ensureSchema() {
  if (!isAvailable()) throw new Error("Music database is not configured");
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await database`
        CREATE TABLE IF NOT EXISTS huy_locket_music_tracks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          artist TEXT NOT NULL DEFAULT '',
          audio_url TEXT NOT NULL,
          duration DOUBLE PRECISION NOT NULL DEFAULT 0,
          cover_url TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'upload',
          is_public BOOLEAN NOT NULL DEFAULT TRUE,
          created_by_user_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
      await database`
        CREATE INDEX IF NOT EXISTS huy_locket_music_tracks_created_idx
        ON huy_locket_music_tracks (created_at DESC)
      `;
      await database`
        CREATE TABLE IF NOT EXISTS huy_locket_moment_music (
          id TEXT PRIMARY KEY,
          moment_id TEXT NOT NULL UNIQUE,
          music_track_id TEXT NOT NULL,
          start_time DOUBLE PRECISION NOT NULL DEFAULT 0,
          end_time DOUBLE PRECISION NOT NULL DEFAULT 0,
          volume DOUBLE PRECISION NOT NULL DEFAULT 1,
          original_video_volume DOUBLE PRECISION NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function mapTrack(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist || "",
    audioUrl: row.audio_url,
    duration: Number(row.duration || 0),
    coverUrl: row.cover_url || "",
    source: row.source || "upload",
    isPublic: row.is_public !== false,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listTracks({ userId = null, limit = 100 } = {}) {
  await ensureSchema();
  const capped = Math.min(100, Math.max(1, Number(limit) || 100));
  const rows = userId
    ? await database`
        SELECT * FROM huy_locket_music_tracks
        WHERE is_public = TRUE OR created_by_user_id = ${String(userId)}
        ORDER BY created_at DESC LIMIT ${capped}
      `
    : await database`
        SELECT * FROM huy_locket_music_tracks
        WHERE is_public = TRUE
        ORDER BY created_at DESC LIMIT ${capped}
      `;
  return rows.map(mapTrack);
}

async function searchTracks(query, { userId = null, limit = 30 } = {}) {
  await ensureSchema();
  const capped = Math.min(100, Math.max(1, Number(limit) || 30));
  const term = `%${String(query || "").trim()}%`;
  const rows = userId
    ? await database`
        SELECT * FROM huy_locket_music_tracks
        WHERE (is_public = TRUE OR created_by_user_id = ${String(userId)})
          AND (title ILIKE ${term} OR artist ILIKE ${term})
        ORDER BY created_at DESC LIMIT ${capped}
      `
    : await database`
        SELECT * FROM huy_locket_music_tracks
        WHERE is_public = TRUE
          AND (title ILIKE ${term} OR artist ILIKE ${term})
        ORDER BY created_at DESC LIMIT ${capped}
      `;
  return rows.map(mapTrack);
}

async function getTrack(id) {
  await ensureSchema();
  const rows = await database`
    SELECT * FROM huy_locket_music_tracks WHERE id = ${String(id)} LIMIT 1
  `;
  return mapTrack(rows[0]);
}

async function createTrack(input) {
  await ensureSchema();
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    title: String(input.title || "Untitled").slice(0, 200),
    artist: String(input.artist || "").slice(0, 200),
    audioUrl: String(input.audioUrl || ""),
    duration: Number(input.duration) || 0,
    coverUrl: String(input.coverUrl || ""),
    source: String(input.source || "upload"),
    isPublic: input.isPublic !== false,
    createdByUserId: input.createdByUserId || null,
    createdAt: now,
    updatedAt: now,
  };
  if (!row.audioUrl) throw Object.assign(new Error("audioUrl required"), { status: 400 });
  await database`
    INSERT INTO huy_locket_music_tracks
      (id, title, artist, audio_url, duration, cover_url, source, is_public,
       created_by_user_id, created_at, updated_at)
    VALUES
      (${row.id}, ${row.title}, ${row.artist}, ${row.audioUrl}, ${row.duration},
       ${row.coverUrl}, ${row.source}, ${row.isPublic}, ${row.createdByUserId},
       ${row.createdAt}, ${row.updatedAt})
  `;
  return row;
}

function clamp01(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

async function upsertMomentMusic(input) {
  await ensureSchema();
  const momentId = String(input.momentId || "");
  if (!momentId) throw Object.assign(new Error("momentId required"), { status: 400 });
  const track = await getTrack(input.musicTrackId);
  if (!track) throw Object.assign(new Error("music track not found"), { status: 404 });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const startTime = Number(input.startTime) || 0;
  const endTime = Number(input.endTime) || track.duration || 0;
  const volume = clamp01(input.volume, 1);
  const originalVideoVolume = clamp01(input.originalVideoVolume, 1);
  const rows = await database`
    INSERT INTO huy_locket_moment_music
      (id, moment_id, music_track_id, start_time, end_time, volume,
       original_video_volume, created_at, updated_at)
    VALUES
      (${id}, ${momentId}, ${track.id}, ${startTime}, ${endTime}, ${volume},
       ${originalVideoVolume}, ${now}, ${now})
    ON CONFLICT (moment_id) DO UPDATE SET
      music_track_id = EXCLUDED.music_track_id,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      volume = EXCLUDED.volume,
      original_video_volume = EXCLUDED.original_video_volume,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
  const row = rows[0];
  return {
    id: row.id,
    momentId: row.moment_id,
    musicTrackId: row.music_track_id,
    startTime: Number(row.start_time || 0),
    endTime: Number(row.end_time || 0),
    volume: Number(row.volume ?? 1),
    originalVideoVolume: Number(row.original_video_volume ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    track,
  };
}

async function getMomentMusic(momentId) {
  await ensureSchema();
  const rows = await database`
    SELECT * FROM huy_locket_moment_music WHERE moment_id = ${String(momentId)} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const track = await getTrack(row.music_track_id);
  return {
    id: row.id,
    momentId: row.moment_id,
    musicTrackId: row.music_track_id,
    startTime: Number(row.start_time || 0),
    endTime: Number(row.end_time || 0),
    volume: Number(row.volume ?? 1),
    originalVideoVolume: Number(row.original_video_volume ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    track,
  };
}

async function deleteMomentMusic(momentId) {
  await ensureSchema();
  const rows = await database`
    DELETE FROM huy_locket_moment_music
    WHERE moment_id = ${String(momentId)}
    RETURNING id
  `;
  return { deleted: rows.length };
}

module.exports = {
  isAvailable,
  listTracks,
  searchTracks,
  createTrack,
  upsertMomentMusic,
  getMomentMusic,
  deleteMomentMusic,
};
