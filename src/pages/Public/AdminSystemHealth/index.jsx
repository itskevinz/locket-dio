import React, { lazy, Suspense, useState } from "react";

const AdminOpsSuite = lazy(
  () => import("@/features/AdminOps/AdminOpsSuite"),
);
const AdminOpsDashboard = lazy(
  () => import("@/features/AdminOps/AdminOpsDashboard"),
);
const AdminFeatureUsage = lazy(
  () => import("@/features/AdminOps/AdminFeatureUsage"),
);
const AccountHealth = lazy(
  () => import("@/features/SlotMonitor/AccountHealth"),
);
const AdminCelebCenter = lazy(
  () => import("@/features/SlotMonitor/AdminCelebCenter"),
);
const SystemStatus = lazy(
  () => import("@/features/SlotMonitor/SystemStatus"),
);
const LegacyAdminSystemHealth = lazy(() => import("./Legacy"));

export default function AdminSystemHealth({
  showCelebCenter = true,
  showAccountHealth = true,
  showSystemStatus = true,
  renderUsage,
}) {
  const [activeTab, setActiveTab] = useState("ops");

  return (
    <div className="w-full">
      <div
        role="tablist"
        className="tabs tabs-boxed flex-wrap gap-1 bg-base-200/50 p-1 mb-4"
      >
        <button
          type="button"
          role="tab"
          className={`tab font-black ${activeTab === "ops" ? "tab-active !bg-primary !text-white" : ""}`}
          onClick={() => setActiveTab("ops")}
        >
          Ops Suite · 7 nâng cấp
        </button>

        <button
          type="button"
          role="tab"
          className={`tab font-medium ${activeTab === "overview" ? "tab-active !bg-primary !text-white" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Tổng quan
        </button>

        {showCelebCenter && (
          <button
            type="button"
            role="tab"
            className={`tab font-medium ${activeTab === "celeb" ? "tab-active !bg-primary !text-white" : ""}`}
            onClick={() => setActiveTab("celeb")}
          >
            Celeb & Canh Slot
          </button>
        )}

        <button
          type="button"
          role="tab"
          className={`tab font-medium ${activeTab === "usage" ? "tab-active !bg-primary !text-white" : ""}`}
          onClick={() => setActiveTab("usage")}
        >
          Sử dụng tính năng
        </button>

        {showAccountHealth && (
          <button
            type="button"
            role="tab"
            className={`tab font-medium ${activeTab === "account" ? "tab-active !bg-primary !text-white" : ""}`}
            onClick={() => setActiveTab("account")}
          >
            Tài khoản & Kênh
          </button>
        )}

        {showSystemStatus && (
          <button
            type="button"
            role="tab"
            className={`tab font-medium ${activeTab === "system" ? "tab-active !bg-primary !text-white" : ""}`}
            onClick={() => setActiveTab("system")}
          >
            Hạ tầng hệ thống
          </button>
        )}

        <button
          type="button"
          role="tab"
          className={`tab font-medium ${activeTab === "legacy" ? "tab-active !bg-primary !text-white" : ""}`}
          onClick={() => setActiveTab("legacy")}
        >
          API & Thiết bị
        </button>
      </div>

      <div className="w-full">
        <Suspense
          fallback={
            <div className="flex min-h-48 items-center justify-center">
              <span className="loading loading-spinner loading-md" aria-label="Đang tải" />
            </div>
          }
        >
          {activeTab === "ops" && <AdminOpsSuite />}
          {activeTab === "overview" && <AdminOpsDashboard />}
          {activeTab === "celeb" && showCelebCenter && <AdminCelebCenter />}
          {activeTab === "usage" && <AdminFeatureUsage />}
          {activeTab === "account" && showAccountHealth && <AccountHealth />}
          {activeTab === "system" && showSystemStatus && (
            <SystemStatus renderUsage={renderUsage} />
          )}
          {activeTab === "legacy" && <LegacyAdminSystemHealth />}
        </Suspense>
      </div>
    </div>
  );
}
