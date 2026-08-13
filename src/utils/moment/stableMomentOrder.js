function momentId(item) {
  const id = item?.id;
  return id === null || id === undefined ? "" : String(id);
}

/**
 * Refresh fields without moving moments that are already on screen.
 * Only genuinely new ids are inserted at an edge of the existing list.
 */
export function mergeStableMomentOrder(
  existing,
  incoming,
  mergeItem,
  { newItemsAt = "start" } = {},
) {
  const currentItems = Array.isArray(existing) ? existing : [];
  const freshItems = Array.isArray(incoming) ? incoming : [];
  const merge = typeof mergeItem === "function"
    ? mergeItem
    : (current, fresh) => ({ ...(current || {}), ...(fresh || {}) });

  const freshById = new Map();
  const freshOrder = [];

  for (const fresh of freshItems) {
    const id = momentId(fresh);
    if (!id) continue;
    if (!freshById.has(id)) freshOrder.push(id);
    freshById.set(
      id,
      freshById.has(id) ? merge(freshById.get(id), fresh) : fresh,
    );
  }

  const existingIds = new Set();
  const updatedExisting = currentItems.map((current) => {
    const id = momentId(current);
    if (!id) return current;
    existingIds.add(id);
    const fresh = freshById.get(id);
    return fresh ? merge(current, fresh) : current;
  });

  const genuinelyNew = freshOrder
    .filter((id) => !existingIds.has(id))
    .map((id) => merge(null, freshById.get(id)))
    .filter(Boolean);

  return newItemsAt === "end"
    ? [...updatedExisting, ...genuinelyNew]
    : [...genuinelyNew, ...updatedExisting];
}
