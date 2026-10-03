import { mergeConfig } from "vite";
import path from "path";
import base from "./vite.config";

/**
 * Vite config used only by the Playwright suite. It swaps the third-party sign-in SDK for a stub
 * that reports an already-signed-in operator, so screens can be exercised without a real identity
 * provider. Nothing here is imported by, or shipped with, the application build.
 */
export default (env: { mode: string; command: "build" | "serve" }) =>
  mergeConfig(
    typeof base === "function" ? (base as (e: typeof env) => object)(env) : base,
    {
      resolve: {
        alias: {
          "@privy-io/react-auth": path.resolve(import.meta.dirname, "e2e/support/privy-stub.tsx"),
        },
      },
    },
  );
