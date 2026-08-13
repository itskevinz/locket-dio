const express = require("express");
const multer = require("multer");
const { musicSearchLimit, generalApiLimit } = require("../../../middlewares/securityRateLimiter");
const { logRequestInfo } = require("../../../middlewares/logRequestInfo");
const { verifyIdToken } = require("../../../middlewares/Auth");
const {
  getInfoTrack,
  getInfoMusicController,
  getInfoMusicControllerV2,
} = require("../controllers");
const {
  getInfoMusicControllerV3,
  searchMusicController,
} = require("../controllers/music.controller.v2");
const {
  listTracksController,
  searchTracksController,
  uploadTrackController,
  streamAudioController,
  streamPersistentAudioController,
  attachMomentMusicController,
  getMomentMusicController,
  deleteMomentMusicController,
} = require("../controllers/musicLibrary.controller");
const { MAX_AUDIO_BYTES } = require("../services/musicLibrary.service");

const musicRoutes = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
});

// ── Legacy Spotify / Apple info ──
musicRoutes.post("/spotify", generalApiLimit, logRequestInfo, verifyIdToken, getInfoTrack);
musicRoutes.post("/spotifyV2", generalApiLimit, logRequestInfo, verifyIdToken, getInfoTrack);
musicRoutes.post("/getInfoMusic", generalApiLimit, getInfoMusicController);
musicRoutes.post("/getInfoMusicV3", generalApiLimit, getInfoMusicControllerV2);
musicRoutes.post("/getInfoMusicV2", generalApiLimit, getInfoMusicControllerV3);
musicRoutes.post("/searchMusic", musicSearchLimit, logRequestInfo, searchMusicController);
musicRoutes.get("/searchMusic", musicSearchLimit, logRequestInfo, searchMusicController);

// ── Music library (MusicTrack) ──
musicRoutes.get("/music/tracks", generalApiLimit, logRequestInfo, listTracksController);
musicRoutes.get("/music/search", musicSearchLimit, logRequestInfo, searchTracksController);
musicRoutes.post(
  "/music/upload",
  generalApiLimit,
  logRequestInfo,
  verifyIdToken,
  upload.single("file"),
  uploadTrackController,
);
musicRoutes.get(
  "/music/audio/drive/:id",
  generalApiLimit,
  streamPersistentAudioController,
);
musicRoutes.get("/music/audio/:filename", generalApiLimit, streamAudioController);

// ── MomentMusic ──
musicRoutes.post(
  "/moments/:id/music",
  generalApiLimit,
  logRequestInfo,
  verifyIdToken,
  attachMomentMusicController,
);
musicRoutes.get(
  "/moments/:id/music",
  generalApiLimit,
  logRequestInfo,
  getMomentMusicController,
);
musicRoutes.delete(
  "/moments/:id/music",
  generalApiLimit,
  logRequestInfo,
  verifyIdToken,
  deleteMomentMusicController,
);

module.exports = { musicRoutes };
