import React from "react";
import { Code2 } from "lucide-react";
import { FaGithub, FaNodeJs, FaReact } from "react-icons/fa";
import { RiTailwindCssFill, RiVercelFill } from "react-icons/ri";
import { SiRailway } from "react-icons/si";
import { CONFIG } from "@/config";

const AboutMe = () => {
  const avatarUrl = CONFIG.app.myInfo.avatarUrl;
  const fullName = CONFIG.app.myInfo.fullName;

  return (
    <div className="min-h-screen flex flex-col items-center py-4">
      <div className="flex flex-col items-center mb-10 px-4">
        <img
          src={avatarUrl}
          alt="Huy Avatar"
          className="w-32 h-32 md:w-40 md:h-40 rounded-full border-4 border-white shadow-lg mb-4"
          loading="lazy"
        />
        <h1 className="text-3xl md:text-4xl font-semibold text-center">
          {fullName}
        </h1>
        <p className="text-lg md:text-xl mt-2">
          Web Developer | Thích sáng tạo và học hỏi
        </p>
      </div>

      <div className="max-w-3xl text-left mb-12 px-4">
        <p className="text-lg leading-relaxed">
          Mình là sinh viên năm cuối ngành CNTT, đam mê lập trình web và xây
          dựng sản phẩm thực tế.
        </p>
      </div>

      <div className="w-full mb-5 px-4">
        <h2 className="text-2xl md:text-3xl font-semibold text-center mb-8 flex justify-center items-center gap-2">
          <Code2 className="w-6 h-6 md:w-8 md:h-8" /> Công nghệ mình đang dùng
        </h2>

        <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-6 gap-y-4 text-sm md:text-lg">
          <div className="flex items-center gap-2">
            <FaReact className="w-6 h-6 text-cyan-500" /> React.js
          </div>
          <div className="flex items-center gap-2">
            <img src="/svg/vite.svg" alt="Vite" className="w-6 h-6" /> Vite
          </div>
          <div className="flex items-center gap-2">
            <FaNodeJs className="w-6 h-6 text-green-500" /> Node.js
          </div>
          <div className="flex items-center gap-2">
            <img src="/svg/firebase.svg" alt="Firebase" className="w-6 h-6" /> Firebase
          </div>
          <div className="flex items-center gap-2">
            <FaGithub className="w-6 h-6" /> GitHub
          </div>
          <div className="flex items-center gap-2">
            <RiTailwindCssFill className="w-6 h-6 text-cyan-500" /> TailwindCSS
          </div>
          <div className="flex items-center gap-2">
            <RiVercelFill className="w-6 h-6" /> Vercel
          </div>
          <div className="flex items-center gap-2">
            <SiRailway className="w-6 h-6" /> Railway
          </div>
          <div className="flex items-center gap-2">
            <img src="/svg/lucide.svg" alt="Lucide Icons" className="w-6 h-6" /> Lucide Icons
          </div>
          <div className="flex items-center gap-2">
            <img src="/svg/daisyui.svg" alt="DaisyUI" className="w-7 h-7" /> DaisyUI
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutMe;
