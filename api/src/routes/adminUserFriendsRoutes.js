const express = require("express");
const crypto = require("node:crypto");

const {
  getAdminLocketEmails,
  getAdminLocketUids,
  getLocketAuthVerifier,
} = require("../services/locketAdminVerifier");
const {
  getUserRole,
  getWebUser,
  hasActivityDatabase,
  verifyAdminSessionToken,
  writeAudit,
} = require("../services/userActivityStore");
const { getRequestContext } = require("../services/userActivityContext");
const { listUserFriendsForAdmin } = require("../services/adminUserFriends");

const router = express.Router();

async function requireAdmin(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      code: "UNAUTHORIZED",
      error: "Unauthorized",
    });
  }

  try {
    const decodedToken = await getLocketAuthVerifier().verifyIdToken(
      authorization.slice(7),
      false,
    );
    const email = String(decodedToken.email || "").trim().toLowerCase();
    const allowedUids = getAdminLocketUids();
    const allowedEmails = getAdminLocketEmails();

    let role = "user";
    if (hasActivityDatabase()) {
      role = await getUserRole(decodedToken.uid, email);
    } else if (allowedUids.has(decodedToken.uid) || allowedEmails.has(email)) {
      role = "super_admin";
    }

    if (
      role === "user" &&
      !allowedUids.has(decodedToken.uid) &&
      !allowedEmails.has(email)
    ) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PERMISSION_REQUIRED",
        error: "Admin permission required",
      });
    }

    if (role === "user") role = "super_admin";
    req.adminUid = decodedToken.uid;
    req.adminEmail = decodedToken.email || null;
    req.adminRole = role;
    req.authTime = decodedToken.auth_time || Math.floor(Date.now() / 1000);
    return next();
  } catch (error) {
    console.warn(
      "[admin-user-friends] admin token verification failed",
      error?.code || error?.name || "unknown",
    );
    return res.status(401).json({
      success: false,
      code: "UNAUTHORIZED",
      error: "Unauthorized",
    });
  }
}

function requireActivityDatabase(_req, res, next) {
  if (!hasActivityDatabase()) {
    return res.status(503).json({
      success: false,
      code: "DATABASE_NOT_CONFIGURED",
      error: "User activity database is not configured",
    });
  }
  return next();
}

async function requireActiveAdminSession(req, res, next) {
  const sessionToken = req.headers["x-admin-session"];
  if (sessionToken && typeof sessionToken === "string") {
    const hash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    if (await verifyAdminSessionToken(req.adminUid, hash, 30)) return next();
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - (req.authTime || 0) < 1800) return next();

  return res.status(401).json({
    success: false,
    code: "ADMIN_SESSION_EXPIRED",
    error: "Phiên quản trị nhạy cảm đã hết hạn. Vui lòng xác minh lại mã PIN.",
  });
}

async function audit(req, targetUid, details, status = "success") {
  try {
    const ctx = getRequestContext(req);
    await writeAudit({
      adminUid: req.adminUid,
      role: req.adminRole || "unknown",
      action: "VIEW_USER_LOCKET_FRIENDS",
      targetUid,
      details,
      ipAddress: ctx.ipAddress,
      webSource: ctx.webSource,
      status,
    });
  } catch (error) {
    console.warn(
      "[admin-user-friends] audit write failed",
      error?.code || error?.name || "unknown",
    );
  }
}

router.use(requireAdmin);

router.get(
  "/users/:uid/friends",
  requireActivityDatabase,
  requireActiveAdminSession,
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");

    if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PERMISSION_REQUIRED",
        error: "Chỉ Admin hoặc Super Admin mới được xem danh sách bạn bè Locket của user.",
      });
    }

    const targetUid = String(req.params.uid || "").trim();
    if (!targetUid) {
      return res.status(400).json({
        success: false,
        code: "USER_UID_REQUIRED",
        error: "Thiếu UID người dùng.",
      });
    }

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 30;
    const pageToken = String(req.query.pageToken || "").trim().slice(0, 2000);

    try {
      const target = await getWebUser(targetUid);
      if (!target) {
        return res.status(404).json({
          success: false,
          code: "USER_NOT_FOUND",
          error: "Không tìm thấy user trong Huy Locket.",
        });
      }

      const result = await listUserFriendsForAdmin(targetUid, {
        limit,
        pageToken: pageToken || null,
      });

      await audit(
        req,
        targetUid,
        `Viewed ${result.count} Locket friend records${pageToken ? " (next page)" : ""}`,
      );

      const targetPhotoURL = target.profile_picture || target.photoURL || null;

      return res.status(200).json({
        success: true,
        user: {
          uid: target.uid,
          email: target.email || null,
          username: target.username || null,
          displayName: target.display_name || target.displayName || null,
          ...(targetPhotoURL ? { photoURL: targetPhotoURL } : {}),
        },
        friends: result.friends,
        count: result.count,
        nextPageToken: result.nextPageToken,
      });
    } catch (error) {
      const status = Number(error?.status || 0);
      const safeStatus = status >= 400 && status < 600 ? status : 500;
      const code = error?.code || "USER_FRIENDS_QUERY_FAILED";

      await audit(
        req,
        targetUid,
        `Failed to view Locket friends: ${code}`,
        "failure",
      );

      console.warn("[admin-user-friends] request failed", {
        targetUid,
        code,
        status: safeStatus,
      });

      return res.status(safeStatus).json({
        success: false,
        code,
        error:
          error?.message ||
          "Không thể tải danh sách bạn bè Locket của user.",
      });
    }
  },
);

module.exports = router;
