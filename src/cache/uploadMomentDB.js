import Dexie from "dexie";

// ===== DB setup =====
export const uploadMomentsDB = new Dexie("UploadMomentsDB");

uploadMomentsDB.version(1).stores({
  payloads: "++id, createdAt, status, lastTried",
  postedMoments: "++id, postId, createdAt",
});

// ===== Payloads =====
export const saveUploadItemToDB = async (payload) => {
  const id = await uploadMomentsDB.payloads.add(payload);
  // Dexie generates the ++id in IndexedDB, but the queue store keeps the same
  // object in memory. Mirror the generated id back so status/retry/remove
  // updates can find that item without waiting for a full queue re-hydration.
  if (payload && payload.id == null) {
    payload.id = id;
  }
  return id;
};

export const updateUploadItemInDB = (id, data) => {
  return uploadMomentsDB.payloads.update(id, data);
};

export const deleteUploadItemFromDB = (id) => {
  return uploadMomentsDB.payloads.delete(id);
};

export const getUploadItemFromDB = (id) => {
  return uploadMomentsDB.payloads.get(id);
};

export const loadUploadItemsByStatus = async (status, orderBy = "createdAt") => {
  return uploadMomentsDB.payloads
    .where("status")
    .equals(status)
    .sortBy(orderBy);
};

export const loadAllUploadItems = async () => {
  return uploadMomentsDB.payloads.toArray();
};

// ===== Posted moments =====
export const saveUploadedMomentToDB = (data) => {
  return uploadMomentsDB.postedMoments.add(data);
};

export const getPostedMoments = () => {
  return uploadMomentsDB.postedMoments
    .orderBy("createdAt")
    .reverse()
    .toArray();
};

export const removeUnconfirmedLocalPostedMoments = async () => {
  const stale = await uploadMomentsDB.postedMoments
    .filter((moment) =>
      String(moment?.postId || moment?.id || "").startsWith("local_"),
    )
    .toArray();

  if (!stale.length) return [];

  await uploadMomentsDB.postedMoments.bulkDelete(
    stale.map((moment) => moment.id),
  );
  return stale
    .map((moment) => String(moment?.postId || moment?.id || ""))
    .filter(Boolean);
};

export const savePostedMomentToDB = async (payload, posted) => {
  if (!posted || !posted.id) {
    throw new Error("INVALID_POSTED_MOMENT");
  }

  return uploadMomentsDB.postedMoments.add({
    postId: posted.id,
    createdAt: new Date().toISOString(),
    contentType: payload.contentType,
    ...posted,
  });
};
