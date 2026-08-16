import React from "react";
import { withTranslation } from "react-i18next";

const APP_RELOAD_KEY = "__app_reload_once__";
const DOM_RELOAD_KEY = "hl_dom_recover_v2";

function errorMessage(value) {
  return String(value?.message || value?.reason || value || "");
}

function isChunkLoadError(value) {
  const msg = errorMessage(value);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed|ChunkLoadError|dynamically imported module/i.test(
    msg,
  );
}

function freshLocation() {
  const url = new URL(window.location.href);
  url.searchParams.set("_v", String(Date.now()));
  return `${url.pathname}${url.search}${url.hash}`;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, recovering: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidMount() {
    this.onWindowError = (event) => {
      const candidate = event?.error || event?.message || "";
      if (isChunkLoadError(candidate)) {
        void this.recoverStaleBuild(APP_RELOAD_KEY);
      }
    };

    this.onUnhandledRejection = (event) => {
      if (isChunkLoadError(event?.reason)) {
        void this.recoverStaleBuild(APP_RELOAD_KEY);
      }
    };

    window.addEventListener("error", this.onWindowError);
    window.addEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  componentWillUnmount() {
    if (this.onWindowError) {
      window.removeEventListener("error", this.onWindowError);
    }
    if (this.onUnhandledRejection) {
      window.removeEventListener("unhandledrejection", this.onUnhandledRejection);
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });

    const msg = errorMessage(error);

    // Sau một deployment mới, tab cũ có thể vẫn giữ bundle chính cũ rồi gọi
    // một lazy chunk đã đổi hash. Tự làm mới cache + tải cùng route đúng 1 lần.
    if (isChunkLoadError(error)) {
      void this.recoverStaleBuild(APP_RELOAD_KEY);
      return;
    }

    // DOM race hiếm gặp do component cũ/new bị thay giữa lúc transition.
    if (/removeChild|NotFoundError|node to be removed/i.test(msg)) {
      void this.recoverStaleBuild(DOM_RELOAD_KEY);
    }
  }

  claimRecovery = (key) => {
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
      return true;
    } catch {
      // Nếu sessionStorage bị chặn, vẫn cho recovery một lần trong instance này.
      if (this.recoveryClaimed) return false;
      this.recoveryClaimed = true;
      return true;
    }
  };

  clearRuntimeCaches = async () => {
    // Không xóa localStorage/IndexedDB để giữ đăng nhập, nháp và cài đặt người dùng.
    if ("caches" in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch (error) {
        console.warn("[recovery] cache clear skipped", error);
      }
    }

    // Giữ registration để không làm mất Web Push. Chỉ yêu cầu SW kiểm tra bản mới.
    if ("serviceWorker" in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map((registration) =>
            registration.update().catch(() => null),
          ),
        );
      } catch (error) {
        console.warn("[recovery] service worker update skipped", error);
      }
    }
  };

  recoverStaleBuild = async (guardKey) => {
    if (!this.claimRecovery(guardKey)) return false;

    this.setState({ recovering: true });
    try {
      await this.clearRuntimeCaches();
    } finally {
      // replace + cache-buster bắt browser lấy index/chunks của cùng deployment,
      // tránh reload lại đúng HTML cũ từ PWA/browser cache.
      window.location.replace(freshLocation());
    }
    return true;
  };

  handleReload = async () => {
    try {
      // Nút thủ công luôn được phép thử lại; guard mới sẽ ngăn vòng lặp nếu
      // deployment/network vẫn chưa ổn sau lần tải này.
      sessionStorage.removeItem(APP_RELOAD_KEY);
      sessionStorage.removeItem(DOM_RELOAD_KEY);
    } catch {
      /* ignore */
    }

    this.setState({ recovering: true });
    try {
      await this.clearRuntimeCaches();
    } catch (error) {
      console.error("Lỗi khi reset app:", error);
    } finally {
      window.location.replace(freshLocation());
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-[100dvh] bg-base-100 text-base-content flex flex-col items-center justify-center p-4 md:p-6">
          <div className="w-full max-w-4xl text-left">
            <p className="text-6xl md:text-7xl font-semibold mb-4 md:mb-6">
              {":("}
            </p>
            <p className="text-xl md:text-2xl mb-3 md:mb-4 font-bold">
              {this.props.t("error_boundary.title")}
            </p>
            <p className="text-sm md:text-base opacity-80 mb-4 md:mb-6">
              {this.state.recovering
                ? "Đang tải lại phiên bản mới nhất…"
                : this.props.t("error_boundary.description")}
            </p>

            {this.state.error && !this.state.recovering && (
              <div className="rounded-md bg-base-300 p-3 md:p-4 mb-4 md:mb-6 shadow max-h-[40vh] overflow-auto">
                <p className="text-xs md:text-sm font-mono break-all">
                  {this.state.error.toString()}
                </p>
                {this.state.errorInfo && (
                  <pre className="text-[10px] md:text-xs mt-2 whitespace-pre-wrap font-mono">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-4">
              <button
                onClick={this.handleReload}
                disabled={this.state.recovering}
                className="group relative rounded-2xl px-6 py-3 bg-black text-white font-semibold transition-all duration-200 hover:scale-[1.03] active:scale-95 shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-black/40 disabled:opacity-60 disabled:pointer-events-none"
              >
                <span className="inline-flex items-center gap-2">
                  {this.state.recovering
                    ? "Đang khởi động lại…"
                    : this.props.t("error_boundary.restart")}
                </span>
              </button>

              <a
                href="https://discord.com/invite/47buy9nMGc"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative rounded-2xl px-6 py-3 bg-base-300 font-semibold transition-all duration-200 hover:scale-[1.03] hover:bg-base-200 active:scale-95 shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-base-content/20 text-center"
              >
                <span className="inline-flex items-center gap-2">
                  {this.props.t("error_boundary.join_community")}
                </span>
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default withTranslation("public")(ErrorBoundary);
