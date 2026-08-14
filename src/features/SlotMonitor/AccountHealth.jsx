import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  CircleAlert,
  HeartPulse,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useSlotMonitor } from "./useSlotMonitor";
import { fetchAccountHealth } from "./accountHealthService";

const CHECK_ICONS = {
  auth: ShieldCheck,
  "background-session": Zap,
  "slot-monitor": HeartPulse,
  "web-push": Smartphone,
  telegram: Send,
  email: Mail,
};

const STATUS_META = {
  OK: {
    label: "Ổn",
    badge: "badge-success",
    border: "border-success/25 bg-success/5",
    icon: CheckCircle2,
    iconClass: "text-success",
  },
  WARNING: {
    label: "Cần chú ý",
    badge: "badge-warning",
    border: "border-warning/25 bg-warning/5",
    icon: CircleAlert,
    iconClass: "text-warning",
  },
  ERROR: {
    label: "Cần sửa",
    badge: "badge-error",
    border: "border-error/25 bg-error/5",
    icon: XCircle,
    iconClass: "text-error",
  },
};

function formatTime(value) {
  if (!value) return "Chưa có";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function AccountHealth() {
  const { enableBackgroundPush } = useSlotMonitor();
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const next = await fetchAccountHealth();
      setHealth(next);
      return next;
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message ||
          "Không kiểm tra được sức khỏe tài khoản lúc này.",
      );
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const checks = Array.isArray(health?.checks) ? health.checks : [];
  const summary = useMemo(() => {
    const ok = checks.filter((item) => item.status === "OK").length;
    const warning = checks.filter((item) => item.status === "WARNING").length;
    const failed = checks.filter((item) => item.status === "ERROR").length;
    return { ok, warning, failed };
  }, [checks]);

  const autoRepair = async () => {
    if (repairing) return;
    setRepairing(true);
    try {
      // Đây là thao tác do người dùng bấm nên có thể xin quyền notification nếu cần.
      // Hàm hiện có sẽ lưu lại refresh token nền, đăng ký Web Push nếu hỗ trợ,
      // và đồng bộ watch. Endpoint health cũng tự làm mới mapping Telegram cũ an toàn.
      const result = await enableBackgroundPush({
        requestPermission: true,
        showFeedback: false,
      });
      const next = await load({ quiet: true });
      if (result?.backgroundEnabled) {
        toast.success("Đã sửa lại phiên Canh Slot nền", {
          description: result?.enabled
            ? "Web Push và phiên nền đã sẵn sàng."
            : "Phiên Railway đã sẵn sàng; Web Push phụ thuộc quyền của thiết bị.",
        });
      } else if (next?.overall === "OK") {
        toast.success("Tài khoản đang hoạt động bình thường");
      } else {
        toast.warning("Đã sửa các mục có thể tự động xử lý", {
          description: "Telegram/Gmail chưa liên kết thì cần bật trong phần Kênh thông báo.",
        });
      }
    } catch (repairError) {
      toast.error("Tự sửa chưa hoàn tất", {
        description:
          repairError?.response?.data?.message ||
          repairError?.message ||
          "Hãy kiểm tra lại phiên đăng nhập.",
      });
      await load({ quiet: true });
    } finally {
      setRepairing(false);
    }
  };

  const openNotificationSettings = () => {
    document
      .getElementById("slot-notification-settings")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-6 text-base-content">
      <div className="overflow-hidden rounded-3xl border border-base-300 bg-base-100/90 shadow-xl">
        <header className="border-b border-base-300 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <HeartPulse size={24} />
                <h2 className="text-xl font-bold">Account Health</h2>
                {health?.overall && (
                  <span
                    className={`badge badge-sm ${
                      STATUS_META[health.overall]?.badge || "badge-ghost"
                    }`}
                  >
                    {health.overall === "OK"
                      ? "Tốt"
                      : health.overall === "WARNING"
                        ? "Cần chú ý"
                        : "Cần sửa"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-base-content/60">
                Kiểm tra auth, phiên Railway, Canh Slot, Web Push, Telegram và Gmail mà không hiển thị token hay secret.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={loading || repairing}
                onClick={() => load()}
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                Kiểm tra lại
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={repairing}
                onClick={autoRepair}
              >
                {repairing ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Wrench size={14} />
                )}
                Sửa tự động
              </button>
            </div>
          </div>

          {!loading && checks.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/55">
              <span className="text-success">{summary.ok} mục ổn</span>
              <span className="text-warning">{summary.warning} cảnh báo</span>
              <span className="text-error">{summary.failed} cần sửa</span>
              <span>Kiểm tra: {formatTime(health?.checkedAt)}</span>
            </div>
          )}
        </header>

        <div className="p-3 sm:p-5">
          {error && (
            <div className="mb-3 rounded-xl border border-error/25 bg-error/5 px-3 py-2 text-xs text-error">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-base-content/50">
              <span className="loading loading-spinner loading-sm mr-2" /> Đang kiểm tra tài khoản...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {checks.map((check) => {
                const meta = STATUS_META[check.status] || STATUS_META.WARNING;
                const Icon = CHECK_ICONS[check.id] || BellRing;
                const StatusIcon = meta.icon;
                return (
                  <article
                    key={check.id}
                    className={`rounded-2xl border p-4 ${meta.border}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-base-100/80 p-2 ring-1 ring-base-300">
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{check.label}</p>
                          <span className={`badge badge-xs ${meta.badge}`}>
                            <StatusIcon size={10} /> {meta.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-base-content/65">
                          {check.detail}
                        </p>

                        {check.id === "background-session" && check.lastRefreshAt && (
                          <p className="mt-1 text-[11px] text-base-content/45">
                            Refresh nền gần nhất: {formatTime(check.lastRefreshAt)}
                          </p>
                        )}

                        {check.id === "slot-monitor" && Number(check.pollIntervalMs) > 0 && (
                          <p className="mt-1 text-[11px] text-base-content/45">
                            Nền {Math.round(check.pollIntervalMs / 1000)} giây
                            {Number(check.fastPollIntervalMs) > 0 && (
                              <> • Nhanh {Math.round(check.fastPollIntervalMs / 1000)} giây</>
                            )}
                            {Number(check.autoRequestPollIntervalMs) > 0 && (
                              <> • Tự động {Math.round(check.autoRequestPollIntervalMs / 1000)} giây</>
                            )}
                          </p>
                        )}

                        {["telegram", "email"].includes(check.id) && check.status !== "OK" && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs mt-2 px-2"
                            onClick={openNotificationSettings}
                          >
                            Mở cài đặt kênh
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-base-300 bg-base-200/35 px-3 py-2 text-[11px] text-base-content/55">
            <CheckCircle2 size={12} className="mr-1 inline -mt-0.5" />
            “Sửa tự động” chỉ xử lý các phần có thể sửa an toàn như phiên Canh Slot nền, Web Push và mapping tài khoản. Nó không tự tạo Chat ID, email hoặc thay đổi secret server.
          </div>
        </div>
      </div>
    </section>
  );
}
