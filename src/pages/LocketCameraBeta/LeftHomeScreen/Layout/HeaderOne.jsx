import EditProfilePopup from "@/features/EditProfilePopup";
import SettingPoup from "@/features/SettingPoup";
import {
  ChevronRight,
  Settings,
  UserRound,
  UserRoundPen,
} from "lucide-react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

function HeaderOne({ setIsProfileOpen }) {
  const navigate = useNavigate();
  const [openSettingModal, setOpenSettingModal] = useState(false);
  const [openEditProfile, setOpenEditProfile] = useState(false);

  const openFullProfile = () => {
    setIsProfileOpen(false);
    navigate("/profile");
  };

  return (
    <>
      <div className="flex items-center justify-between px-4 py-1">
        <div className="font-lovehouse shadow/40 select-none backdrop-blur-2xl text-xl px-3 pt-1.5 border-3 border-amber-400 rounded-xl">
          Huy Locket
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={openFullProfile}
            aria-label="Mở trang Hồ sơ"
            title="Hồ sơ"
            className="btn btn-circle p-2 border-0 hover:bg-base-200 transition shadow"
          >
            <UserRound size={22} />
          </button>
          <button
            type="button"
            onClick={() => setOpenSettingModal(true)}
            aria-label="Mở cài đặt"
            title="Cài đặt"
            className="btn btn-circle p-2 border-0 hover:bg-base-200 transition shadow"
          >
            <Settings size={22} />
          </button>
          <button
            type="button"
            onClick={() => setOpenEditProfile(true)}
            aria-label="Chỉnh sửa hồ sơ nhanh"
            title="Chỉnh sửa hồ sơ nhanh"
            className="btn btn-circle p-2 border-0 hover:bg-base-200 transition shadow"
          >
            <UserRoundPen size={22} />
          </button>
          <button
            type="button"
            onClick={() => setIsProfileOpen(false)}
            aria-label="Đóng bảng hồ sơ"
            title="Đóng"
            className="btn btn-circle p-1 border-0 hover:bg-base-200 transition cursor-pointer shadow"
          >
            <ChevronRight size={40} />
          </button>
        </div>
      </div>
      <SettingPoup
        open={openSettingModal}
        onClose={() => setOpenSettingModal(false)}
      />
      <EditProfilePopup
        open={openEditProfile}
        onClose={() => setOpenEditProfile(false)}
      />
    </>
  );
}

export default HeaderOne;
