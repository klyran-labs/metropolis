import React from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import Application from "./application";
import { IdentityBridge, IdentityProvider } from "./identity";
import { applyTheme, getStoredTheme } from "./theme";

applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IdentityProvider>
      <IdentityBridge />
      <Application />
    </IdentityProvider>
  </React.StrictMode>,
);
