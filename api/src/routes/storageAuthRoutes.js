const express = require("express");
const rateLimit = require("express-rate-limit");
const { instanceFirebaseV2 } = require("../libs");
const draftFileStore = require("../modules/drafts/draftFileStore");
const draftMetaStore = require("../modules/drafts/draftMetaStore");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: "RATE_LIMITED", error: "Too many storage auth requests" },
});

function safeUid(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

router.post("/verify", limiter, async (req, res) => {
  const mode = String(req.body?.mode || "bearer").toLowerCase();

  if (mode === "signed") {
    const ownerUid = safeUid(req.body?.ownerUid);
    const draftId = safeId(req.body?.draftId);
    const role = String(req.body?.role || "");
    const exp = Number(req.body?.exp || 0);
    const sig = String(req.body?.sig || "");

    if (!ownerUid || !draftId || !draftFileStore.ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ success: false, code: "INVALID_STORAGE_PROOF" });
    }

    const valid = draftFileStore.verifyAccess({
      ownerUid,
      draftId,
      role,
      exp,
      sig,
    });
    if (!valid) {
      return res.status(403).json({ success: false, code: "INVALID_STORAGE_PROOF" });
    }

    const draft = await draftMetaStore.getDraft(ownerUid, draftId).catch(() => null);
    if (!draft) {
      return res.status(404).json({ success: false, code: "DRAFT_NOT_FOUND" });
    }

    return res.json({ success: true, uid: ownerUid });
  }

  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED" });
  }

  const idToken = authorization.slice(7).trim();
  if (!idToken) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED" });
  }

  try {
    // Do not merely decode this JWT. Firebase's getAccountInfo endpoint validates
    // the ID token against the real Locket Firebase project configured on this API.
    const authResponse = await instanceFirebaseV2.post("getAccountInfo", { idToken });
    const user = authResponse?.data?.users?.[0];
    const uid = safeUid(user?.localId);
    if (!uid) {
      return res.status(401).json({ success: false, code: "INVALID_TOKEN" });
    }

    const expectedUid = safeUid(req.body?.expectedUid);
    if (expectedUid && expectedUid !== uid) {
      return res.status(403).json({ success: false, code: "UID_MISMATCH" });
    }

    return res.json({ success: true, uid });
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    if (status === 400 || status === 401 || status === 403) {
      return res.status(401).json({ success: false, code: "INVALID_TOKEN" });
    }
    console.warn("[storage-auth] Firebase verification unavailable:", error?.code || error?.message || "unknown");
    return res.status(503).json({ success: false, code: "AUTH_VERIFY_UNAVAILABLE" });
  }
});

module.exports = router;
