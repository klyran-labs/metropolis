import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./globals.css";
import { ThemeProvider } from "./context/ThemeContext";

// Keep authentication and the application shell out of the initial bootstrap
// chunk. This makes the public entrypoint fast while the authenticated console
// remains independently cacheable and route-split.
const App = React.lazy(() => import("./App"));
const PrivyAuthProvider = React.lazy(() => import("./components/PrivyAuthProvider"));

import { ConsoleSkeleton } from "./components/common/ConsoleSkeleton";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Failed to find the root element in index.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Suspense fallback={<ConsoleSkeleton isFullApp />}>
      <PrivyAuthProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </PrivyAuthProvider>
    </Suspense>
  </React.StrictMode>
);
