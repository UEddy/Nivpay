/**
 * Where a phone frame's screen may read from: footage/_screens/, which holds
 * only files the redaction step rendered (RedactedClip, then
 * video:privacy-check). Raw recordings live elsewhere in footage/, so a
 * phone screen pointed at one refuses to render.
 */
export const REDACTED_DIR = "_screens/";

export class RawFootageError extends Error {}

export function checkedScreenFile(file: string): string {
  if (!file.startsWith(REDACTED_DIR) || file.includes("..") || file.includes("\\")) {
    throw new RawFootageError(`a phone screen shows only redacted files in footage/${REDACTED_DIR}, not ${file}`);
  }
  return file;
}
