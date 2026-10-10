import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { injectBuild, shellBuild } from "./sw-build.ts";

// The production security headers live in vercel.json. `vite preview` serves
// the same ones, so a production build can be checked locally under the real
// Content Security Policy before it is deployed.
type VercelHeaders = { headers: { source: string; headers: { key: string; value: string }[] }[] };
const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as VercelHeaders;
const allRoutes = vercel.headers.find((h) => h.source === "/(.*)");
const previewHeaders = Object.fromEntries((allRoutes?.headers ?? []).map((h) => [h.key, h.value]));

// /api/fund only runs on Vercel, where the funder key lives. For local and
// phone testing, set NIVPAY_API_TARGET to the Vercel deployment's URL and the
// dev server forwards /api there. The browser's Origin stays
// http://localhost:5173, which that deployment accepts only if it is listed
// in its ALLOWED_ORIGINS.
const apiTarget = process.env.NIVPAY_API_TARGET;

/** After the build is written, puts its scripts and styles into dist/sw.js (sw-build.ts). */
function serviceWorkerShell(): Plugin {
  let outDir = "dist";
  return {
    name: "nivpay-sw-shell",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const root = join(outDir, "assets");
      const files = readdirSync(root).map((f) => relative(outDir, join(root, f)));
      const sw = join(outDir, "sw.js");
      writeFileSync(sw, injectBuild(readFileSync(sw, "utf8"), shellBuild(files)));
    },
  };
}

export default defineConfig({
  plugins: [serviceWorkerShell()],
  build: {
    target: "es2022",
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // React in a chunk of its own: it is a third of the first screen and
          // changes only with its version, so a phone keeps it across deploys
          // while the app's own chunks change. Screens and the signing code
          // load on demand (src/App.tsx).
          groups: [{ name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiTarget ? { "/api": { target: apiTarget, changeOrigin: true, secure: true } } : undefined,
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: previewHeaders,
  },
});
