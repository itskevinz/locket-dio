import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("interaction motion pack is loaded and respects accessibility/performance", () => {
  const main = read("src/main.jsx");
  const css = read("src/styles/interaction-motion.css");
  const essentialCss = read("src/styles/essential-motion.css");
  const pageTransition = read("src/components/Effects/PageTransition.jsx");

  assert.match(main, /interaction-motion\.css/);
  assert.match(main, /performance-lite\.css["'];\s*\nimport ["']\.\/styles\/essential-motion\.css/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /data-performance-mode="lite"/);
  assert.match(css, /#huy-locket-nav-drawer/);
  assert.match(css, /hl-moment-enter-lite/);
  assert.match(essentialCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(pageTransition, /useReducedMotion/);
  assert.match(pageTransition, /litePageVariants/);
  assert.match(pageTransition, /litePageTransition/);
  assert.doesNotMatch(pageTransition, /filter:\s*["']blur/);
});

test("menu and full-screen slides remain visible in lite mode", () => {
  const css = read("src/styles/interaction-motion.css");
  const essentialCss = read("src/styles/essential-motion.css");

  assert.match(
    css,
    /#huy-locket-nav-drawer\s*\{[\s\S]*transition-property:\s*transform, opacity/i,
  );
  assert.match(
    css,
    /data-performance-mode="lite"\]\s+#huy-locket-nav-drawer[\s\S]*170ms/i,
  );
  assert.match(
    css,
    /data-performance-mode="lite"\]\s+\.moment-enter\s*\{[\s\S]*hl-moment-enter-lite/i,
  );
  assert.match(
    essentialCss,
    /transition-transform\.duration-500[\s\S]*360ms/i,
  );
  assert.match(essentialCss, /data-camera-panel="true"/);
  assert.match(essentialCss, /data-history-panel="true"/);
});

test("post loading motion remains visible in lite mode", () => {
  const viewer = read(
    "src/pages/LocketCameraBeta/BottomHomeScreen/Views/SwiperView/MomentViewer.jsx",
  );
  const essentialCss = read("src/styles/essential-motion.css");
  const scrollReveal = read("src/components/Effects/ScrollReveal.jsx");
  const modal = read("src/components/MomentDraft/RestoreDraftModal.jsx");

  assert.match(viewer, /moment-enter/);
  assert.match(viewer, /moment-skeleton/);
  assert.match(viewer, /moment-overlay-enter/);
  assert.match(essentialCss, /hl-essential-media-shimmer/);
  assert.match(essentialCss, /data-ios-history-grid="true"[\s\S]*\.skeleton/);
  assert.match(essentialCss, /\.moment-media-fade/);
  assert.match(scrollReveal, /const isLite = perfMode === "lite"/);
  assert.match(
    scrollReveal,
    /initial=\{\{\s*opacity:\s*isLite \? 0\.78 : 0/,
  );
  assert.doesNotMatch(
    scrollReveal,
    /if \(perfMode === "lite"\)[\s\S]*React\.createElement/,
  );
  assert.match(modal, /interaction-modal-backdrop/);
  assert.match(modal, /interaction-modal-card/);
});
