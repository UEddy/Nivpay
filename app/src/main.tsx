import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts, bundled by Vite. Nothing is fetched from Google.
import "@fontsource/besley/600.css";
import "@fontsource/besley/400-italic.css";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/500.css";
import "@fontsource/work-sans/600.css";
import "./styles.css";
import "./pot.css";
import { startLanguage } from "./i18n/start.ts";
// Listens for the browser's install offer from the very start: it can come
// before the language and the screens have loaded (lib/install.ts).
import "./lib/install.ts";
import { serviceWorkerUrl, type TrustedTypesLike } from "./lib/trusted.ts";

// The language first, then the app: every screen reads the words and the
// number and date formats of the language chosen here (i18n/start.ts).
await startLanguage();
const { App } = await import("./App.tsx");
// Each of this phone's writes, once final, is told to /api/notify (lib/notify.ts).
const [{ onFinal }, { notifyTx }, { DEPLOYMENT }] = await Promise.all([import("./lib/receipts.ts"), import("./lib/notify.ts"), import("./lib/deployment.ts")]);
onFinal((tx) => void notifyTx(DEPLOYMENT, tx));

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker only in production builds, so development always sees
// fresh files.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const tt = (window as unknown as { trustedTypes?: TrustedTypesLike }).trustedTypes;
    // register() takes a TrustedScriptURL; the cast is only for TypeScript's older signature.
    navigator.serviceWorker.register(serviceWorkerUrl(tt) as string, { scope: "/" }).catch(() => {
      // An app that works without its offline shell is better than one that
      // breaks because of it.
    });
  });
}
