import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("all animation layers load deterministically before the app renders", () => {
  const main = read("src/main.jsx");

  assert.match(main, /styles\/animation\.css/);
  assert.match(main, /styles\/interaction-motion\.css/);
  assert.match(main, /styles\/performance-lite\.css/);
  assert.match(main, /styles\/essential-motion\.css/);
  assert.match(main, /styles\/motion-policy\.css/);
  assert.match(
    main,
    /essential-motion\.css["'];\s*\nimport ["']\.\/styles\/motion-policy\.css/,
  );
});

test("the in-app animation switch is the single Framer Motion authority", () => {
  const context = read("src/context/AnimationContext.jsx");
  const pageTransition = read("src/components/Effects/PageTransition.jsx");
  const scrollReveal = read("src/components/Effects/ScrollReveal.jsx");

  assert.match(context, /dataset\.animationEnabled/);
  assert.match(
    context,
    /reducedMotion=\{isAnimationEnabled \? ["']never["'] : ["']always["']\}/,
  );
  assert.match(pageTransition, /useAnimation/);
  assert.match(pageTransition, /if \(!isAnimationEnabled\)/);
  assert.doesNotMatch(pageTransition, /useReducedMotion|litePageVariants/);
  assert.match(scrollReveal, /useAnimation/);
  assert.match(scrollReveal, /initial=\{\{\s*opacity:\s*0,\s*y:\s*yOffset\s*\}\}/);
  assert.doesNotMatch(scrollReveal, /useReducedMotion|perfMode === ["']lite["']/);
});

test("camera and history panels use direct Framer Motion instead of CSS transforms", () => {
  const home = read("src/pages/LocketCameraBeta/MainHomeScreen/index.jsx");
  const policy = read("src/styles/motion-policy.css");

  assert.match(home, /import \{ motion \} from ["']framer-motion["']/);
  assert.match(home, /data-history-motion="framer"/);
  assert.match(home, /duration:\s*isAnimationEnabled \? 0\.5 : 0/);
  assert.match(home, /animate=\{\{ y: isBottomOpen \? "0%" : "100%" \}\}/);
  assert.match(home, /animate=\{\{ y: isBottomOpen \? "-100%" : "0%" \}\}/);
  assert.match(
    policy,
    /data-history-motion="framer"[\s\S]*transition-property:\s*none\s*!important/,
  );
});

test("core motion stays recognizable in weak-device mode when enabled", () => {
  const policy = read("src/styles/motion-policy.css");
  const interaction = read("src/styles/interaction-motion.css");
  const viewer = read(
    "src/pages/LocketCameraBeta/BottomHomeScreen/Views/SwiperView/MomentViewer.jsx",
  );

  assert.match(policy, /data-animation-enabled="true"/);
  assert.match(policy, /data-camera-panel="true"/);
  assert.match(policy, /data-history-panel="true"/);
  assert.match(policy, /transition-duration:\s*500ms\s*!important/);
  assert.match(policy, /\.moment-enter[\s\S]*hl-moment-enter\s+200ms/);
  assert.match(policy, /\.moment-skeleton[\s\S]*hl-skeleton-shimmer\s+1\.35s/);
  assert.match(policy, /\.history-container/);
  assert.match(policy, /\.dropdown-content/);
  assert.match(interaction, /@keyframes\s+hl-moment-enter/);
  assert.match(viewer, /moment-enter/);
  assert.match(viewer, /moment-skeleton/);
  assert.match(viewer, /moment-overlay-enter/);
});

test("turning the site animation switch off disables functional motion", () => {
  const policy = read("src/styles/motion-policy.css");

  assert.match(policy, /data-animation-enabled="false"/);
  assert.match(
    policy,
    /data-animation-enabled="false"[\s\S]*transition-duration:\s*0\.01ms\s*!important/,
  );
  assert.match(
    policy,
    /data-animation-enabled="false"[\s\S]*animation:\s*none\s*!important/,
  );
});
