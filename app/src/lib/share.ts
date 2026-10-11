export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * Shares a link through the phone's share sheet, or copies it where there is
 * none. Says which happened, so the screen can tell people.
 */
export async function shareLink(url: string, text: string): Promise<ShareResult> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text, url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  return copyLink(url);
}

/**
 * Copies a link without opening the share sheet, so nothing else on the
 * phone (contacts, recent chats) comes up. Every screen with Share offers it.
 */
export async function copyLink(url: string): Promise<"copied" | "failed"> {
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
