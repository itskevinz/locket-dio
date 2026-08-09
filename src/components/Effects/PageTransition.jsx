import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTheme } from "@/hooks/useTheme";

const pageVariants = {
  initial: {
    opacity: 0,
    y: 10,
  },
  in: {
    opacity: 1,
    y: 0,
  },
  out: {
    opacity: 0,
    y: -8,
  },
};

const litePageVariants = {
  initial: {
    opacity: 0.68,
    y: 7,
  },
  in: {
    opacity: 1,
    y: 0,
  },
  out: {
    opacity: 0.8,
    y: -5,
  },
};

const pageTransition = {
  type: "tween",
  ease: [0.22, 1, 0.36, 1],
  duration: 0.28,
};

const litePageTransition = {
  type: "tween",
  ease: [0.22, 1, 0.36, 1],
  duration: 0.24,
};

export const PageTransition = ({ children, className = "w-full h-full" }) => {
  const { perfMode } = useTheme();
  const reduceMotion = useReducedMotion();

  // Tôn trọng cài đặt trợ năng của hệ điều hành.
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
