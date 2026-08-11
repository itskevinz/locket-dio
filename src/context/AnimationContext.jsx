import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { MotionConfig } from "framer-motion";

const STORAGE_KEY = "global_animation_enabled";

const AnimationContext = createContext({
  isAnimationEnabled: true,
  toggleAnimation: () => {},
});

export const useAnimation = () => useContext(AnimationContext);

function readAnimationEnabled() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) {
      return !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    }
    return JSON.parse(saved) !== false;
  } catch {
    return true;
  }
}

function syncRootAnimationFlag(enabled) {
  try {
    document.documentElement.dataset.animationEnabled = enabled ? "true" : "false";
  } catch {
    /* browser-only optional flag */
  }
}

/**
 * Global animation control.
 *
 * The in-app "Hiệu ứng" switch is the single source of truth. When it is ON,
 * functional motion remains visible on normal and Máy yếu modes. When it is
 * OFF, Framer Motion and the matching CSS policy both stop functional motion.
 */
export const AnimationProvider = ({ children }) => {
  const [isAnimationEnabled, setIsAnimationEnabled] = useState(() => {
    const enabled = readAnimationEnabled();
    syncRootAnimationFlag(enabled);
    return enabled;
  });

  useLayoutEffect(() => {
    syncRootAnimationFlag(isAnimationEnabled);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(isAnimationEnabled));
    } catch {
      /* ignore storage failures */
    }
  }, [isAnimationEnabled]);

  const toggleAnimation = () => setIsAnimationEnabled((prev) => !prev);

  return (
    <AnimationContext.Provider value={{ isAnimationEnabled, toggleAnimation }}>
      <MotionConfig reducedMotion={isAnimationEnabled ? "never" : "always"}>
        {children}
      </MotionConfig>
    </AnimationContext.Provider>
  );
};
