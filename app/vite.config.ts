import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The production security headers live in vercel.json. `vite preview` serves
// the same ones, so a production build can be checked locally under the real
// Content Security Policy before it is deployed.
type VercelHeaders = { headers: { source: string; headers: { key: string; value: string }[] }[] };
const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as VercelHeaders;
const allRoutes = vercel.headers.find((h) => h.source === "/(.*)");
const previewHeaders = Object.fromEntries((allRoutes?.headers ?? []).map((h) => [h.key, h.value]));

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: previewHeaders,
  },
});
