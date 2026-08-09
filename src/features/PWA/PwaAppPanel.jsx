import React, { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Download,
  HardDrive,
  RefreshCw,
  Smartphone,
  Wifi,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  APP_UPDATE_PHASE,
  getAppUpdateState,
  hasPWAInstallPrompt,
  isStandalonePWA,
  promptPWAInstall,
  subscribeAppUpdate,
  userForceUpdate,
} from "@/utils/pwaUtils";

function humanBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export default function PwaAppPanel() {
  const navigate = useNavigate();
  const [state, setState] = useState({
    standalone: isStandalonePWA(),
    installAvailable: hasPWAInstallPrompt(),
    swSupported: "serviceWorker" in navigator,
    swControlled: Boolean(navigator.serviceWorker?.controller),
    swState: navigator.serviceWorker?.controller?.state || "—",
    notification: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    badgeSupported: typeof navigator.setAppBadge === "function",
    online: navigator.onLine !== false,
    storagePersisted: false,
    storageUsage: 0,
    storageQuota: 0,
    waitingUpdate: false,
  });
  const [checking, setChecking] = useState(false);
  const [appUpdate, setAppUpdate] = useState(() => getAppUpdateState());

  const inspect = useCallback(async () => {
    const next = {
      standalone: isStandalonePWA(),
      installAvailable: hasPWAInstallPrompt(),
      swSupported: "serviceWorker" in navigator,
      swControlled: Boolean(navigator.serviceWorker?.controller),
      swState: navigator.serviceWorker?.controller?.state || "—",
      notification: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      badgeSupported: typeof navigator.setAppBadge === "function",
      online: navigator.onLine !== false,
      storagePersisted: false,
      storageUsage: 0,
      storageQuota: 0,
      waitingUpdate: false,
    };
    try {
      if (navigator.storage?.persisted) next.storagePersisted = await navigator.storage.persisted();
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        next.storageUsage = estimate.usage || 0;
        next.storageQuota = estimate.quota || 0;
      }
      if (navigator.serviceWorker) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        next.waitingUpdate = Boolean(registration?.waiting);
        next.swState = registration?.active?.state || navigator.serviceWorker.controller?.state || "—";
        next.swControlled = Boolean(navigator.serviceWorker.controller || registration?.active);
      }
    } catch {
      /* best effort */
    }
    setState(next);
  }, []);

  useEffect(() => {
    inspect();
    const onInstall = () => inspect();
    const onOnline = () => inspect();
    window.addEventListener("huy-locket-pwa-install-change", onInstall);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    navigator.serviceWorker?.addEventListener?.("controllerchange", onInstall);
    const unsubscribeUpdate = subscribeAppUpdate(setAppUpdate);
    return () => {
      window.removeEventListener("huy-locket-pwa-install-change", onInstall);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
      navigator.serviceWorker?.removeEventListener?.("controllerchange", onInstall);
      unsubscribeUpdate();
    };
  }, [inspect]);

  const install = async () => {
    const result = await promptPWAInstall();
    if (!result.available) {
      toast.info("Trình duyệt chưa cấp nút cài đặt", {
        description: "Trên iPhone/iPad dùng Chia sẻ → Thêm vào Màn hình chính. Chrome có thể hiện biểu tượng cài ở thanh địa chỉ.",
      });
    } else if (result.outcome === "accepted") {
      toast.success("Đã chấp nhận cài Huy Locket");
    }
    await inspect();
  };

  const requestNotifications = async () => {
    if (typeof Notification === "undefined") {
      toast.error("Trình duyệt không hỗ trợ Notification API");
      return;
    }
    const permission = await Notification.requestPermission();
    setState((current) => ({ ...current, notification: permission }));
    if (permission === "granted") {
      toast.success("Đã cho phép thông báo");
    } else {
      toast.warning("Thông báo chưa được cho phép");
    }
  };

  const requestPersistentStorage = async () => {
    if (!navigator.storage?.persist) {
      toast.info("Trình duyệt không hỗ trợ Persistent Storage API");
      return;
    }
    const granted = await navigator.storage.persist();
    toast[granted ? "success" : "info"](
      granted ? "Đã ưu tiên giữ cache và bản nháp offline" : "Trình duyệt chưa cấp quyền lưu bền vững",
    );
    await inspect();
  };

  const checkUpdate = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const result = await userForceUpdate();
      if (result === "offline") {
        toast.warning("Không thể kiểm tra khi đang offline");
      } else if (result === "latest") {
        toast.success("Ứng dụng đang dùng bản mới nhất");
      } else if (result === "busy") {
        toast.info("Đã có bản mới", {
          description: "Ứng dụng sẽ cập nhật sau khi bạn hoàn tất thao tác hiện tại.",
        });
      } else if (result === "applying") {
        toast.info("Bản cập nhật đang được áp dụng");
      } else if (result === "error") {
        toast.error("Không thể áp dụng bản cập nhật");
      }
      await inspect();
    } catch (error) {
      toast.error("Không kiểm tra được cập nhật", { description: error?.message });
    } finally {
      setChecking(false);
    }
  };

  const setBadge = async () => {
    if (typeof navigator.setAppBadge !== "function") return;
    try {
      await navigator.setAppBadge(1);
      toast.success("Đã thử badge số 1 trên icon ứng dụng");
    } catch {
      toast.info("Hệ điều hành không cho đặt badge lúc này");
    }
  };

  const updateBusy =
    checking ||
    appUpdate.phase === APP_UPDATE_PHASE.CHECKING ||
    appUpdate.phase === APP_UPDATE_PHASE.APPLYING ||
    appUpdate.phase === APP_UPDATE_PHASE.RELOADING;
  const updateReady = appUpdate.available || appUpdate.phase === APP_UPDATE_PHASE.UPDATE_READY;
  const updateLabel =
    appUpdate.phase === APP_UPDATE_PHASE.RELOADING
      ? "Đang tải lại..."
      : appUpdate.phase === APP_UPDATE_PHASE.APPLYING
        ? "Đang cập nhật..."
        : updateBusy
          ? "Đang kiểm tra..."
          : updateReady
            ? "Cập nhật ngay"
            : "Kiểm tra cập nhật";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 text-base-content">
      <section className="overflow-hidden rounded-3xl border border-base-300 bg-base-100 shadow-lg">
        <header className="border-b border-base-300 p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-2xl font-bold"><Smartphone className="h-6 w-6" /> Ứng dụng & PWA</h2>
          <p className="mt-1 text-sm text-base-content/60">
            Cài Huy Locket như app, offline shell, Web Push, badge, bộ nhớ bền vững và cập nhật Service Worker.
          </p>
        </header>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
          <div className="rounded-2xl border border-base-300 bg-base-200/35 p-4">
            <div className="flex items-center justify-between"><span className="font-bold">Cài ứng dụng</span><Download className="h-5 w-5" /></div>
            <p className="mt-2 text-sm text-base-content/60">
              {state.standalone ? "Đang chạy ở chế độ standalone như app." : state.installAvailable ? "Trình duyệt sẵn sàng cài Huy Locket." : "Có thể cài bằng menu của trình duyệt nếu được hỗ trợ."}
            </p>
            <button className="btn btn-sm btn-primary mt-3" disabled={state.standalone} onClick={install}>{state.standalone ? "Đã cài" : "Cài Huy Locket"}</button>
          </div>

          <div className={`rounded-2xl border p-4 transition-all duration-300 ${updateReady ? "border-primary/40 bg-primary/5 shadow-md" : "border-base-300 bg-base-200/35"}`}>
            <div className="flex items-center justify-between"><span className="font-bold">Offline & Service Worker</span><Wifi className="h-5 w-5" /></div>
            <p className="mt-2 text-sm text-base-content/60">
              {state.swControlled ? `Service Worker ${state.swState}.` : "Service Worker chưa điều khiển trang."} {state.online ? "Đang online." : "Đang offline."}
            </p>
            {updateReady && (
              <p className="mt-2 text-xs font-semibold text-primary">
                Đã phát hiện phiên bản mới{appUpdate.latest?.version ? ` · v${appUpdate.latest.version}` : ""}.
              </p>
            )}
            <button
              className={`btn btn-sm relative mt-3 transition-all duration-200 ${updateBusy || updateReady ? "btn-primary shadow-lg" : "btn-outline"} ${updateBusy ? "scale-[1.03]" : ""}`}
              disabled={updateBusy}
              onClick={checkUpdate}
            >
              <span className={`inline-flex items-center justify-center rounded-full transition-all ${updateBusy ? "bg-primary-content/15 p-1" : ""}`}>
                <RefreshCw className={`h-4 w-4 ${updateBusy ? "animate-[spin_0.65s_linear_infinite] scale-110" : ""}`} />
              </span>
              <span>{updateLabel}</span>
              {updateBusy && <span className="loading loading-dots loading-xs" />}
            </button>
          </div>

          <div className="rounded-2xl border border-base-300 bg-base-200/35 p-4">
            <div className="flex items-center justify-between"><span className="font-bold">Push & Badge</span><Bell className="h-5 w-5" /></div>
            <p className="mt-2 text-sm text-base-content/60">Quyền thông báo: <b>{state.notification}</b>. Badge: {state.badgeSupported ? "hỗ trợ" : "không hỗ trợ"}.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-sm btn-outline" onClick={requestNotifications}>Cho phép thông báo</button>
              {state.badgeSupported && <button className="btn btn-sm btn-ghost" onClick={setBadge}>Test badge</button>}
              <button className="btn btn-sm btn-ghost" onClick={() => navigate("/friends?slot=1#slot-notification-settings")}>Cấu hình Push</button>
            </div>
          </div>

          <div className="rounded-2xl border border-base-300 bg-base-200/35 p-4 sm:col-span-2 lg:col-span-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 font-bold"><HardDrive className="h-5 w-5" /> Bộ nhớ ứng dụng</div>
                <p className="mt-1 text-sm text-base-content/60">
                  Đã dùng {humanBytes(state.storageUsage)} / {humanBytes(state.storageQuota)}. Persistent Storage: {state.storagePersisted ? "đã bật" : "chưa được cấp"}.
                </p>
                <p className="mt-1 text-xs text-base-content/45">Cache chỉ ưu tiên app shell/tài nguyên an toàn; API, token và media cá nhân có chữ ký không bị cache dài hạn.</p>
              </div>
              <button className="btn btn-sm btn-outline" onClick={requestPersistentStorage}>Ưu tiên giữ dữ liệu offline</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
