import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

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

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: false,
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
