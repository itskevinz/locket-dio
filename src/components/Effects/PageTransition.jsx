import React, { useEffect, useState } from "react";
import { motion as Motion } from "framer-motion";
import { useAnimation } from "@/context/AnimationContext";

const pageVariants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  in: {
    opacity: 1,
    y: 0,
  },
  out: {
    opacity: 0,
    y: -6,
  },
};

const adminPageVariants = {
  initial: {
    opacity: 0,
    y: 16,
  },
  in: {
    opacity: 1,
    y: 0,
    transition: {
      type: "tween",
      ease: [0.22, 1, 0.36, 1],
      duration: 0.3,
    },
  },
  out: {
    opacity: 0,
    y: -8,
    transition: {
      type: "tween",
      ease: [0.4, 0, 1, 1],
      duration: 0.2,
    },
  },
};

const pageTransition = {
  type: "tween",
  ease: [0.22, 1, 0.36, 1],
  duration: 0.2,
};

function useSystemReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState(() => (
    typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  ));

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const handleChange = (event) => setReduceMotion(event.matches);
    media.addEventListener?.("change", handleChange);
    return () => media.removeEventListener?.("change", handleChange);
  }, []);

  return reduceMotion;
}

export const PageTransition = ({ children, className = "w-full h-full", preset = "default" }) => {
  const { isAnimationEnabled } = useAnimation();
  const systemReducedMotion = useSystemReducedMotion();
  const isAdmin = preset === "admin";

  if (!isAnimationEnabled || (isAdmin && systemReducedMotion)) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Motion.div
      initial="initial"
      animate="in"
      exit="out"
      variants={isAdmin ? adminPageVariants : pageVariants}
      transition={isAdmin ? undefined : pageTransition}
      className={className}
    >
      {children}
    </Motion.div>
  );
};

export default PageTransition;
