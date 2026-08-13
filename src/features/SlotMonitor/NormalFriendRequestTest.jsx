import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Send,
  UserRoundSearch,
} from "lucide-react";
import { FindFriendByUserName, SendRequestToFriend } from "@/services";
import { getMyLocalId } from "@/utils/auth/getMyLocalId";
import {
  FRIENDSHIP_STATUS,
  friendshipStatusFromUser,
  normalizeFriendUsername,
} from "@/features/FriendsContainer/FindFriend/friendSearchUtils";

const relationshipLabel = (relationship) => {
  switch (String(relationship || "").toLowerCase()) {
    case "friends":
      return "Đã là bạn bè";
    case "outgoing-request":
      return "Lời mời đi đã xuất hiện";
    default:
      return String(relationship || "Đã ghi nhận trên Locket");
  }
};

const RESULT_STYLE = {
  success: {
    Icon: CheckCircle2,
    className: "border-success/35 bg-success/10 text-success",
  },
  info: {
    Icon: Info,
    className: "border-info/35 bg-info/10 text-info",
  },
  error: {
    Icon: AlertTriangle,
    className: "border-warning/35 bg-warning/10 text-warning",
  },
};

export default function NormalFriendRequestTest() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const showResult = (type, title, detail = "") => {
    setResult({ type, title, detail });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    const normalizedUsername = normalizeFriendUsername(username);
    if (!normalizedUsername) {
      showResult("error", "Hãy nhập username tài khoản bạn bè thường.");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const found = await FindFriendByUserName(normalizedUsername);
      const user = found?.data;
      if (!found?.success || !user?.uid) {
        showResult("error", `Không tìm thấy @${normalizedUsername}.`);
        return;
      }

      if (
        user.celebrity === true ||
        Number(user?.celebrity_data?.max_friends || 0) > 0
      ) {
        showResult(
          "error",
          "Đây là tài khoản Celeb.",
          "Ô này chỉ test luồng kết bạn thường. Hãy nhập một tài khoản thường chưa kết bạn.",
        );
        return;
      }

      if (String(getMyLocalId() || "") === String(user.uid)) {
        showResult("error", "Không thể gửi request tới chính tài khoản đang đăng nhập.");
        return;
      }

      const currentStatus = friendshipStatusFromUser(user);
      if (currentStatus === FRIENDSHIP_STATUS.FRIENDS) {
        showResult(
          "info",
          `@${normalizedUsername} đã là bạn bè.`,
          "Hãy chọn tài khoản thường khác chưa kết bạn để kiểm tra một request mới.",
        );
        return;
      }
      if (currentStatus === FRIENDSHIP_STATUS.OUTGOING) {
        showResult(
          "info",
          `Request tới @${normalizedUsername} đã tồn tại từ trước.`,
          "Hệ thống không gửi lặp. Hãy chọn tài khoản thường khác để test request mới.",
        );
        return;
      }
      if (currentStatus === FRIENDSHIP_STATUS.INCOMING) {
        showResult(
          "info",
          `@${normalizedUsername} đang có lời mời gửi tới bạn.`,
          "Hãy xử lý lời mời đến hoặc chọn tài khoản thường khác để test.",
        );
        return;
      }

      const response = await SendRequestToFriend(user.uid);
      const verification = response?.data;
      if (!response?.success || verification?.verified !== true) {
        showResult(
          "error",
          "Chưa xác nhận được request trên Locket.",
          "Huy Locket sẽ không hiện “thành công” nếu chưa đọc lại được trạng thái thật.",
        );
        return;
      }

      if (verification.sentNow === true) {
        showResult(
          "success",
          `Đã gửi thật tới @${normalizedUsername}.`,
          `${relationshipLabel(verification.relationship)} trên Locket. Bạn có thể mở tài khoản kia để kiểm tra ngay.`,
        );
      } else {
        showResult(
          "info",
          `Không gửi lặp tới @${normalizedUsername}.`,
          `${relationshipLabel(verification.relationship)} đã tồn tại trước lần test này.`,
        );
      }
    } catch (error) {
      const code = error?.response?.data?.code || error?.code || "";
      const message = error?.response?.data?.message || error?.message || "";
      showResult(
        "error",
        code === "REQUEST_NOT_CONFIRMED"
          ? "Locket chưa ghi nhận request — không tính là thành công."
          : "Test kết bạn thường chưa thành công.",
        message || "Hãy thử một tài khoản thường khác sau ít phút.",
      );
    } finally {
      setLoading(false);
    }
  };

  const resultStyle = result ? RESULT_STYLE[result.type] || RESULT_STYLE.info : null;
  const ResultIcon = resultStyle?.Icon;

  return (
    <section className="border-b border-base-300 bg-base-200/30 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <UserRoundSearch size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Test gửi kết bạn thường</h2>
          <p className="mt-1 text-xs leading-5 text-base-content/60">
            Nhập một tài khoản thường chưa kết bạn. Nút test chỉ gửi đúng 1 lần và
            chỉ báo thành công sau khi đọc lại thấy request trên Locket.
          </p>

          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={handleSubmit}
          >
            <label className="input input-bordered flex min-w-0 flex-1 items-center gap-2 rounded-xl">
              <span className="text-base-content/45">@</span>
              <input
                type="text"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setResult(null);
                }}
                placeholder="username bạn bè thường"
                autoComplete="off"
                className="min-w-0 grow"
                aria-label="Username tài khoản thường để test kết bạn"
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary rounded-xl sm:min-w-44"
              disabled={loading || !normalizeFriendUsername(username)}
            >
              {loading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <Send size={16} />
              )}
              {loading ? "Đang gửi và xác minh..." : "Gửi 1 request test"}
            </button>
          </form>

          {result && resultStyle && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${resultStyle.className}`}
              role="status"
            >
              <ResultIcon size={17} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">{result.title}</p>
                {result.detail && (
                  <p className="mt-0.5 text-xs leading-5 opacity-80">
                    {result.detail}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
