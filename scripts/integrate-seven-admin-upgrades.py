from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"Patch anchor not found: {label}")
    return text.replace(old, new, 1)


def patch_backend():
    path = Path("api/src/routes/adminRoutes.js")
    text = path.read_text()

    if "../services/adminDeployments" not in text:
        text = replace_once(
            text,
            'const { sendAdminApologyEmail } = require("../services/adminApologyMailer");',
            'const { sendAdminApologyEmail, buildAdminEmail, getMailTemplates, normalizeTemplate } = require("../services/adminApologyMailer");\nconst { getRecentDeployments, rollbackMainToCommit } = require("../services/adminDeployments");',
            "admin ops imports",
        )

    if "ADMIN_UNDO_WINDOW_MS" not in text:
        undo_helpers = '''const ADMIN_UNDO_WINDOW_MS = 30_000;
const adminUndoActions = new Map();

function createUndoAction({ adminUid, type, uid, previous }) {
  const undoToken = crypto.randomBytes(24).toString("hex");
  const undoUntil = Date.now() + ADMIN_UNDO_WINDOW_MS;
  adminUndoActions.set(undoToken, { adminUid, type, uid, previous, undoUntil });
  const timer = setTimeout(() => adminUndoActions.delete(undoToken), ADMIN_UNDO_WINDOW_MS + 5_000);
  timer.unref?.();
  return { undoToken, undoUntil };
}
'''
        text = replace_once(
            text,
            'const router = express.Router();\n',
            'const router = express.Router();\n\n' + undo_helpers + '\n',
            "undo helper insertion",
        )

    if 'message: "Đã khóa tài khoản. Có thể hoàn tác trong 30 giây."' not in text:
        text = replace_once(
            text,
            '''    const updated = await setAccountStatus(req.params.uid, "locked");
    if (!updated) return res.status(404).json({ success: false, code: "USER_NOT_FOUND", error: "User not found" });
    await audit(req, "LOCK_WEB_USER", req.params.uid, `Locked account. Reason: ${reason}`);
    return res.status(200).json({ success: true });''',
            '''    const previousUser = await getWebUser(req.params.uid);
    const previousStatus = String(
      previousUser?.account_status || previousUser?.accountStatus || (previousUser?.disabled ? "locked" : "active"),
    ).trim().toLowerCase() === "locked" ? "locked" : "active";
    const updated = await setAccountStatus(req.params.uid, "locked");
    if (!updated) return res.status(404).json({ success: false, code: "USER_NOT_FOUND", error: "User not found" });
    const undo = previousStatus !== "locked"
      ? createUndoAction({ adminUid: req.adminUid, type: "account_status", uid: req.params.uid, previous: previousStatus })
      : {};
    await audit(req, "LOCK_WEB_USER", req.params.uid, `Locked account. Reason: ${reason}`);
    return res.status(200).json({ success: true, ...undo, message: "Đã khóa tài khoản. Có thể hoàn tác trong 30 giây." });''',
            "lock undo",
        )

    if 'message: "Đã mở khóa tài khoản. Có thể hoàn tác trong 30 giây."' not in text:
        text = replace_once(
            text,
            '''    const updated = await setAccountStatus(req.params.uid, "active");
    if (!updated) return res.status(404).json({ success: false, code: "USER_NOT_FOUND", error: "User not found" });
    await audit(req, "UNLOCK_WEB_USER", req.params.uid, `Unlocked account. Reason: ${reason}`);
    return res.status(200).json({ success: true });''',
            '''    const previousUser = await getWebUser(req.params.uid);
    const previousStatus = String(
      previousUser?.account_status || previousUser?.accountStatus || (previousUser?.disabled ? "locked" : "active"),
    ).trim().toLowerCase() === "locked" ? "locked" : "active";
    const updated = await setAccountStatus(req.params.uid, "active");
    if (!updated) return res.status(404).json({ success: false, code: "USER_NOT_FOUND", error: "User not found" });
    const undo = previousStatus !== "active"
      ? createUndoAction({ adminUid: req.adminUid, type: "account_status", uid: req.params.uid, previous: previousStatus })
      : {};
    await audit(req, "UNLOCK_WEB_USER", req.params.uid, `Unlocked account. Reason: ${reason}`);
    return res.status(200).json({ success: true, ...undo, message: "Đã mở khóa tài khoản. Có thể hoàn tác trong 30 giây." });''',
            "unlock undo",
        )

    if 'message: "Đã đổi vai trò. Có thể hoàn tác trong 30 giây."' not in text:
        text = replace_once(
            text,
            '''    await setUserRole(req.params.uid, newRole, req.adminUid);
    await audit(req, "ASSIGN_ROLE", req.params.uid, `Assigned role '${newRole}'. Reason: ${reason || "Revoked to standard user"}`);
    return res.status(200).json({ success: true, role: newRole });''',
            '''    const roleUser = await getWebUser(req.params.uid);
    const previousRole = String(await getUserRole(req.params.uid, roleUser?.email) || "user").trim().toLowerCase();
    await setUserRole(req.params.uid, newRole, req.adminUid);
    const undo = previousRole !== newRole
      ? createUndoAction({ adminUid: req.adminUid, type: "role", uid: req.params.uid, previous: previousRole })
      : {};
    await audit(req, "ASSIGN_ROLE", req.params.uid, `Assigned role '${newRole}'. Reason: ${reason || "Revoked to standard user"}`);
    return res.status(200).json({ success: true, role: newRole, ...undo, message: "Đã đổi vai trò. Có thể hoàn tác trong 30 giây." });''',
            "role undo",
        )

    if "normalizeTemplate(req.body?.template)" not in text:
        selector = '''  const template = ["apology", "restored"].includes(String(req.body?.template || "").trim().toLowerCase())
    ? String(req.body.template).trim().toLowerCase()
    : "apology";'''
        replacement = '''  const template = normalizeTemplate(req.body?.template);
  const customMessage = String(req.body?.customMessage || "").trim().slice(0, 2500);'''
        if text.count(selector) != 2:
            raise RuntimeError(f"Expected 2 legacy mail selectors, found {text.count(selector)}")
        text = text.replace(selector, replacement)

        guard = 'if (accountStatus === "locked" || user.disabled === true) {'
        if text.count(guard) != 2:
            raise RuntimeError(f"Expected 2 legacy lock guards, found {text.count(guard)}")
        text = text.replace(
            guard,
            'if ((template === "apology" || template === "restored") && (accountStatus === "locked" || user.disabled === true)) {',
        )

        pattern = re.compile(r'(\n      template,\n)(      idempotencyKey: `admin-(?:general|user)-mail:)')
        text, count = pattern.subn(r'\1      customMessage,\n\2', text)
        if count != 2:
            raise RuntimeError(f"Expected 2 custom message injections, found {count}")

    if 'router.get("/mail-templates"' not in text:
        routes = r'''

router.get("/mail-templates", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({ success: true, templates: getMailTemplates() });
});

router.post("/mail-preview", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const email = String(req.body?.email || req.adminEmail || "preview@example.com").trim().toLowerCase();
  const preview = buildAdminEmail({
    email,
    displayName: String(req.body?.displayName || "Người dùng").trim(),
    uid: String(req.body?.uid || "").trim(),
    template: normalizeTemplate(req.body?.template),
    customMessage: String(req.body?.customMessage || "").trim().slice(0, 2500),
  });
  return res.status(200).json({ success: true, preview: {
    template: preview.template,
    label: preview.label,
    subject: preview.subject,
    title: preview.title,
    badge: preview.badge,
    statusLabel: preview.statusLabel,
    html: preview.html,
  } });
});

router.get("/mail-history", requireActivityDatabase, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Chỉ Admin hoặc Super Admin mới được xem lịch sử thư" });
  }
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
    const result = await listAuditLogs({ limit: 200, offset: 0 });
    const items = (result.logs || [])
      .filter((entry) => ["SEND_ADMIN_MAIL", "SEND_ACCOUNT_APOLOGY_EMAIL", "TEST_ADMIN_EMAIL"].includes(entry.action))
      .slice(0, limit);
    return res.status(200).json({ success: true, items });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Không thể tải lịch sử thư quản trị" });
  }
});

router.post("/system/test-email", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!req.adminEmail) return res.status(400).json({ success: false, error: "Admin chưa có email để test Gmail" });
  try {
    const result = await sendAdminApologyEmail({
      email: String(req.adminEmail).trim().toLowerCase(),
      displayName: "Admin",
      uid: req.adminUid,
      template: "feature",
      customMessage: `Đây là email kiểm tra Gmail relay từ Admin Operations Suite lúc ${new Date().toISOString()}.`,
      idempotencyKey: `admin-gmail-self-test:${req.adminUid}:${Date.now()}`,
    });
    await audit(req, "TEST_ADMIN_EMAIL", req.adminUid, `Gmail relay self-test to ${req.adminEmail}`);
    return res.status(200).json({ success: true, email: req.adminEmail, provider: result.provider });
  } catch (error) {
    await audit(req, "TEST_ADMIN_EMAIL", req.adminUid, `Gmail relay self-test failed: ${error?.code || error?.message || "unknown"}`, "failure");
    return res.status(Number(error?.status) || 502).json({ success: false, code: error?.code || "EMAIL_SEND_FAILED", error: error?.message || "Gmail test thất bại" });
  }
});

router.get("/deployments", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, error: "Không có quyền xem lịch sử deployment" });
  }
  try {
    const data = await getRecentDeployments();
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    return res.status(Number(error?.status) || 502).json({ success: false, code: error?.code || "DEPLOYMENTS_FAILED", error: error?.message || "Không tải được deployment" });
  }
});

router.post("/deployments/rollback", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin") return res.status(403).json({ success: false, error: "Chỉ Super Admin mới được rollback production" });
  if (String(req.body?.confirmation || "").trim().toUpperCase() !== "ROLLBACK") {
    return res.status(400).json({ success: false, code: "ROLLBACK_CONFIRMATION_REQUIRED", error: "Cần nhập ROLLBACK để xác nhận" });
  }
  try {
    const result = await rollbackMainToCommit({ sha: req.body?.sha, requestedBy: req.adminUid });
    await audit(req, "ROLLBACK_PRODUCTION", null, `Rollback main from ${result.previousSha} to ${result.targetSha}; backup=${result.backupBranch || "none"}`);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    await audit(req, "ROLLBACK_PRODUCTION", null, `Rollback failed: ${error?.code || error?.message || "unknown"}`, "failure");
    return res.status(Number(error?.status) || 502).json({ success: false, code: error?.code || "ROLLBACK_FAILED", error: error?.message || "Rollback thất bại" });
  }
});

router.post("/undo/:token", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const token = String(req.params.token || "").trim();
  const undo = adminUndoActions.get(token);
  if (!undo) return res.status(404).json({ success: false, code: "UNDO_NOT_FOUND", error: "Thao tác không còn khả năng hoàn tác" });
  if (Date.now() > undo.undoUntil) {
    adminUndoActions.delete(token);
    return res.status(410).json({ success: false, code: "UNDO_EXPIRED", error: "Đã hết 30 giây hoàn tác" });
  }
  if (undo.adminUid !== req.adminUid && req.adminRole !== "super_admin") {
    return res.status(403).json({ success: false, code: "UNDO_OWNER_REQUIRED", error: "Chỉ Admin đã thực hiện hoặc Super Admin mới được hoàn tác" });
  }
  try {
    if (undo.type === "account_status") {
      await setAccountStatus(undo.uid, undo.previous === "locked" ? "locked" : "active");
    } else if (undo.type === "role") {
      await setUserRole(undo.uid, undo.previous || "user", req.adminUid);
    } else {
      return res.status(400).json({ success: false, error: "Loại thao tác không hỗ trợ hoàn tác" });
    }
    adminUndoActions.delete(token);
    await audit(req, "UNDO_ADMIN_ACTION", undo.uid, `Undid ${undo.type}; restored previous=${undo.previous}`);
    return res.status(200).json({ success: true, message: "Đã hoàn tác và khôi phục trạng thái trước đó." });
  } catch (error) {
    return res.status(500).json({ success: false, code: "UNDO_FAILED", error: "Không thể khôi phục trạng thái trước đó" });
  }
});
'''
        text = replace_once(
            text,
            '\nrouter.get("/broadcast", async (req, res) => {',
            routes + '\nrouter.get("/broadcast", async (req, res) => {',
            "admin ops endpoint insertion",
        )

    path.write_text(text)


def patch_admin_users():
    path = Path("src/pages/Public/AdminUsers/index.jsx")
    page = path.read_text()

    guard = '''    if (user?.disabled || String(user?.accountStatus || "").toLowerCase() === "locked") {
      SonnerWarning("Hãy mở khóa tài khoản trước", "Sau khi mở khóa, bạn có thể chọn mẫu thư và gửi cho người dùng.");
      return;
    }
'''
    if guard in page:
        page = page.replace(guard, "", 1)

    old_label = '''      const templateLabel = mailTemplate === "restored"
        ? "Xác nhận đã mở khóa"
        : "Xin lỗi khóa nhầm";'''
    if old_label in page:
        page = page.replace(
            old_label,
            '''      const templateLabel = ({
        apology: "Xin lỗi khóa nhầm",
        restored: "Xác nhận đã mở khóa",
        warning: "Cảnh báo tài khoản",
        maintenance: "Thông báo bảo trì",
        incident: "Thông báo sự cố",
        welcome: "Chào mừng người dùng",
        feature: "Thông báo tính năng mới",
      })[mailTemplate] || "Thư quản trị";''',
            1,
        )

    if "Safety Mode chưa xác nhận" not in page:
        anchor = '''    if (!reason?.trim() && type !== "unlock") {
      SonnerInfo("Vui lòng nhập đầy đủ lý do bắt buộc để tiếp tục");
      return;
    }

    setActionLoading(`${type}-${user.uid}`);'''
        page = replace_once(
            page,
            anchor,
            '''    if (!reason?.trim() && type !== "unlock") {
      SonnerInfo("Vui lòng nhập đầy đủ lý do bắt buộc để tiếp tục");
      return;
    }

    if (["lock", "revoke", "role", "nuke"].includes(type)) {
      const safety = window.__adminSafetyConfirmation;
      const expected = String(safety?.target || "").trim();
      const entered = String(safety?.value || "").trim();
      if (!safety || safety.actionType !== type || !expected || entered.toLowerCase() !== expected.toLowerCase()) {
        SonnerWarning("🛡️ Safety Mode chưa xác nhận", `Hãy nhập chính xác ${expected || "đối tượng hiển thị trong khung xác nhận"} trước khi tiếp tục.`);
        return;
      }
    }

    setActionLoading(`${type}-${user.uid}`);''',
            "frontend safety check",
        )

    old_lock_call = '''        await adminRequest(`/users/${encodeURIComponent(user.uid)}/${type}`, {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        });
        const nextDisabled = type === "lock";'''
    if old_lock_call in page:
        page = page.replace(
            old_lock_call,
            '''        const actionResult = await adminRequest(`/users/${encodeURIComponent(user.uid)}/${type}`, {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        });
        if (actionResult?.undoToken && actionResult?.undoUntil) {
          window.dispatchEvent(new CustomEvent("admin_action_undo_available", { detail: {
            undoToken: actionResult.undoToken,
            undoUntil: actionResult.undoUntil,
            uid: user.uid,
            actionType: type,
            message: actionResult.message || (type === "lock" ? `Đã khóa ${user.email || user.uid}` : `Đã mở khóa ${user.email || user.uid}`),
          } }));
        }
        const nextDisabled = type === "lock";''',
            1,
        )

    old_role_call = '''        await adminRequest(`/users/${encodeURIComponent(user.uid)}/role`, {
          method: "POST",
          body: JSON.stringify({ role: newRole, reason: reason.trim() }),
        });
        SonnerInfo(`Đã gán thành công vai trò ${newRole.toUpperCase()} cho user`);'''
    if old_role_call in page:
        page = page.replace(
            old_role_call,
            '''        const roleResult = await adminRequest(`/users/${encodeURIComponent(user.uid)}/role`, {
          method: "POST",
          body: JSON.stringify({ role: newRole, reason: reason.trim() }),
        });
        if (roleResult?.undoToken && roleResult?.undoUntil) {
          window.dispatchEvent(new CustomEvent("admin_action_undo_available", { detail: {
            undoToken: roleResult.undoToken,
            undoUntil: roleResult.undoUntil,
            uid: user.uid,
            actionType: "role",
            message: roleResult.message || `Đã đổi vai trò của ${user.email || user.uid} thành ${newRole}`,
          } }));
        }
        SonnerInfo(`Đã gán thành công vai trò ${newRole.toUpperCase()} cho user`);''',
            1,
        )

    old_target = 'Bạn đang thực hiện thao tác <strong className="uppercase text-primary font-bold">{actionModal.type}</strong> đối với tài khoản <strong>{userName(actionModal.user)}</strong>. Hành động này sẽ được ghi nhận vào nhật ký Audit Log vĩnh viễn.'
    if old_target in page:
        page = page.replace(
            old_target,
            'Bạn đang thực hiện thao tác <strong className="uppercase text-primary font-bold">{actionModal.type}</strong> đối với tài khoản <strong>{userName(actionModal.user)}</strong> — <strong>{actionModal.user?.email || "không có email"}</strong> — UID: <strong>{actionModal.user?.uid}</strong>. Hành động này sẽ được ghi nhận vào nhật ký Audit Log vĩnh viễn.',
            1,
        )

    if "locket_admin_users_refresh" not in page:
        page = replace_once(
            page,
            '  const isOnline = useCallback((user) => {',
            '''  useEffect(() => {
    const refreshAfterUndo = () => fetchUsers("", { silent: true, live: true });
    window.addEventListener("locket_admin_users_refresh", refreshAfterUndo);
    return () => window.removeEventListener("locket_admin_users_refresh", refreshAfterUndo);
  }, [fetchUsers]);

  const isOnline = useCallback((user) => {''',
            "undo refresh effect",
        )

    path.write_text(page)


def patch_media_viewer():
    path = Path("src/pages/LocketCameraBeta/BottomHomeScreen/Views/SwiperView/MomentViewer.jsx")
    text = path.read_text()

    if 'logWebUserAction' not in text:
        text = replace_once(
            text,
            'import { GetAllMoments } from "@/services";\n',
            'import { GetAllMoments } from "@/services";\nimport { logWebUserAction } from "@/services/UserActivityService";\n',
            "media telemetry import",
        )

        text = replace_once(
            text,
            '''    setImageFailed(true);
  };

  const handleVideoError = () => {''',
            '''    void logWebUserAction({
      actionType: "MEDIA_ERROR",
      actionTitle: "Ảnh Moment không tải được sau self-heal",
      details: { kind: "image", momentId, ownerUid, url: imageSrc, alternateHostTried: true },
    });
    setImageFailed(true);
  };

  const handleVideoError = () => {''',
            "image media telemetry",
        )

        text = replace_once(
            text,
            '''    setVideoFailed(true);
  };

  const refetchCurrentMoment = async () => {''',
            '''    void logWebUserAction({
      actionType: "MEDIA_ERROR",
      actionTitle: "Video Moment không tải được sau self-heal",
      details: { kind: "video", momentId, ownerUid, url: videoSrc, alternateHostTried: true },
    });
    setVideoFailed(true);
  };

  const refetchCurrentMoment = async () => {''',
            "video media telemetry",
        )

    path.write_text(text)


patch_backend()
patch_admin_users()
patch_media_viewer()
print("Seven admin upgrades integrated successfully")
