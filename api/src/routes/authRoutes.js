const express = require("express");

const {
  logout,
  loginV2,
  refreshIdTokenControll,
  changeProfileInfo,
  loginAndCaptchaV2,
} = require("../controllers");
const { authBruteForceLimit, refreshTokenLimit, generalApiLimit } = require("../middlewares/securityRateLimiter");
const { logRequestInfo } = require("../middlewares/logRequestInfo");
const { verifyIdToken } = require("../middlewares/Auth");
const { resetPasswordControll, getInfoByToken, loginPhoneController } = require("../controllers/authController");
const {
  requestPhoneChangeOtp,
  confirmPhoneChangeOtp,
} = require("../controllers/profilePhoneController");

const router = express.Router();

//Endpoint liên quan đến Auth
router.post("/loginV2", authBruteForceLimit, logRequestInfo, loginV2);

router.post("/loginWithPhoneV2", authBruteForceLimit, logRequestInfo, loginPhoneController)

router.post("/loginV3", authBruteForceLimit, loginAndCaptchaV2);
router.get("/logout", logout);
router.post("/refresh-token", refreshTokenLimit, logRequestInfo, refreshIdTokenControll);

router.get("/getInfoUser", generalApiLimit, verifyIdToken, getInfoByToken);
router.post("/resetPassword", authBruteForceLimit, resetPasswordControll);

// Luồng đổi số điện thoại thật: phải dùng phiên đăng nhập hiện tại.
router.post(
  "/profile/phone/request-otp",
  generalApiLimit,
  verifyIdToken,
  requestPhoneChangeOtp,
);
router.post(
  "/profile/phone/confirm-otp",
  generalApiLimit,
  verifyIdToken,
  confirmPhoneChangeOtp,
);

// Định tuyến cho thay đổi thông tin profile
router.post("/changeProfileInfo", generalApiLimit, changeProfileInfo);

module.exports = router;
