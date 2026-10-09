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
import { App } from "./App.tsx";

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
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // An app that works without its offline shell is better than one that
      // breaks because of it.
    });
  });
}
