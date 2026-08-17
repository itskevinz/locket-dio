import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import AccountHealth from "@/features/SlotMonitor/AccountHealth";
import AdminCelebCenter from "@/features/SlotMonitor/AdminCelebCenterLive";
import SystemStatus from "@/features/SlotMonitor/SystemStatus";
import { getAdminRoleInfo } from "@/services/AdminAuthService";
import AdminSystemHealth from "../AdminSystemHealth";

export default function AdminOperations() {
  const [access, setAccess] = useState("checking");

  useEffect(() => {
    let active = true;
    getAdminRoleInfo()
      .then((info) => {
        if (active) setAccess(info?.isAdmin ? "allowed" : "denied");
      })
      .catch(() => {
        if (active) setAccess("denied");
      });
    return () => {
      active = false;
    };
  }, []);

  if (access === "checking") {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-base-100 px-4">
        <div className="flex items-center gap-3 rounded-2xl border border-base-300 bg-base-200/60 px-5 py-4 text-sm font-semibold">
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
          Đang xác minh quyền Admin...
        </div>
      </div>
    );
  }

  if (access !== "allowed") {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-base-100 px-4">
        <div className="w-full max-w-md rounded-3xl border border-error/25 bg-error/5 p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-error" />
          <h1 className="mt-3 text-xl font-bold">Khu vực chỉ dành cho Admin</h1>
          <p className="mt-2 text-sm text-base-content/65">
            Tài khoản hiện tại không có quyền xem Celeb Center toàn server, Account Health và System Status.
          </p>
          <Link to="/friends?slot=1" className="btn btn-sm btn-outline mt-5">
            Quay lại Canh Slot
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <div className="mx-auto w-full max-w-6xl px-4 pt-6 md:px-8 md:pt-8">
        <div className="flex flex-col gap-4 rounded-3xl border border-base-content/10 bg-base-200/45 p-5 shadow-sm backdrop-blur-md md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex items-start gap-3">
            <Link
              to="/admin/users"
              className="btn btn-circle btn-ghost btn-sm border border-base-content/10"
              title="Quay lại quản lý người dùng"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-extrabold md:text-3xl">
                <ShieldCheck className="h-7 w-7 text-primary" />
                Vận hành Admin
              </h1>
              <p className="mt-1 text-sm text-base-content/65">
                Toàn bộ Celeb từ worker Render, sức khỏe Canh Slot và trạng thái backend chỉ hiển thị cho Admin.
              </p>
            </div>
          </div>
          <Link to="/friends?slot=1" className="btn btn-sm btn-outline rounded-full">
            Xem giao diện của người dùng
          </Link>
        </div>
      </div>

      <section className="pt-2" aria-label="Vận hành Canh Slot toàn server">
        <AdminCelebCenter />
        <AccountHealth />
        <SystemStatus />
      </section>

      <div className="mx-auto mt-2 w-full max-w-6xl px-4 md:px-8">
        <div className="border-t border-base-content/10" />
      </div>

      <AdminSystemHealth
        showCelebCenter={false}
        showAccountHealth={false}
        showSystemStatus={false}
      />
    </div>
  );
}
