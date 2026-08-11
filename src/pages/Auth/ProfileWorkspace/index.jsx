import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Activity, UserRound } from "lucide-react";
import { SonnerWarning } from "@/components/uikit/SonnerToast";
import { GetUserLocket } from "@/services";
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
  const locketBadge = useAuthStore((s) => s.user?.badge);
  const isRealGold = String(locketBadge || "").toLowerCase() === "locket_gold";

  // Lấy lại hồ sơ thật khi mở trang để badge/Gold không phụ thuộc cache cũ.
  useEffect(() => {
    if (tab !== "profile") return undefined;
    let active = true;

    GetUserLocket()
      .then((freshUser) => {
        if (active && freshUser) useAuthStore.setState({ user: freshUser });
      })
      .catch((error) => {
        console.warn("[profile] refresh real account status skipped:", error?.message || error);
      });

    return () => {
      active = false;
    };
  }, [tab]);

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

  // Quy tắc Gold theo dữ liệu thật: chỉ badge === "locket_gold" mới được bật.
  // Gói thành viên của website không được dùng để giả định tài khoản Locket có Gold.
  useEffect(() => {
    if (tab !== "profile") return undefined;
    const root = workspaceRef.current;
    if (!root) return undefined;

    const syncGoldTruth = () => {
      const labels = Array.from(root.querySelectorAll("label"));
      const goldLabel = labels.find((label) =>
        label.textContent?.includes("Hiển thị huy hiệu Locket Gold"),
      );

      if (goldLabel) {
        const input = goldLabel.querySelector('input[type="checkbox"]');
        const description = goldLabel.querySelector("span span:nth-child(2)");

        if (input) {
          if (!isRealGold) {
            input.checked = false;
            input.disabled = true;
            input.setAttribute("aria-disabled", "true");
            goldLabel.classList.add("opacity-70", "cursor-not-allowed");

            if (!goldLabel.__realGoldGuard) {
              const guard = (event) => {
                event.preventDefault();
                event.stopPropagation();
                SonnerWarning(
                  "Không thể bật",
                  "Chỉ tài khoản đang có Locket Gold thật mới có thể bật huy hiệu Gold.",
                );
              };
              goldLabel.addEventListener("click", guard, true);
              goldLabel.__realGoldGuard = guard;
            }
          } else {
            input.disabled = false;
            input.removeAttribute("aria-disabled");
            goldLabel.classList.remove("opacity-70", "cursor-not-allowed");
            if (goldLabel.__realGoldGuard) {
              goldLabel.removeEventListener("click", goldLabel.__realGoldGuard, true);
              delete goldLabel.__realGoldGuard;
            }
          }
        }

        if (description) {
          const desiredDescription = isRealGold
            ? "Ẩn/hiện huy hiệu Gold trên giao diện hồ sơ của Huy Locket"
            : "Tài khoản Locket này hiện chưa có Locket Gold nên không thể bật huy hiệu.";
          if (description.textContent !== desiredDescription) {
            description.textContent = desiredDescription;
          }
        }
      }

      // Không hiển thị biểu tượng/chữ Locket Gold giả nếu trạng thái thật không có Gold.
      const goldVisuals = Array.from(root.querySelectorAll('[title="Locket Gold"], span'));
      goldVisuals.forEach((element) => {
        const isGoldTitle = element.getAttribute?.("title") === "Locket Gold";
        const isExactGoldText = element.textContent?.trim() === "Locket Gold";
        if (!isGoldTitle && !isExactGoldText) return;
        element.style.display = isRealGold ? "" : "none";
      });
    };

    syncGoldTruth();
    const observer = new MutationObserver(syncGoldTruth);
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      const labels = Array.from(root.querySelectorAll("label"));
      labels.forEach((label) => {
        if (label.__realGoldGuard) {
          label.removeEventListener("click", label.__realGoldGuard, true);
          delete label.__realGoldGuard;
        }
      });
    };
  }, [tab, isRealGold]);

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
