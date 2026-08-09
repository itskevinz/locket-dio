const express = require("express");
const {
  verifyIdToken,
  verifyIdTokenOptional,
} = require("../../middlewares/Auth");
const ctrl = require("./drafts.controller");

const router = express.Router();

// All draft CRUD requires auth
router.get("/drafts", verifyIdToken, ctrl.listDrafts);
router.get("/drafts/:id", verifyIdToken, ctrl.getDraft);
router.post("/drafts", verifyIdToken, ctrl.upsertDraft);
router.put("/drafts/:id", verifyIdToken, ctrl.upsertDraft);
router.patch("/drafts/:id", verifyIdToken, ctrl.patchDraft);
router.delete("/drafts/:id", verifyIdToken, ctrl.deleteDraft);

// Media download: signed OR bearer (handler checks)
router.get(
  "/drafts/:id/media/:role",
  verifyIdTokenOptional,
  ctrl.downloadMedia,
);

module.exports = { draftRoutes: router, draftUploadLimiter: ctrl.uploadLimiter };
