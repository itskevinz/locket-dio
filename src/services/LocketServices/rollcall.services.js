import { instanceLocketV2, instanceMain } from "@/libs";
import { getISOWeek } from "@/utils";

function isCanceledRequest(error, signal) {
  return (
    signal?.aborted ||
    error?.name === "CanceledError" ||
    error?.code === "ERR_CANCELED"
  );
}

export const getRollcallPosts = async ({ selectWeek, selectYear, signal }) => {
  const { year, week } = getISOWeek();
  const requestedWeek = selectWeek || week;
  const requestedYear = selectYear || year;
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  const body = {
    data: {
      week_of_year: {
        "@type": "type.googleapis.com/google.protobuf.Int64Value",
        value: requestedWeek,
      },
      source: "feed",
      year: {
        "@type": "type.googleapis.com/google.protobuf.Int64Value",
        value: requestedYear,
      },
    },
  };

  let proxyError = null;

  try {
    // Ưu tiên server-to-server: tránh CORS / chặn request trên Android.
    const res = await instanceMain.post(
      "locket/getRollcallPostsV2",
      body,
      { signal },
    );
    const moments = res.data?.result?.data?.posts;
    const ms = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
    );

    console.info("[rollcall:net]", {
      type: "getRollcallPosts_proxy",
      status: res?.status ?? 200,
      ms,
      count: Array.isArray(moments) ? moments.length : 0,
      week: requestedWeek,
      year: requestedYear,
    });

    return moments;
  } catch (error) {
    if (isCanceledRequest(error, signal)) throw error;
    proxyError = error;

    console.info("[rollcall:net]", {
      type: "getRollcallPosts_proxy_fallback",
      status: error?.response?.status || "error",
      week: requestedWeek,
      year: requestedYear,
    });
  }

  try {
    // Dự phòng: gọi trực tiếp API chính thức; interceptor có thể refresh token 401.
    const res = await instanceLocketV2.post("getRollcallPosts", body, { signal });
    const moments = res.data?.result?.data?.posts;
    const ms = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
    );

    console.info("[rollcall:net]", {
      type: "getRollcallPosts_direct_fallback",
      status: res?.status ?? 200,
      ms,
      count: Array.isArray(moments) ? moments.length : 0,
      week: requestedWeek,
      year: requestedYear,
    });

    return moments;
  } catch (directError) {
    if (isCanceledRequest(directError, signal)) throw directError;

    const ms = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
    );
    console.info("[rollcall:net]", {
      type: "getRollcallPosts_failed",
      status:
        directError?.response?.status ||
        proxyError?.response?.status ||
        "error",
      ms,
      week: requestedWeek,
      year: requestedYear,
    });

    // Ưu tiên lỗi trực tiếp vì interceptor đã thử refresh token.
    throw directError || proxyError;
  }
};

/**
 * Tải media Rollcalls qua backend có Authorization + header Locket.
 * Trả object URL tạm; component gọi URL.revokeObjectURL khi đổi ảnh/unmount.
 */
export const getRollcallMediaObjectUrl = async (url, { signal } = {}) => {
  if (!url || typeof URL === "undefined") {
    throw new Error("Missing Rollcall media URL");
  }

  const res = await instanceMain.get("locket/getRollcallMediaV2", {
    params: { url },
    responseType: "blob",
    signal,
    timeout: 35000,
  });

  const blob = res.data;
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("Empty Rollcall media blob");
  }

  const contentType = String(blob.type || res.headers?.["content-type"] || "");
  if (
    contentType &&
    !contentType.startsWith("image/") &&
    !contentType.startsWith("video/")
  ) {
    throw new Error(`Unsupported Rollcall media type: ${contentType}`);
  }

  return URL.createObjectURL(blob);
};

export const postRollcallReaction = async ({}) => {
  try {
    const body = {
      data: {
        x: 0,
        y: 1,
        rotation: 0.17351480882007525,
        reaction: "🔥",
        post_user_uid: "NzGrCyCyOjcVPpGvlLcaiIiujaA3",
        post_uid: "bSIcLYRunxenfxptYFeQ",
        scale: 1,
      },
    };
    const res = await instanceLocketV2.post("postRollcallReaction", body);
    const moments = res.data?.result?.data?.posts;
    return moments;
  } catch (err) {
    console.warn("❌ Failed", err);
  }
};

// {
//   "result": {
//     "status": 200
// }

export const likeRollcallComment = async ({}) => {
  try {
    const body = {
      data: {
        post_user_uid: "NzGrCyCyOjcVPpGvlLcaiIiujaA3",
        post_uid: "bSIcLYRunxenfxptYFeQ",
        post_comment_id: "STgwjqm0Kq4bzPHQ4x25",
        like: true,
      },
    };
    const res = await instanceLocketV2.post("likeRollcallComment", body);
    const moments = res.data?.result;
    return moments;
  } catch (err) {
    console.warn("❌ Failed", err);
  }
};

// {
//   "result": {
//     "status": 200,
//     "data": {
//       "comment": {
//         "body": "Ghê",
//         "created_at": {
//           "_seconds": 1765688999,
//           "_nanoseconds": 164000000
//         },
//         "user": "RCQ94Icmh7fvFr5ycLaHJgyQo8j1",
//         "post_item_uid": "XWqy6VIigU0udv7cJP7V",
//         "uid": "STgwjqm0Kq4bzPHQ4x25",
//         "likes": []
//       }
//     }
//   }
// }
export const postRollcallComment = async ({}) => {
  try {
    const body = {
      data: {
        reply_user_uid: "uid", // neeus reply thi them
        post_user_uid: "NzGrCyCyOjcVPpGvlLcaiIiujaA3",
        post_uid: "bSIcLYRunxenfxptYFeQ",
        post_item_id: "STgwjqm0Kq4bzPHQ4x25",
        body: "string",
      },
    };
    const res = await instanceLocketV2.post("postRollcallComment", body);
    const moments = res.data?.result;
    return moments;
  } catch (err) {
    console.warn("❌ Failed", err);
  }
};
