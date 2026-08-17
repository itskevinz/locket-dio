import * as utils from "@/utils";
import api from "@/libs/axios";
import { instanceMain } from "@/libs/instanceMain";
import { fetchUserById } from "../LocketServices";
import axios from "axios";

const SEARCH_RETRY_DELAYS_MS = [0, 700, 1600, 3200];
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const successfulSearchCache = new Map();

const normalizeSearchUsername = (value) =>
  String(value || "")
    .trim()
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();

const isNonEmptyUserResult = (result) =>
  Boolean(
    result?.success &&
      result?.data &&
      typeof result.data === "object" &&
      Object.keys(result.data).length > 0,
  );

const getCachedSearchResult = (username) => {
  const cached = successfulSearchCache.get(username);
  if (!cached) return null;
  if (Date.now() - cached.savedAt > SEARCH_CACHE_TTL_MS) {
    successfulSearchCache.delete(username);
    return null;
  }
  return cached.result;
};

const cacheSearchResult = (username, result) => {
  if (!username || !isNonEmptyUserResult(result)) return;
  successfulSearchCache.set(username, {
    savedAt: Date.now(),
    result,
  });
};

const isRecoverableSearchError = (error) => {
  const status = Number(error?.response?.status || error?.status || 0);
  if (status === 401 || status === 403 || status === 429) return false;
  if (!status) return true;
  return [404, 408, 425, 500, 502, 503, 504].includes(status);
};

const waitForSearchRetry = (delayMs, signal) =>
  new Promise((resolve, reject) => {
    if (!delayMs) {
      resolve();
      return;
    }

    if (signal?.aborted) {
      reject(new axios.CanceledError("Search aborted"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(new axios.CanceledError("Search aborted"));
    };

    signal?.addEventListener?.("abort", onAbort, { once: true });
  });

//lấy toàn bộ danh sách bạn bè (uid, createdAt) từ API
// {
//     "uid": "",
//     "createdAt": 1753470386025,
//     "updatedAt": 1753470389669,
//     "sharedHistoryOn": 1753470389647
//     "hidden": true
// }
export const getListIdFriends = async () => {
  try {
    const res = await api.post("locket/getAllFriendsV2");
    const body = res?.data;

    // Hỗ trợ nhiều shape response
    let allFriends =
      body?.data ??
      body?.result?.data ??
      body?.friends ??
      (Array.isArray(body) ? body : null);

    if (!Array.isArray(allFriends)) {
      console.warn("[friends] unexpected response shape", body);
      return null;
    }

    // Lọc null từ gRPC simplify
    return allFriends.filter(
      (f) => f && (f.uid || f.user_uid || f.userUid || f.user),
    ).map((f) => ({
      ...f,
      uid: f.uid || f.user_uid || f.userUid || f.user,
    }));
  } catch (err) {
    console.error("❌ Lỗi khi gọi API get-friends:", err);
    return null;
  }
};

export const loadFriendDetailsV3 = async (friends) => {
  if (!friends || friends.length === 0) {
    return []; // Không fetch nếu không có bạn bè
  }

  const batchSize = 20;
  const allResults = [];

  for (let i = 0; i < friends.length; i += batchSize) {
    const batch = friends.slice(i, i + batchSize);

    try {
      const results = await Promise.allSettled(
        batch.map((friend) =>
          fetchUserById(friend?.uid).then((res) =>
            utils.normalizeFriendDataV2(res),
          ),
        ),
      );

      const successResults = results
        .filter((r) => r.status === "fulfilled" && r.value)
        .map((r) => r.value);

      allResults.push(...successResults);

      // Nghỉ một chút nếu còn batch
      if (i + batchSize < friends.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (err) {
      console.error("❌ Lỗi khi xử lý batch:", err);
    }
  }

  return allResults;
};

// Hàm tìm bạn qua username. Khi được gọi từ ô tìm kiếm (có AbortSignal),
// tự retry các lỗi upstream tạm thời/404 giả thay vì bắt người dùng thoát web vào lại.
export const FindFriendByUserName = async (eqfriend, config = {}) => {
  const { idToken } = utils.getToken();
  if (!idToken) {
    const error = new Error("Authentication required");
    error.code = "AUTH_REQUIRED";
    error.status = 401;
    throw error;
  }

  const username = normalizeSearchUsername(eqfriend);
  const body = { username };
  const interactiveSearch = Boolean(config?.signal);
  const retryDelays = interactiveSearch ? SEARCH_RETRY_DELAYS_MS : [0];
  let lastError = null;

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    try {
      await waitForSearchRetry(retryDelays[attempt], config?.signal);
      const response = await instanceMain.post("locket/getUserByData", body, config);
      const result = response.data;

      if (isNonEmptyUserResult(result)) {
        cacheSearchResult(username, result);
      }
      return result;
    } catch (error) {
      if (axios.isCancel(error) || config?.signal?.aborted) throw error;
      lastError = error;

      const recoverable = isRecoverableSearchError(error);
      const cached = recoverable ? getCachedSearchResult(username) : null;
      if (cached) {
        console.warn("[friends] transient search failure recovered from recent result", {
          username,
          status: error?.response?.status || error?.status || null,
        });
        return cached;
      }

      const hasRetry = attempt + 1 < retryDelays.length;
      if (!recoverable || !hasRetry) break;

      console.warn("[friends] transient search failure; retrying in-page", {
        username,
        attempt: attempt + 1,
        status: error?.response?.status || error?.status || null,
        nextDelayMs: retryDelays[attempt + 1],
      });
    }
  }

  if (!axios.isCancel(lastError)) {
    console.error("[friends] search request failed after recovery attempts", {
      username,
      status: lastError?.response?.status || lastError?.status || null,
      code: lastError?.code || null,
    });
  }
  throw lastError;
};
