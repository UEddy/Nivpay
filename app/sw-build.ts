// Fills in public/sw.js at build time with this build's scripts and styles,
// so the service worker can keep every screen of the app shell for offline
// use, including screens not opened yet, and so each build gets its own
// cache. Fonts are left out: the browser loads only the few it needs, and the
// service worker keeps those as they are fetched.

import { createHash } from "node:crypto";

export const BUILD_PLACEHOLDER = "/* NIVPAY_BUILD */ null";

export type ShellBuild = { version: string; assets: string[] };

/** The files to keep: every built script and stylesheet, as absolute paths, sorted. */
export function shellBuild(files: string[]): ShellBuild {
  const assets = files
    .map((f) => f.replace(/\\/g, "/").replace(/^\/?/, "/"))
    .filter((f) => f.startsWith("/assets/") && /\.(js|css)$/.test(f))
    .sort();
  const version = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
  return { version, assets };
}

/** Puts the build into the service worker's source. Refuses a source without exactly one placeholder. */
export function injectBuild(source: string, build: ShellBuild): string {
  const parts = source.split(BUILD_PLACEHOLDER);
  if (parts.length !== 2) throw new Error(`sw.js must contain ${BUILD_PLACEHOLDER} exactly once`);
  return parts.join(JSON.stringify(build));
}
