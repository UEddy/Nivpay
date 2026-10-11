import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** ffmpeg from FFMPEG, then PATH, then winget's Gyan.FFmpeg install. */
export function ffmpegPath(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {}
  const base = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  if (existsSync(base)) {
    for (const pkg of readdirSync(base).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
      for (const build of readdirSync(join(base, pkg))) {
        const exe = join(base, pkg, build, "bin", "ffmpeg.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  throw new Error("ffmpeg not found: install it or set FFMPEG");
}
