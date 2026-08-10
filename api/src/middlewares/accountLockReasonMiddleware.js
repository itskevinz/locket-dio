const {
  clearAccountLock,
  setAccountLock,
} = require("../services/accountLockStore");
const { revokeUserSessions } = require("../services/userActivityStore");

function accountLockReasonMiddleware(req, res, next) {
  const match = String(req.path || "").match(/^\/users\/([^/]+)\/(lock|unlock)\/?$/i);
  if (req.method !== "POST" || !match) return next();

  const uid = decodeURIComponent(match[1]);
  const action = match[2].toLowerCase();
  const reason = String(req.body?.reason || "").trim();
  const originalJson = res.json.bind(res);
  let handled = false;

  res.json = function accountLockJson(payload) {
    if (!handled) {
      handled = true;
      const succeeded = res.statusCode >= 200 && res.statusCode < 300 && payload?.success !== false;
      if (succeeded) {
        if (action === "lock" && reason) {
          void setAccountLock(uid, {
            reason,
            lockedBy: req.adminUid || null,
          })
            .then(() => revokeUserSessions(uid))
            .catch((error) => {
              console.error("Failed to persist account lock reason:", error?.message || error);
            });
        } else if (action === "unlock") {
          void clearAccountLock(uid).catch((error) => {
            console.error("Failed to clear account lock reason:", error?.message || error);
          });
        }
      }
    }
    return originalJson(payload);
  };

  return next();
}

module.exports = { accountLockReasonMiddleware };
