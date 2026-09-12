import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import { ThemeProvider } from "./context/ThemeContext";

// Keep authentication and the application shell out of the initial bootstrap
// chunk. This makes the public entrypoint fast while the authenticated console
// remains independently cacheable and route-split.
const App = React.lazy(() => import("./App"));
const PrivyAuthProvider = React.lazy(() => import("./components/PrivyAuthProvider"));

const BootstrapFallback: React.FC = () => (
  <main aria-busy="true" className="min-h-screen bg-[#F3F5FA] p-6 dark:bg-[#0c1020]">
    <div className="mx-auto h-24 max-w-7xl animate-pulse rounded-[28px] bg-white/80 dark:bg-slate-800/80" />
  </main>
);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Failed to find the root element in index.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Suspense fallback={<BootstrapFallback />}>
      <PrivyAuthProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </PrivyAuthProvider>
    </Suspense>
  </React.StrictMode>
);
