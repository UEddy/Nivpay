/**
 * Trusted Types (vercel.json, require-trusted-types-for 'script'): the
 * browser refuses any script URL or HTML that didn't come through a named
 * policy. The app has exactly one: the service worker's own address. Nothing
 * else in the app writes HTML or script URLs, so a link or name that tried
 * to would be stopped by the browser as well as by React.
 */
export const SW_POLICY = "nivpay-sw";
export const SW_URL = "/sw.js";

type ScriptUrl = string | { toString(): string };
export type TrustedTypesLike = {
  createPolicy(name: string, rules: { createScriptURL: (url: string) => string }): { createScriptURL(url: string): ScriptUrl };
};

/** The service worker's address, through the policy where the browser has Trusted Types. Any other address is refused. */
export function serviceWorkerUrl(tt: TrustedTypesLike | undefined): ScriptUrl {
  if (!tt) return SW_URL;
  const policy = tt.createPolicy(SW_POLICY, {
    createScriptURL: (url) => {
      if (url !== SW_URL) throw new TypeError(`only ${SW_URL} may be a script address`);
      return url;
    },
  });
  return policy.createScriptURL(SW_URL);
}
