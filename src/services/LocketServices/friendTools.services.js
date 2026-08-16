import { instanceMain } from "@/libs/instanceMain";

export async function blockFriend(uid) {
  const response = await instanceMain.post("locket/blockFriendV2", { uid });
  if (!response?.data?.success || !response?.data?.data?.confirmed) {
    const error = new Error(
      response?.data?.message || "Locket chưa xác nhận block tài khoản này.",
    );
    error.code = response?.data?.code || "BLOCK_NOT_CONFIRMED";
    throw error;
  }
  return response.data.data;
}

export async function unblockFriend(uid) {
  const response = await instanceMain.post("locket/unblockFriendV2", { uid });
  if (!response?.data?.success || !response?.data?.data?.confirmed) {
    const error = new Error(
      response?.data?.message || "Locket chưa xác nhận unblock tài khoản này.",
    );
    error.code = response?.data?.code || "UNBLOCK_NOT_CONFIRMED";
    throw error;
  }
  return response.data.data;
}

export async function getBlockedFriends() {
  const response = await instanceMain.get("locket/getBlockedUsersV2");
  const users = response?.data?.data;
  return {
    users: Array.isArray(users) ? users : [],
    meta: response?.data?.meta || {},
  };
}

export async function getLocketQr() {
  const response = await instanceMain.get("locket/getLocketQrV2");
  if (!response?.data?.success || !response?.data?.data?.qrDataUrl) {
    throw new Error(response?.data?.message || "Không tạo được Locket QR.");
  }
  return response.data.data;
}
