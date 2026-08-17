export const FRIENDSHIP_STATUS = Object.freeze({
  NONE: "NONE",
  INCOMING: "INCOMING",
  OUTGOING: "OUTGOING",
  FRIENDS: "FRIENDS",
  WAITLIST: "WAITLIST",
  UNKNOWN: "UNKNOWN",
});

export function normalizeFriendUsername(rawUsername) {
  if (typeof rawUsername !== "string") return "";
  return rawUsername.trim().replace(/^@/, "").trim();
}

export function friendshipStatusFromUser(user) {
  switch (user?.friendship_status) {
    case "friends":
      return FRIENDSHIP_STATUS.FRIENDS;
    case "incoming-request":
      return FRIENDSHIP_STATUS.INCOMING;
    case "outgoing-request":
    case "outgoing-follow-request":
      return FRIENDSHIP_STATUS.OUTGOING;
    case "follower-waitlist":
      // Waitlist chỉ là trạng thái chờ slot, không phải bằng chứng request đã gửi.
      return FRIENDSHIP_STATUS.WAITLIST;
    case "none":
    case undefined:
    case null:
      return FRIENDSHIP_STATUS.NONE;
    default:
      return FRIENDSHIP_STATUS.UNKNOWN;
  }
}

export function classifyFriendRequestError(error) {
  const status = error?.response?.status || error?.status;
  const rawCode =
    error?.response?.data?.code ||
    error?.response?.data?.error?.code ||
    (typeof error?.response?.data?.error === "string"
      ? error.response.data.error
      : null) ||
    error?.code;

  const code = String(rawCode || "").trim().toUpperCase();

  if (code === "UPSTREAM_AUTH_FAILED") return "upstream-auth-failed";
  if (code === "AUTH_REQUIRED") return "auth-required";
  if (code === "REQUEST_NOT_CONFIRMED") return "not-confirmed";
  if (["CELEBRITY_SLOT_FULL", "SLOT_FULL", "MAX_FRIENDS"].includes(code)) {
    return "slot-full";
  }
  if (code === "REQUEST_CONFLICT") return "conflict";
  if (status === 401) return "session-expired";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server";
  if (code === "ECONNABORTED" || /timeout/i.test(error?.message || "")) {
    return "timeout";
  }
  if (!error?.response) return "network";
  return "unknown";
}
