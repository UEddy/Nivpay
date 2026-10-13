/**
 * Where a phone frame's screen may read from: footage/_screens/, which holds
 * only files the redaction step rendered (RedactedClip, then
 * video:privacy-check). Raw recordings live elsewhere in footage/, so a
 * phone screen pointed at one refuses to render.
 */
import type { ClipEntry } from "../redactions.ts";
import type { Take } from "../timeline.ts";

export const REDACTED_DIR = "_screens/";

export class RawFootageError extends Error {}

export function checkedScreenFile(file: string): string {
  if (!file.startsWith(REDACTED_DIR) || file.includes("..") || file.includes("\\")) {
    throw new RawFootageError(`a phone screen shows only redacted files in footage/${REDACTED_DIR}, not ${file}`);
  }
  return file;
}

/** The redacted file for one take at one speed, relative to footage/. */
export function screenFileFor(take: Take & { clip: string }, speed: number): string {
  const n = (v: number) => v.toFixed(2);
  const held = take.hold !== undefined ? `_h${n(take.hold)}` : "";
  return `${REDACTED_DIR}${take.clip}_${n(take.in)}_${n(take.out)}_x${n(speed)}${held}.mp4`;
}

/** The sidecar next to a screen file, written once its privacy check passes. */
export const stampFileFor = (screenFile: string) => screenFile.replace(/\.mp4$/, ".stamp.json");

/**
 * What a screen file was rendered from: the clip's whole redaction entry, the
 * take and the speed. A file whose stamp differs from today's (the map was
 * edited since) is stale and refuses to render until video:screens runs again.
 */
export function screenStamp(entry: ClipEntry, take: Take & { clip: string }, speed: number): string {
  return JSON.stringify({ entry, clip: take.clip, in: take.in, out: take.out, speed, ...(take.hold !== undefined ? { hold: take.hold } : {}) });
}
