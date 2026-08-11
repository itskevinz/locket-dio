const constants = require("../../utils/constants");
const axios = require("axios");
const { verifyCustomeToken } = require("./AuthServices");
const { instanceFirestore, instanceFirebaseV2 } = require("../../libs");

// Lấy thông tin người dùng
const getUserInfoV2 = async (idToken, localId) => {
  try {
    const authResponse = await instanceFirebaseV2.post("getAccountInfo", {
      idToken,
    });
    const userData = authResponse.data?.users?.[0];
    if (!userData) throw new Error("Không tìm thấy user trong Firebase Auth.");
    // console.log(userData);
    const firestoreResponse = await instanceFirestore.get(
      `(default)/documents/users/${localId}`,
      {
        meta: {
          idToken,
        },
      }
    );

    const userDataV2 = firestoreResponse?.data;
    // console.log(userDataV2);
    const result = {
      uid: userDataV2?.fields?.uid?.stringValue || userData.localId,
      localId: userData.localId || localId,
      customAuth: userData.customAuth || null,
      phoneNumber: userData.phoneNumber || null,
      displayName: userData.displayName || null,
      email: userData.email || null,
      lastLoginAt: userData.lastLoginAt || null,
      lastRefreshAt: userData.lastRefreshAt || null,
      // Firebase Auth accounts:lookup trả mốc mật khẩu gần nhất ở trường này.
      // Giữ nguyên timestamp gốc để frontend định dạng theo múi giờ người dùng.
      passwordUpdatedAt: userData.passwordUpdatedAt || null,
      emailVerified: userData.emailVerified || null,

      username: userDataV2?.fields?.username?.stringValue || null,
      firstName: userDataV2?.fields?.first_name?.stringValue || null,
      lastName: userDataV2?.fields?.last_name?.stringValue || null,
      profilePicture:
        userDataV2?.fields?.profile_picture_url?.stringValue || null,
      inviteToken: userDataV2?.fields?.invite_token?.stringValue || null,
      migratedAt: userDataV2?.fields?.migrated_at?.timestampValue || null,
      createdAt: userDataV2?.fields?.created_at?.timestampValue || null,
      lastFriendsChange:
        userDataV2?.fields?.last_friends_change?.timestampValue || null,
      birthday:
        userDataV2?.fields?.birthday?.mapValue?.fields?.encoded_mdd
          ?.integerValue || null,
    };
    return result;
  } catch (error) {
    console.error(
      "❌ Lỗi khi lấy thông tin người dùng:",
      error.response?.data || error.message
    );
    return null;
  }
};

const getUserInfoV3 = async (idToken) => {
  const decodedToken = decodeJWT(idToken);
  const result = await verifyCustomeToken(idToken);
  console.log(result);

  // console.log(loginResponse)
  const url = `${constants.GET_ACCOUNT_INFO_URL_V2}${decodedToken?.uid}`;

  const headersAuth = {
    "Content-Type": "application/json",
    "User-Agent": constants.USER_AGENT,
    "X-Ios-Bundle-Identifier": constants.IOS_BUNDLE_ID,
  };
  console.log(idToken);

  const headersFirestore = {
    Authorization: `Bearer ${idToken}`,
    Accept: "application/json",
  };

  try {
    const authResponse = await axios.post(
      constants.GET_ACCOUNT_INFO_URL,
      { idToken },
      { headers: headersAuth }
    );
    const userData = authResponse.data?.users?.[0];
    console.log("User Data from Auth:", userData);
    if (!userData) throw new Error("Không tìm thấy user trong Firebase Auth.");

    const firestoreResponse = await axios.get(url, {
      headers: headersFirestore,
    });

    const userDataV2 = firestoreResponse.data;
    console.log("User Data from Firestore:", userDataV2);
    return {
      uid: userDataV2?.fields?.uid?.stringValue || userData.localId,
      idToken: idToken,
      localId: userData.localId || decodedToken?.uid,
      username: userDataV2?.fields?.username?.stringValue || null,
      firstName: userDataV2?.fields?.first_name?.stringValue || null,
      lastName: userDataV2?.fields?.last_name?.stringValue || null,
      displayName: userData.displayName || null,
      email: userData.email || null,
      profilePicture:
        userDataV2?.fields?.profile_picture_url?.stringValue || null,
      inviteToken: userDataV2?.fields?.invite_token?.stringValue || null,
      migratedAt: userDataV2?.fields?.migrated_at?.timestampValue || null,
      createdAt: userDataV2?.fields?.created_at?.timestampValue || null,
      lastLoginAt: userData.lastLoginAt || null,
      lastRefreshAt: userData.lastRefreshAt || null,
      passwordUpdatedAt: userData.passwordUpdatedAt || null,
      lastFriendsChange:
        userDataV2?.fields?.last_friends_change?.timestampValue || null,
      birthday:
        userDataV2?.fields?.birthday?.mapValue?.fields?.encoded_mdd
          ?.integerValue || null,
      // friendsList: firestoreResponseFriends.data.documents,
    };
  } catch (error) {
    console.error(
      "❌ Lỗi khi lấy thông tin người dùng:",
      error.response?.data || error.message
    );
    return null;
  }
};

const decodeJWT = (token) => {
  try {
    const payload = token.split(".")[1];
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch (err) {
    console.error("❌ Decode token failed:", err);
    return null;
  }
};

module.exports = { getUserInfoV2 };
