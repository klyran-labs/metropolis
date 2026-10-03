import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import Application from "./application";
import { IdentityBridge, IdentityProvider } from "./identity";
import { applyTheme, getStoredTheme } from "./theme";

applyTheme(getStoredTheme());

// Auto-recover from stale dynamic chunk imports following production rebuilds/deployments
if (typeof window !== "undefined") {
  const triggerAutoReload = () => {
    const reloadKey = "ag_chunk_reload";
    const lastReload = sessionStorage.getItem(reloadKey);
    const now = Date.now();
    if (!lastReload || now - Number(lastReload) > 10000) {
      sessionStorage.setItem(reloadKey, String(now));
      window.location.reload();
    }
  };

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    triggerAutoReload();
  });

  window.addEventListener("error", (event) => {
    const msg = event?.message || "";
    if (
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Importing a module script failed")
    ) {
      triggerAutoReload();
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IdentityProvider>
      <IdentityBridge />
      <Application />
    </IdentityProvider>
  </React.StrictMode>,
);
