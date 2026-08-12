const express = require("express");
const { verifyIdToken } = require("../../middlewares/Auth");
const {
  presignedV3,
  mediaUpload,
  mediaTempGet,
  publishedMediaGet,
} = require("./storage.controller");

const storageRoutes = express.Router();

// Client: POST /api/presignedV3 (baseURL=/dio-api → same path)
storageRoutes.post("/presignedV3", verifyIdToken, presignedV3);

// Binary PUT (no JSON body parser) — mounted with express.raw in app.js
storageRoutes.put("/media-upload/:id", mediaUpload);

// Public temp download for postMoment
storageRoutes.get("/media-temp/:id", mediaTempGet);

// Durable public media used as a fallback when Firebase Storage rejects writes.
storageRoutes.get("/published-media/:filename", publishedMediaGet);

module.exports = { storageRoutes };
