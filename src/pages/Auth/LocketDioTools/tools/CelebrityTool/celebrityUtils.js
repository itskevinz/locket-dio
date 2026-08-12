function requiredText(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(`INVALID_CELEBRITY_${field.toUpperCase()}`);
    error.code = "INVALID_CELEBRITY_RESPONSE";
    throw error;
  }
  return normalized;
}

export function normalizeCelebrityRecords(records) {
  if (!Array.isArray(records)) {
    const error = new Error("INVALID_CELEBRITY_RESPONSE");
    error.code = "INVALID_CELEBRITY_RESPONSE";
    throw error;
  }

  const seenUids = new Set();
  return records.map((record) => {
    const uid = requiredText(record?.uid, "uid");
    if (seenUids.has(uid)) {
      const error = new Error("DUPLICATE_CELEBRITY_UID");
      error.code = "INVALID_CELEBRITY_RESPONSE";
      throw error;
    }
    seenUids.add(uid);

    const username = requiredText(record?.username, "username");
    return {
      id: requiredText(record?.id, "id"),
      uid,
      username,
      displayName: String(record?.displayName || username).trim(),
      avatarUrl: record?.avatarUrl || null,
      locketUrl: requiredText(record?.locketUrl, "locket_url"),
      countryCode:
        String(record?.countryCode || "OTHER").trim().toUpperCase() ||
        "OTHER",
    };
  });
}

export function groupCelebrityRecords(records) {
  return records.reduce((groups, record) => {
    const country = record.countryCode || "OTHER";
    if (!groups[country]) groups[country] = [];
    groups[country].push(record);
    return groups;
  }, {});
}

export function mergeCelebrityWithUser(record, user) {
  return {
    ...(user || {}),
    uid: record.uid,
    username: user?.username || record.username,
    first_name: user?.first_name || record.displayName,
    last_name: user?.last_name || "",
    profile_picture_url: user?.profile_picture_url || record.avatarUrl,
    celebrity: true,
    celebrity_record_id: record.id,
    locket_url: record.locketUrl,
    country_code: record.countryCode,
    live_details_loaded: Boolean(user),
  };
}

function hasKnownCapacity(user) {
  const current = Number(user?.celebrity_data?.friend_count);
  const maximum = Number(user?.celebrity_data?.max_friends);
  return Number.isFinite(current) && Number.isFinite(maximum) && maximum > 0;
}

export function categorizeCelebrityUsers(users) {
  return {
    all: users,
    friends: users.filter((user) => user?.friendship_status === "friends"),
    waitlist: users.filter(
      (user) => user?.friendship_status === "follower-waitlist",
    ),
    waitaccept: users.filter(
      (user) => user?.friendship_status === "outgoing-follow-request",
    ),
    hasSlot: users.filter(
      (user) =>
        hasKnownCapacity(user) &&
        Number(user.celebrity_data.friend_count) <
          Number(user.celebrity_data.max_friends),
    ),
    noSlot: users.filter(
      (user) =>
        hasKnownCapacity(user) &&
        Number(user.celebrity_data.friend_count) >=
          Number(user.celebrity_data.max_friends),
    ),
  };
}

export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function mapWithConcurrencySettled(
  items,
  limit,
  mapper,
  onSettled,
) {
  return mapWithConcurrency(items, limit, async (item, index) => {
    let result;
    try {
      result = { status: "fulfilled", value: await mapper(item, index) };
    } catch (reason) {
      result = { status: "rejected", reason };
    }

    if (typeof onSettled === "function") {
      await onSettled(result, item, index);
    }
    return result;
  });
}
