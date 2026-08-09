import React, { useEffect, useState } from "react";
import { motion as Motion } from "framer-motion";
import { useAnimation } from "@/context/AnimationContext";
import "./page-transition.css";

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

const adminShellVariants = {
  initial: { opacity: 0 },
  in: {
    opacity: 1,
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
  out: {
    opacity: 0,
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
  },
};

const adminContentVariants = {
  initial: {
    opacity: 0,
    y: 22,
    scale: 0.988,
    filter: "blur(5px)",
  },
  in: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      type: "tween",
      ease: [0.22, 1, 0.36, 1],
      duration: 0.42,
    },
  },
  out: {
    opacity: 0,
    y: -10,
    scale: 0.996,
    filter: "blur(3px)",
    transition: {
      type: "tween",
      ease: [0.4, 0, 1, 1],
      duration: 0.24,
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

  if (isAdmin) {
    return (
      <Motion.div
        initial="initial"
        animate="in"
        exit="out"
        variants={adminShellVariants}
        className={`${className} page-transition--admin`}
      >
        <Motion.span
          className="admin-route-transition__veil"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.24, 0] }}
          exit={{ opacity: [0, 0.16, 0] }}
          transition={{ duration: 0.5, times: [0, 0.34, 1], ease: "easeOut" }}
        />
        <Motion.span
          className="admin-route-transition__scan"
          aria-hidden="true"
          initial={{ opacity: 0, x: "-115%" }}
          animate={{ opacity: [0, 0.78, 0], x: ["-115%", "0%", "115%"] }}
          exit={{ opacity: [0, 0.45, 0], x: ["115%", "0%", "-115%"] }}
          transition={{ duration: 0.56, times: [0, 0.45, 1], ease: [0.22, 1, 0.36, 1] }}
        />
        <Motion.span
          className="admin-route-transition__rail"
          aria-hidden="true"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: [0, 0.72, 1], opacity: [0, 1, 0] }}
          exit={{ scaleX: [0, 1], opacity: [0, 1, 0] }}
          transition={{ duration: 0.48, times: [0, 0.72, 1], ease: [0.22, 1, 0.36, 1] }}
        />
        <Motion.div className="page-transition--admin__content" variants={adminContentVariants}>
          {children}
        </Motion.div>
      </Motion.div>
    );
  }

  return (
    <Motion.div
      initial="initial"
      animate="in"
      exit="out"
      variants={pageVariants}
      transition={pageTransition}
      className={className}
    >
      {children}
    </Motion.div>
  );
};

export default PageTransition;
