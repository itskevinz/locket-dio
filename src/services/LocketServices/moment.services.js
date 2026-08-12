import { getMomentById } from "@/cache/momentDB";
import { instanceLocketV2 } from "@/libs";
import { getToken } from "@/utils";
import { generateUUIDv4Upper } from "@/utils/generate/uuid";
import { logWebUserAction } from "@/services/UserActivityService";

export const SendReactMoment = async (emoji, selectedMomentId, power) => {
  try {
    const { localId } = getToken();

    if (!localId || !selectedMomentId) {
      throw new Error("Thiếu thông tin tài khoản hoặc bài đăng để gửi tương tác.");
    }

    const body = {
      data: {
        intensity: power || 0,
        moment_uid: selectedMomentId,
        reaction: emoji || "💛",
        owner_uid: localId,
      },
    };
    const response = await instanceLocketV2.post("reactToMoment", body);

    logWebUserAction({
      actionType: "REACT_MOMENT",
      actionTitle: "Thả Reaction lên Khoảnh Khắc",
      details: `Thành viên thả reaction [${emoji || "💛"}] lên bài đăng bè bạn`,
    }).catch(() => {});

    return response.data;
  } catch (err) {
    console.warn("❌ React Failed", err);
    // Callers need the rejection to avoid showing a false success toast when
    // Locket rejects the vote/reaction (401, 403, rate limit, network error...).
    throw err;
  }
};

export const GetViewsMoment = async (idMoment) => {
  try {
    const body = {
      data: {
        moment_uid: idMoment,
      },
    };
    const res = await instanceLocketV2.post("getMomentViews", body);
    const moments = res.data.result?.data;
    return moments;
  } catch (err) {
    console.warn("❌ React Failed", err);
  }
};

export const GetLastestMoment = async () => {
  try {
    const body = {
      data: {
        excluded_users: [],
        fetch_streak: true,
        should_count_missed_moments: true,
      },
    };

    const res = await instanceLocketV2.post("getLatestMomentV2", body); // 👈 thêm body
    const moments = res.data.result;
    return moments;
  } catch (err) {
    console.warn("❌ React Failed", err);
  }
};

export const SendMessageMoment = async (message, selectedMomentId, uid) => {
  try {
    const body = {
      data: {
        msg: message || " ", // Nội dung tin nhắn
        analytics: {
          amplitude: {
            device_id: generateUUIDv4Upper(),
            session_id: -1,
          },
          google_analytics: {
            app_instance_id: "e88d4daed0ded172248753851bf67772",
          },
          android_version: "1.196.0",
          android_build: "406",
          platform: "android",
        },
        client_token: generateUUIDv4Upper(),
        moment_uid: selectedMomentId || null,
        receiver_uid: uid,
      },
    };

    const response = await instanceLocketV2.post("sendChatMessageV2", body);

    logWebUserAction({
      actionType: "CHAT_SEND",
      actionTitle: "Gửi Tin Nhắn phản hồi Khoảnh Khắc",
      details: `Gửi tin nhắn trả lời bài đăng: "${(message || "").slice(0, 50)}${(message || "").length > 50 ? "..." : ""}"`,
    }).catch(() => {});

    return response.data;
  } catch (err) {
    console.error("sendMessage error:", err);
    throw err;
  }
};

export const DeleteMoment = async (selectedMomentId) => {
  try {
    const infoMoment = await getMomentById(selectedMomentId);
    const { localId } = getToken();

    if (!infoMoment) {
      console.warn("❌ Moment not found for deletion");
      return null;
    }

    //Xác định có xoá toàn cục không?
    const deleteGlobally = infoMoment.user === localId;

    const body = {
      data: {
        moment_uid: selectedMomentId,
        owner_uid: infoMoment.user,
        delete_globally: deleteGlobally, // true nếu là chủ sở hữu
      },
    };

    const res = await instanceLocketV2.post("deleteMomentV2", body);

    const deletedIds = res?.data?.result?.data;
    const deletedId = Array.isArray(deletedIds) ? deletedIds[0] : null;
    if (deletedId) {
      logWebUserAction({
        actionType: "MOMENT_DELETE",
        actionTitle: "Xóa Khoảnh Khắc cá nhân",
        details: `Thành viên đã gỡ bỏ khoảnh khắc (ID: ${selectedMomentId})`,
      }).catch(() => {});
    }
    return deletedId; // 👉 trả về ID đã xoá
  } catch (err) {
    console.warn("❌ Failed", err);
    return null;
  }
};

export const markAsViewedMoment = async (selectedMomentId, celebrity) => {
  try {
    const body = {
      data: {
        moment_uid: selectedMomentId,
        notify: false,
        ...(celebrity ? { celebrity: celebrity } : {}),
      },
    };
    const res = await instanceLocketV2.post("markMomentAsViewed", body);
    return res.data;
  } catch (err) {
    console.warn("❌ Failed", err);
  }
};
