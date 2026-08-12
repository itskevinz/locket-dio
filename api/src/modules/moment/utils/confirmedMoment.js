function unwrapMomentId(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return String(value.stringValue || value.string_value || "").trim();
  }
  return "";
}

function getConfirmedMomentId(moment) {
  if (!moment || typeof moment !== "object" || Array.isArray(moment)) {
    return "";
  }

  return (
    unwrapMomentId(moment.canonical_uid) ||
    unwrapMomentId(moment.id) ||
    unwrapMomentId(moment.momentId)
  );
}

function extractConfirmedMoment(responseData) {
  const moment = responseData?.result?.data;
  if (!getConfirmedMomentId(moment)) {
    const error = new Error(
      "Locket chua xac nhan da luu bai dang. Bai van duoc giu trong hang doi.",
    );
    error.code = "LOCKET_POST_NOT_CONFIRMED";
    error.status = 502;
    throw error;
  }

  return moment;
}

module.exports = {
  extractConfirmedMoment,
  getConfirmedMomentId,
};
