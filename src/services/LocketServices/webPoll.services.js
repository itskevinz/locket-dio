import { instanceMain } from "@/libs/instanceMain";

function unwrap(response, fallback) {
  if (!response?.data?.success) {
    const error = new Error(response?.data?.message || fallback);
    error.code = response?.data?.code || "WEB_POLL_ERROR";
    throw error;
  }
  return response.data.data ?? null;
}

export async function getMyWebPoll() {
  const response = await instanceMain.get("api/web-polls/me");
  return unwrap(response, "Không tải được bình chọn của bạn.");
}

export async function saveMyWebPoll({ question, active = true }) {
  const response = await instanceMain.put("api/web-polls/me", {
    question,
    active,
  });
  return unwrap(response, "Không lưu được bình chọn.");
}

export async function setMyWebPollActive(active) {
  const response = await instanceMain.patch("api/web-polls/me/active", {
    active,
  });
  return unwrap(response, "Không đổi được trạng thái bình chọn.");
}

export async function getUserWebPoll(uid) {
  const response = await instanceMain.get(
    `api/web-polls/user/${encodeURIComponent(uid)}`,
  );
  return unwrap(response, "Không tải được bình chọn của người này.");
}

export async function voteUserWebPoll(uid, choice) {
  const response = await instanceMain.put(
    `api/web-polls/user/${encodeURIComponent(uid)}/vote`,
    { choice },
  );
  return unwrap(response, "Không gửi được bình chọn.");
}
