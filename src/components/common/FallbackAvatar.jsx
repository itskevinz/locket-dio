import React, { useState } from "react";
import { User } from "lucide-react";

export const FallbackAvatar = ({ src, alt, name, className }) => {
  const [hasError, setHasError] = useState(false);

  const getInitial = () => {
    if (!name) return null;
    const cleanName = name.trim();
    if (!cleanName) return null;
    // Lấy ký tự đầu tiên
    return cleanName.charAt(0).toUpperCase();
  };

  const initial = getInitial();

  if (!src || hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-base-300 text-base-content overflow-hidden shrink-0 ${className}`}
      >
        {initial ? (
          <span className="font-semibold text-xl">{initial}</span>
        ) : (
          <User className="w-1/2 h-1/2 opacity-60" />
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || name || ""}
      className={`shrink-0 ${className}`}
      onError={() => setHasError(true)}
    />
  );
};
