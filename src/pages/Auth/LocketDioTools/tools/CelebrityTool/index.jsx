import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CONFIG } from "@/config";
import {
  fetchUserById,
  getListCelebrityV2,
  SendRequestToCelebrity,
} from "@/services";
import CelebrateItem from "./components/CelebrateItem";
import SkeletonItem from "./components/SkeletonItem";
import FilterButton from "./components/FilterButton";
import {
  SonnerError,
  SonnerInfo,
  SonnerPromise,
  SonnerSuccess,
  SonnerWarning,
} from "@/components/uikit/SonnerToast";
import { RefreshCcw, Search, X } from "lucide-react";
import { useFeatureVisible } from "@/hooks/useFeature";
import { PiExport } from "react-icons/pi";
import LockedPremiumFeature from "../../Layout/LockedPremiumFeature";
import {
  categorizeCelebrityUsers,
  groupCelebrityRecords,
  mapWithConcurrencySettled,
  mergeCelebrityWithUser,
  normalizeCelebrityRecords,
} from "./celebrityUtils";

const DETAIL_CONCURRENCY = 6;

function getLoadError(error) {
  const status = error?.response?.status;
  const code = error?.response?.data?.code || error?.code;
  const serverMessage = error?.response?.data?.message;

  if (status === 401) return "Phiên đăng nhập đã hết hạn.";
  if (status === 429) return "Bạn làm mới quá nhanh. Vui lòng thử lại sau.";
  if (code === "DATABASE_UNAVAILABLE") {
    return "Cơ sở dữ liệu Celebrity chưa được cấu hình.";
  }
  if (code === "CELEBRITY_SCHEMA_MISSING") {
    return "Dữ liệu Celebrity chưa được khởi tạo.";
  }
  return serverMessage || "Không thể tải danh sách Celebrity.";
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

export default function CelebrateTool() {
  const isCelebrityFeature = useFeatureVisible("celebrity_tool");
  const [catalog, setCatalog] = useState(null);
  const [userDetails, setUserDetails] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [loadError, setLoadError] = useState("");
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [processingUid, setProcessingUid] = useState(null);
  const [countryCode, setCountryCode] = useState(
    () => localStorage.getItem("celebrate_country") || "ALL",
  );

  const mountedRef = useRef(true);
  const catalogRequestRef = useRef(null);
  const catalogSequenceRef = useRef(0);
  const detailSequenceRef = useRef(0);
  const userCacheRef = useRef(new Map());
  const refreshToastRef = useRef(null);
  const sendingRef = useRef(new Set());

  useEffect(() => {
    localStorage.setItem("celebrate_country", countryCode);
  }, [countryCode]);

  const loadCatalog = useCallback(({ forceRefresh = false } = {}) => {
    if (catalogRequestRef.current) {
      return catalogRequestRef.current.promise;
    }

    const sequence = ++catalogSequenceRef.current;
    const controller = new AbortController();
    setLoadState("loading");
    setLoadError("");

    const promise = getListCelebrityV2({
      signal: controller.signal,
      refresh: forceRefresh,
    })
      .then((response) => {
        const records = normalizeCelebrityRecords(response);
        if (!mountedRef.current || sequence !== catalogSequenceRef.current) {
          return records;
        }

        userCacheRef.current.clear();
        setCatalog(records);
        setUnavailableCount(0);
        setCountryCode((current) =>
          current === "ALL" ||
          records.some((record) => record.countryCode === current)
            ? current
            : "ALL",
        );
        return records;
      })
      .catch((error) => {
        if (
          mountedRef.current &&
          sequence === catalogSequenceRef.current &&
          error?.name !== "CanceledError"
        ) {
          setCatalog(null);
          setUserDetails([]);
          setUnavailableCount(0);
          setLoadState("error");
          setLoadError(getLoadError(error));
        }
        throw error;
      })
      .finally(() => {
        if (catalogRequestRef.current?.sequence === sequence) {
          catalogRequestRef.current = null;
        }
      });

    catalogRequestRef.current = { controller, promise, sequence };
    return promise;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (isCelebrityFeature) {
      loadCatalog().catch(() => {});
    }

    return () => {
      mountedRef.current = false;
      catalogSequenceRef.current += 1;
      detailSequenceRef.current += 1;
      catalogRequestRef.current?.controller.abort();
      catalogRequestRef.current = null;
    };
  }, [isCelebrityFeature, loadCatalog]);

  const celebrateList = useMemo(
    () => groupCelebrityRecords(catalog || []),
    [catalog],
  );

  const currentCatalog = useMemo(() => {
    if (!catalog) return [];
    return countryCode === "ALL"
      ? catalog
      : celebrateList[countryCode] || [];
  }, [catalog, celebrateList, countryCode]);

  useEffect(() => {
    if (!catalog) return;

    if (currentCatalog.length === 0) {
      detailSequenceRef.current += 1;
      setUserDetails([]);
      setUnavailableCount(0);
      setLoadState("empty");
      return;
    }

    const sequence = ++detailSequenceRef.current;
    setLoadState("loading");
    setLoadError("");

    mapWithConcurrencySettled(
      currentCatalog,
      DETAIL_CONCURRENCY,
      async (record) => {
        const cached = userCacheRef.current.get(record.uid);
        if (cached) return cached;

        const liveUser = await fetchUserById(record.uid);
        if (!liveUser) {
          const error = new Error("CELEBRITY_DETAILS_UNAVAILABLE");
          error.code = "CELEBRITY_DETAILS_UNAVAILABLE";
          throw error;
        }
        return mergeCelebrityWithUser(record, liveUser);
      },
    )
      .then((results) => {
        if (!mountedRef.current || sequence !== detailSequenceRef.current) {
          return;
        }
        const details = results
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value);
        const failedCount = results.length - details.length;
        if (details.length === 0) {
          throw new Error("CELEBRITY_DETAILS_UNAVAILABLE");
        }
        details.forEach((user) => userCacheRef.current.set(user.uid, user));
        setUserDetails(details);
        setUnavailableCount(failedCount);
        setLoadState("success");
      })
      .catch(() => {
        if (!mountedRef.current || sequence !== detailSequenceRef.current) {
          return;
        }
        setUserDetails([]);
        setUnavailableCount(0);
        setLoadState("error");
        setLoadError(
          "Không thể tải trạng thái Celebrity từ Locket. Vui lòng thử lại.",
        );
      });
  }, [catalog, currentCatalog]);

  const handleRefresh = () => {
    if (refreshToastRef.current) return;

    const refreshPromise = loadCatalog({ forceRefresh: true }).then((records) => ({
      total: records.length,
      country: countryCode,
    }));
    refreshToastRef.current = refreshPromise;

    SonnerPromise(refreshPromise, {
      loading: "Đang làm mới dữ liệu...",
      success: (data) =>
        `Đã tải ${data?.total || 0} Celebrity (${data?.country})`,
      error: (error) => getLoadError(error),
    });

    const clearRefresh = () => {
      if (refreshToastRef.current === refreshPromise) {
        refreshToastRef.current = null;
      }
    };
    refreshPromise.then(clearRefresh, clearRefresh);
  };

  const handleAddUid = async (uid) => {
    if (!uid || !String(uid).trim()) {
      return SonnerInfo("UID Celebrity không hợp lệ.");
    }
    if (sendingRef.current.size > 0) return;

    sendingRef.current.add(uid);
    setProcessingUid(uid);

    try {
      const response = await SendRequestToCelebrity(uid);
      if (!response?.success) {
        return SonnerWarning(
          response?.message || "Không thể gửi yêu cầu kết bạn.",
        );
      }

      SonnerSuccess(
        "Đã gửi yêu cầu thành công!",
        "Đang cập nhật trạng thái...",
      );
      const updatedUser = await fetchUserById(uid);
      const record = catalog?.find((item) => item.uid === uid);
      if (updatedUser && record) {
        const merged = mergeCelebrityWithUser(record, updatedUser);
        userCacheRef.current.set(uid, merged);
        setUserDetails((previous) =>
          previous.map((user) => (user.uid === uid ? merged : user)),
        );
      }
    } catch (error) {
      SonnerError(
        "Gửi kết bạn thất bại.",
        error?.response?.data?.message || "Vui lòng thử lại sau.",
      );
    } finally {
      sendingRef.current.delete(uid);
      setProcessingUid(null);
    }
  };

  const exportPDF = async () => {
    if (loadState !== "success" || userDetails.length === 0) {
      return SonnerInfo("Chỉ có thể xuất dữ liệu Celebrity đã tải thành công.");
    }

    try {
      const response = await fetch(`${CONFIG.api.exportApi}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: userDetails }),
      });
      if (!response.ok) throw new Error(`EXPORT_${response.status}`);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "danh_sach_celebrity.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      SonnerError("Không thể xuất PDF Celebrity.");
    }
  };

  const categorized = useMemo(
    () => categorizeCelebrityUsers(userDetails),
    [userDetails],
  );
  const tabs = [
    { key: "all", label: "Tất cả", count: categorized.all.length },
    { key: "friends", label: "Bạn bè", count: categorized.friends.length },
    { key: "waitlist", label: "Xếp hàng", count: categorized.waitlist.length },
    { key: "hasSlot", label: "Còn slot", count: categorized.hasSlot.length },
    { key: "noSlot", label: "Hết slot", count: categorized.noSlot.length },
    {
      key: "waitaccept",
      label: "Chờ chấp nhận",
      count: categorized.waitaccept.length,
    },
  ];

  const searchedUsers = useMemo(() => {
    const users = categorized[activeTab] || [];
    const query = normalizeSearchText(searchQuery).replace(/^@+/, "");
    if (!query) return users;

    return users.filter((user) => {
      const searchableText = normalizeSearchText(
        [
          user.first_name,
          user.last_name,
          user.username,
          user.uid,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return searchableText.includes(query);
    });
  }, [categorized, activeTab, searchQuery]);

  if (!isCelebrityFeature) {
    return <LockedPremiumFeature />;
  }

  const isLoading = loadState === "loading" || loadState === "idle";
  const canExport = loadState === "success" && userDetails.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold">
          Celebrity Toàn Cầu
          <span className="badge badge-sm badge-accent ml-2">Verified</span>
        </h2>
        <div className="flex gap-2 flex-row">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-base-200"
            disabled={isLoading}
          >
            <RefreshCcw className="w-4 h-4" /> Làm mới
          </button>
          <button
            onClick={exportPDF}
            className="flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-base-200"
            disabled={!canExport}
          >
            <PiExport className="w-4 h-4" /> Xuất PDF
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm opacity-80">
        Danh mục Celebrity đã xác minh được tự động đồng bộ khi có người mới.
        Click vào username để copy link kết bạn. Bấm thêm để gửi kết bạn tới họ.
      </p>
      <div className="mb-3 text-sm opacity-80 leading-relaxed space-y-1">
        <p>1. Chỉ cần làm mới khi cần thiết.</p>
        <p>2. Không spam yêu cầu để tránh ảnh hưởng tới tài khoản.</p>
      </div>

      {catalog?.length > 0 && (
        <>
          <h3 className="font-semibold text-sm uppercase opacity-70">
            Danh mục quốc gia
          </h3>
          <div className="flex gap-2 mb-3 flex-wrap">
            <FilterButton
              label="TOÀN CẦU"
              count={catalog.length}
              active={countryCode === "ALL"}
              activeClass="bg-green-500 text-white"
              onClick={() => setCountryCode("ALL")}
            />
            {Object.keys(celebrateList).map((code) => (
              <FilterButton
                key={code}
                label={code}
                count={celebrateList[code].length}
                active={countryCode === code}
                activeClass="bg-green-500 text-white"
                onClick={() => setCountryCode(code)}
              />
            ))}
          </div>

          <h3 className="font-semibold text-sm uppercase opacity-70">
            Bộ lọc nhanh
          </h3>
          <div className="flex gap-2 mb-3 flex-wrap">
            {tabs.map((tab) => (
              <FilterButton
                key={tab.key}
                label={tab.label}
                count={tab.count}
                active={activeTab === tab.key}
                activeClass="bg-blue-500 text-white"
                onClick={() => setActiveTab(tab.key)}
              />
            ))}
          </div>

          <div className="mb-3">
            <label
              htmlFor="celebrity-search"
              className="font-semibold text-sm uppercase opacity-70"
            >
              Tìm Celebrity
            </label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50 pointer-events-none" />
              <input
                id="celebrity-search"
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Tìm theo tên, @username hoặc UID..."
                autoComplete="off"
                className="input input-bordered w-full h-10 pl-10 pr-10 bg-base-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Xóa tìm kiếm"
                  title="Xóa tìm kiếm"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-base-200"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <p className="text-xs opacity-60 mt-1">
                Tìm thấy {searchedUsers.length} Celebrity trong bộ lọc hiện tại.
              </p>
            )}
            {unavailableCount > 0 && (
              <p className="text-xs text-warning mt-1">
                Tạm bỏ qua {unavailableCount} hồ sơ Locket chưa phản hồi; các hồ sơ
                còn lại vẫn dùng bình thường.
              </p>
            )}
          </div>
        </>
      )}

      <div className="border rounded-sm h-96 overflow-y-auto">
        {isLoading ? (
          <>
            {Array.from({ length: 5 }).map((_, index) => (
              <SkeletonItem key={index} />
            ))}
          </>
        ) : loadState === "error" ? (
          <div className="h-full flex flex-col items-center justify-center p-3 text-center">
            <p className="text-sm text-error">{loadError}</p>
            <button
              type="button"
              className="btn btn-sm btn-outline mt-2"
              onClick={() => loadCatalog().catch(() => {})}
            >
              Thử lại
            </button>
          </div>
        ) : loadState === "empty" ? (
          <p className="text-sm opacity-70 p-3">
            Chưa có dữ liệu Celebrity đã xác minh.
          </p>
        ) : searchedUsers.length > 0 ? (
          searchedUsers.map((user) => (
            <CelebrateItem
              key={user.uid}
              user={user}
              slotdata={user.celebrity_data}
              onAdd={handleAddUid}
              loadingUid={processingUid}
            />
          ))
        ) : (
          <p className="text-sm opacity-70 p-3">
            {searchQuery.trim()
              ? "Không tìm thấy Celebrity phù hợp từ khóa và bộ lọc hiện tại."
              : "Không có Celebrity phù hợp bộ lọc này."}
          </p>
        )}
      </div>
    </div>
  );
}
