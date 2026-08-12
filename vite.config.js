import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import { VitePWA } from "vite-plugin-pwa";

const manifestForPlugIn = {
  // injectManifest: custom src/sw.js (network-first nav, network-only APIs)
  strategies: "injectManifest",
  srcDir: "src",
  filename: "sw.js",
  // App registers via virtual:pwa-register — avoid double inject in HTML
  injectRegister: false,
  injectManifest: {
    // App shell + hashed chunks from CURRENT build (no hard-coded chunk names)
    globPatterns: [
      "index.html",
      "offline.html",
      "manifest.webmanifest",
      "assets/*.{js,css,woff2,woff}",
      "favicon*.{ico,png,svg}",
      "android-chrome-*.png",
      "apple-touch-icon.png",
      "maskable-icon-*.png",
      "fonts/**/*.{woff,woff2}",
    ],
    globIgnores: ["version.json", 
      "**/pwa-icons/**",
      "**/images/**",
      "**/stats.html",
      "**/prvlocket.png",
      // HEIC fallback is ~3 MB and must stay truly on-demand. Browsers that
      // already decode JPEG/PNG/WebP/AVIF should not download it at SW install.
      "**/assets/heic-to-*.js",
    ],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  },

  // prompt: user confirms update — no auto skipWaiting mid-edit
  registerType: "prompt",
  // Root scope so both `/` and `/locket` are controlled
  scope: "/",
  base: "/",

  includeAssets: [
    "favicon.ico",
    "apple-touch-icon.png",
    "maskable-icon-512x512.png",
    "offline.html",
  ],

  manifest: {
    name: "Huy Locket",
    short_name: "Huy Locket",
    description: "Huy Locket - Đăng ảnh & Video lên Locket",
    display: "standalone",
    scope: "/",
    // Mở PWA/web → thẳng camera Locket
    start_url: "/locket",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/maskable-icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  },
  // workbox options apply mainly to generateSW; kept for safety
  workbox: {
    cleanupOutdatedCaches: true,
    skipWaiting: false,
    clientsClaim: false,
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/assets\//, /^\/dio-/, /^\/api\//, /^\/sw\.js$/],
  },
};

const brand = process.env.VITE_BRAND;
const publicDir = brand ? `public-${brand}` : "public";

// Dev-only proxy — mirrors server.mjs PROXIES so /dio-* works under `vite` dev
// (production uses server.mjs; this only affects the dev server)
const DEV_API_UPSTREAM =
  process.env.LOCKET_API_UPSTREAM ||
  "https://huy-locket-api-production.up.railway.app";

const devProxyTargets = {
  "/dio-api": DEV_API_UPSTREAM,
  "/dio-auth": process.env.LOCKET_AUTH_UPSTREAM || "https://auth.locket-dio.com",
  "/dio-data": process.env.LOCKET_DATA_UPSTREAM || "https://data.locket-dio.com",
  "/dio-storage":
    process.env.LOCKET_STORAGE_UPSTREAM || "https://storage.locket-dio.com",
  "/dio-media":
    process.env.LOCKET_MEDIA_UPSTREAM || "https://media.locket-dio.com",
  "/dio-export":
    process.env.LOCKET_EXPORT_UPSTREAM || "https://export.locket-dio.com",
  "/dio-cdn": process.env.LOCKET_CDN_UPSTREAM || "https://cdn.locket-dio.com",
  "/dio-payment":
    process.env.LOCKET_PAYMENT_UPSTREAM || "https://payment.locket-dio.com",
};

const devProxy = Object.fromEntries(
  Object.entries(devProxyTargets).map(([prefix, target]) => [
    prefix,
    {
      target,
      changeOrigin: true,
      secure: true,
      rewrite: (p) => p.slice(prefix.length) || "/",
      headers: {
        // server.mjs spoofs Origin so upstream Dio APIs accept requests
        origin: "https://locket-dio.com",
        referer: "https://locket-dio.com/",
      },
    },
  ]),
);

export default defineConfig({
  publicDir,
  base: "/",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  server: {
    host: true,
    proxy: devProxy,
  },
  plugins: [tailwindcss(), react(), VitePWA(manifestForPlugIn), visualizer()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"), // alias @ trỏ vào thư mục src
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: [
            "axios",
            "zustand",
            "dexie",
            "uuid",
            "jwt-decode",
            "clsx",
            "prop-types",
            "sonner",
            "ldrs",
          ],
          react: ["react", "react-dom", "react-router-dom"],
          i18n: [
            "i18next",
            "react-i18next",
            "i18next-browser-languagedetector",
          ],
          icons: ["lucide-react", "react-icons"],
          media: ["swiper", "react-easy-crop"],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});
