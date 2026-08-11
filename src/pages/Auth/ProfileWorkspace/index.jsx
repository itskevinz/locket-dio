import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Activity, UserRound } from "lucide-react";
import { useAuthStore } from "@/stores";
import Profile from "../Profile";

const ActivityDashboard = lazy(
  () => import("@/features/ActivityDashboard/ActivityDashboard"),
);

function normalizeTimestamp(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function formatPasswordTime(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "Không có dữ liệu";

  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";

  return `${get("hour")}:${get("minute")}:${get("second")} ${get("day")}/${get("month")}/${get("year")}`;
}

export default function ProfileWorkspace() {
  const [tab, setTab] = useState("profile");
  const workspaceRef = useRef(null);
  const passwordUpdatedAt = useAuthStore((s) => s.user?.passwordUpdatedAt);

  // Profile đang chia section nội bộ. Khi section Bảo mật được mount, thay dòng
  // "Đăng nhập lần cuối" trong riêng card Đổi mật khẩu bằng mốc passwordUpdatedAt
  // thật từ Firebase Auth. Dòng đăng nhập ở card Trạng thái tài khoản vẫn giữ nguyên.
  useEffect(() => {
    if (tab !== "profile") return undefined;
    const root = workspaceRef.current;
    if (!root) return undefined;

    const desiredText = `Lần cuối đổi mật khẩu: ${formatPasswordTime(passwordUpdatedAt)}`;

    const syncPasswordTime = () => {
      const sections = root.querySelectorAll("section");
      for (const section of sections) {
        const heading = section.querySelector("h2");
        if (heading?.textContent?.trim() !== "Đổi mật khẩu") continue;

        const target = section.querySelector("p.text-sm.font-semibold");
        if (target && target.textContent !== desiredText) {
          target.textContent = desiredText;
        }
        break;
      }
    };

    syncPasswordTime();
    const observer = new MutationObserver(syncPasswordTime);
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, [tab, passwordUpdatedAt]);

  return (
    <div ref={workspaceRef} className="min-h-screen bg-base-200">
      <div className="sticky top-0 z-30 border-b border-base-300 bg-base-100/90 px-3 py-2 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl gap-1 rounded-2xl bg-base-200/60 p-1">
          <button
            type="button"
            className={`btn btn-sm flex-1 rounded-xl ${tab === "profile" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab("profile")}
          >
            <UserRound className="h-4 w-4" /> Hồ sơ
          </button>
          <button
            type="button"
            className={`btn btn-sm flex-1 rounded-xl ${tab === "activity" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab("activity")}
          >
            <Activity className="h-4 w-4" /> Thống kê cá nhân
          </button>
        </div>
      </div>
      {tab === "profile" ? (
        <Profile />
      ) : (
        <Suspense
          fallback={
            <div className="flex min-h-48 items-center justify-center">
              <span className="loading loading-spinner loading-md" aria-label="Đang tải" />
            </div>
          }
        >
          <ActivityDashboard />
        </Suspense>
      )}
    </div>
  );
}
