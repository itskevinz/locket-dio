export const FRIENDSHIP_STATUS = Object.freeze({
  NONE: "NONE",
  INCOMING: "INCOMING",
  OUTGOING: "OUTGOING",
  FRIENDS: "FRIENDS",
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
    case "follower-waitlist":
      return FRIENDSHIP_STATUS.OUTGOING;
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
