import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTheme } from "@/hooks/useTheme";

/**
 * A wrapper component that applies a fade-in and slide-up animation
 * when the element scrolls into view.
 *
 * Lite mode keeps a shorter/smaller reveal instead of removing the motion.
 * This preserves visual feedback while still avoiding long animations on
 * weaker devices.
 */
export const ScrollReveal = ({
  children,
  className = "",
  delay = 0,
  duration = 0.5,
  yOffset = 30,
  once = true,
  amount = 0.2,
  as = "div",
  ...props
}) => {
  const { perfMode } = useTheme();
  const reduceMotion = useReducedMotion();
  const MotionComponent = motion[as] || motion.div;

  // Explicit OS/browser accessibility preference still wins.
  if (reduceMotion) {
    return React.createElement(as, { className, ...props }, children);
  }

  const isLite = perfMode === "lite";
  const initialY = isLite
    ? Math.max(-10, Math.min(10, Number(yOffset) || 0))
    : yOffset;

  return (
    <MotionComponent
      initial={{ opacity: isLite ? 0.78 : 0, y: initialY }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount: isLite ? 0.08 : amount }}
      transition={{
        duration: isLite ? Math.min(Number(duration) || 0.5, 0.22) : duration,
        delay: isLite ? Math.min(Number(delay) || 0, 0.06) : delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
      {...props}
    >
      {children}
    </MotionComponent>
  );
};

export default ScrollReveal;