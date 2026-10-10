/**
 * Loads a part of the app that loads on demand. If the file is gone, because
 * the page was opened before a deploy and the new build has other files,
 * the page reloads once onto the new build. A second failure in the same
 * minute is shown as the error it is, so a phone that is simply offline is
 * never stuck reloading.
 */
const KEY = "nivpay.reloadedForChunk";
const WITHIN_MS = 60_000;

export type ReloadDeps = { storage: Pick<Storage, "getItem" | "setItem">; reload: () => void; now: () => number; online: () => boolean };

const browser = (): ReloadDeps => ({ storage: sessionStorage, reload: () => location.reload(), now: () => Date.now(), online: () => navigator.onLine });

export function reloadOnce<T>(load: () => Promise<T>, deps: ReloadDeps = browser()): Promise<T> {
  return load().catch((error: unknown) => {
    const last = Number(deps.storage.getItem(KEY) ?? 0);
    if (!deps.online() || deps.now() - last < WITHIN_MS) throw error;
    deps.storage.setItem(KEY, String(deps.now()));
    deps.reload();
    // The page is going away; nothing should render the failure meanwhile.
    return new Promise<T>(() => {});
  });
}
