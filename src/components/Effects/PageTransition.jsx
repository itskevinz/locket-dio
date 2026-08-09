import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTheme } from "@/hooks/useTheme";

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

const litePageVariants = {
  initial: {
    opacity: 0.78,
    y: 3,
  },
  in: {
    opacity: 1,
    y: 0,
  },
  out: {
    opacity: 0.86,
    y: -2,
  },
};

const pageTransition = {
  type: "tween",
  ease: [0.22, 1, 0.36, 1],
  duration: 0.2,
};

const litePageTransition = {
  type: "tween",
  ease: [0.22, 1, 0.36, 1],
  duration: 0.12,
};

export const PageTransition = ({ children, className = "w-full h-full" }) => {
  const { perfMode } = useTheme();
  const reduceMotion = useReducedMotion();

  // Accessibility preference still wins: no motion when explicitly requested.
  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  const isLite = perfMode === "lite";

  return (
    <motion.div
      initial="initial"
      animate="in"
      exit="out"
      variants={isLite ? litePageVariants : pageVariants}
      transition={isLite ? litePageTransition : pageTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
