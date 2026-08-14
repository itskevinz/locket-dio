import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  Gauge,
  Mail,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { fetchSystemStatus } from "./accountHealthService";

const ICONS = {
  api: Server,
  database: Database,
  "slot-worker": Gauge,
  auth: ShieldCheck,
  telegram: Bot,
  gmail: Mail,
};

const META = {
  OK: {
    label: "Online",
    badge: "badge-success",
    border: "border-success/25 bg-success/5",
    icon: CheckCircle2,
    iconClass: "text-success",
  },
  WARNING: {
    label: "Cảnh báo",
    badge: "badge-warning",
    border: "border-warning/25 bg-warning/5",
    icon: CircleAlert,
    iconClass: "text-warning",
  },
  ERROR: {
    label: "Lỗi",
    badge: "badge-error",
    border: "border-error/25 bg-error/5",
    icon: XCircle,
    iconClass: "text-error",
  },
};

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatPlatformMetric(metric) {
  if (!metric || !Number.isFinite(Number(metric.value))) return "Chưa có dữ liệu";
  const value = Number(metric.value);
  const unit = String(metric.unit || "").toLowerCase();
  if (unit.includes("byte")) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let scaled = value;
    let index = 0;
    while (scaled >= 1024 && index < units.length - 1) {
      scaled /= 1024;
      index += 1;
    }
    return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[index]}`;
  }
  return `${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

export default function SystemStatus({ renderUsage }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const next = await fetchSystemStatus();
      setStatus(next);
      return next;
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message ||
          "Không lấy được trạng thái hệ thống.",
      );
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const services = Array.isArray(status?.services) ? status.services : [];
  const summary = useMemo(() => {
    const ok = services.filter((item) => item.status === "OK").length;
    const warning = services.filter((item) => item.status === "WARNING").length;
    const failed = services.filter((item) => item.status === "ERROR").length;
    return { ok, warning, failed };
  }, [services]);

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-6 text-base-content">
      <div className="overflow-hidden rounded-3xl border border-base-300 bg-base-100/90 shadow-xl">
        <header className="border-b border-base-300 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Cloud size={24} />
                <h2 className="text-xl font-bold">System Status</h2>
                {status?.overall && (
                  <span className={`badge badge-sm ${META[status.overall]?.badge || "badge-ghost"}`}>
                    {status.overall === "OK"
                      ? "Ổn định"
                      : status.overall === "WARNING"
                        ? "Có cảnh báo"
                        : "Có lỗi"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-base-content/60">
                Theo dõi backend, database, Canh Slot worker, auth và các kênh gửi thông báo.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-sm self-start"
              disabled={loading}
              onClick={() => load()}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
          </div>

          {!loading && services.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/55">
              <span className="text-success">{summary.ok} online</span>
              <span className="text-warning">{summary.warning} cảnh báo</span>
              <span className="text-error">{summary.failed} lỗi</span>
              <span>Kiểm tra: {formatTime(status?.checkedAt)}</span>
              {status?.version && (
                <span title={status.version}>Commit: {status.version.slice(0, 8)}</span>
              )}
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
              <span className="loading loading-spinner loading-sm mr-2" /> Đang kiểm tra hệ thống...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((service) => {
                const meta = META[service.status] || META.WARNING;
                const Icon = ICONS[service.id] || Server;
                const StateIcon = meta.icon;
                return (
                  <article
                    key={service.id}
                    className={`rounded-2xl border p-4 ${meta.border}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-base-100/80 p-2 ring-1 ring-base-300">
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{service.label}</p>
                          <span className={`badge badge-xs ${meta.badge}`}>
                            <StateIcon size={10} /> {meta.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-base-content/65">
                          {service.detail}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <p className="mt-4 text-[11px] text-base-content/45">
            System Status chỉ hiển thị trạng thái an toàn. Token, mật khẩu, App Script secret và Telegram bot token không được trả về trình duyệt.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-orange-500/30 bg-slate-900/95 p-5 text-white shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-orange-400">
              Monthly usage · Render
            </div>
            <h3 className="text-lg font-black">Hạn mức Canh Slot</h3>
          </div>
          <a
            href={renderUsage?.billingUrl || "https://dashboard.render.com/billing"}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm rounded-xl border-orange-500/40 bg-orange-950 text-orange-200"
          >
            Mở Billing ↗
          </a>
        </div>

        <div className="grid grid-cols-1 gap-3 text-xs font-mono sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <span className="mb-1 block text-slate-400">Free instance hours</span>
            <strong className="text-base text-orange-300">750 giờ / tháng</strong>
            <span className="mt-1 block text-slate-500">Đã dùng: Render chỉ hiển thị trong Billing</span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <span className="mb-1 block text-slate-400">Pipeline build</span>
            <strong className="text-base text-orange-300">500 phút / tháng</strong>
            <span className="mt-1 block text-slate-500">Đã dùng: không có API công khai</span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <span className="mb-1 block text-slate-400">Bandwidth tháng này</span>
            <strong className="text-base text-emerald-300">
              {formatPlatformMetric(renderUsage?.metrics?.bandwidthMonth)}
            </strong>
            <span className="mt-1 block text-slate-500">
              CPU: {formatPlatformMetric(renderUsage?.metrics?.cpuLatest)} · RAM: {formatPlatformMetric(renderUsage?.metrics?.memoryLatest)}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <span className="mb-1 block text-slate-400">Service API</span>
            <strong className="text-base text-white">
              {renderUsage?.service?.plan || (renderUsage ? "Chưa kết nối" : "Đang tải...")}
            </strong>
            <span className="mt-1 block text-slate-500">
              {renderUsage?.service?.region || renderUsage?.error || (renderUsage ? "Chưa có dữ liệu" : "Đang lấy dữ liệu Render")}
            </span>
          </div>
        </div>

        {renderUsage?.configured === false && (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/50 p-3 text-xs font-semibold text-amber-200">
            Chưa tìm thấy secret <code>RENDER_API_KEY</code> trong project <code>huy-locket-api</code>. Token không được gửi về trình duyệt.
          </div>
        )}
      </div>
    </section>
  );
}
