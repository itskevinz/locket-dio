import React from "react";
import { motion } from "framer-motion";
import { useAnimation } from "@/context/AnimationContext";

/**
 * Familiar Huy Locket fade + slide-up reveal.
 *
 * Máy yếu still uses this cheap opacity/transform motion. Heavy decorative GPU
 * effects are reduced elsewhere; the post/list appearance itself is preserved.
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
  const { isAnimationEnabled } = useAnimation();
  const MotionComponent = motion[as] || motion.div;

  if (!isAnimationEnabled) {
    return React.createElement(as, { className, ...props }, children);
  }

  return (
    <MotionComponent
      initial={{ opacity: 0, y: yOffset }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount }}
      transition={{
        duration,
        delay,
        ease: "easeOut",
      }}
      className={className}
      {...props}
    >
      {children}
    </MotionComponent>
  );
};

export default ScrollReveal;
