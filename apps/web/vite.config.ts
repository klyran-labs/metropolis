import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = path.resolve(import.meta.dirname || process.cwd());
  const env = { ...loadEnv(mode, process.cwd(), ""), ...loadEnv(mode, envDir, "") };
  const isDeployment = env.VITE_APP_ENV === "testnet" || env.VITE_APP_ENV === "mainnet";
  if (isDeployment) {
    for (const key of ["VITE_CHAIN_ID", "VITE_RPC_URL", "VITE_POLICY_ENGINE_ADDRESS", "VITE_REPUTATION_REGISTRY_ADDRESS", "VITE_AGENT_WALLET_GUARD_ADDRESS", "VITE_USDC_TOKEN_ADDRESS", "VITE_PRIVY_APP_ID"]) {
      if (!env[key]) throw new Error(`ProductionConfigurationError: ${key} must be explicitly configured.`);
    }
    for (const key of ["VITE_POLICY_ENGINE_ADDRESS", "VITE_REPUTATION_REGISTRY_ADDRESS", "VITE_AGENT_WALLET_GUARD_ADDRESS", "VITE_USDC_TOKEN_ADDRESS"]) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(env[key]) || /^0x0{40}$/i.test(env[key])) {
        throw new Error(`DeploymentConfigurationError: ${key} must be a valid non-zero contract address.`);
      }
    }
    const expectedChainId = env.VITE_APP_ENV === "mainnet" ? 143 : 10143;
    if (Number(env.VITE_CHAIN_ID) !== expectedChainId) {
      throw new Error(`DeploymentConfigurationError: VITE_CHAIN_ID must match ${env.VITE_APP_ENV}.`);
    }
  }
  const appTarget = env.VITE_APP_TARGET || process.env.VITE_APP_TARGET || "unified";
  const outDir = appTarget === "tenant" ? "dist/tenant" : appTarget === "admin" ? "dist/admin" : "dist";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
        "@deployments": path.resolve(import.meta.dirname, "../../deployments"),
        "@agentguard/x402-middleware": path.resolve(import.meta.dirname, "../../packages/x402-middleware/src/index.ts"),
        "@agentguard/shared-types": path.resolve(import.meta.dirname, "../../packages/shared-types/src/index.ts"),
      },
    },
    server: {
      port: 3110,
      host: true,
      proxy: {
        "/api/v1": {
          target: "http://localhost:8080",
          changeOrigin: true,
        },
      },
    },
    define: {
      "process.env": {
        NODE_ENV: JSON.stringify(env.NODE_ENV || mode),
        VITE_APP_ENV: JSON.stringify(env.VITE_APP_ENV || "local"),
        VITE_APP_TARGET: JSON.stringify(appTarget),
        VITE_CHAIN_ID: JSON.stringify(env.VITE_CHAIN_ID),
        VITE_RPC_URL: JSON.stringify(env.VITE_RPC_URL),
        VITE_WS_URL: JSON.stringify(env.VITE_WS_URL),
        VITE_POLICY_ENGINE_ADDRESS: JSON.stringify(env.VITE_POLICY_ENGINE_ADDRESS),
        VITE_REPUTATION_REGISTRY_ADDRESS: JSON.stringify(env.VITE_REPUTATION_REGISTRY_ADDRESS),
        VITE_AGENT_WALLET_GUARD_ADDRESS: JSON.stringify(env.VITE_AGENT_WALLET_GUARD_ADDRESS),
        VITE_USDC_TOKEN_ADDRESS: JSON.stringify(env.VITE_USDC_TOKEN_ADDRESS),
        VITE_PRIVY_APP_ID: JSON.stringify(env.VITE_PRIVY_APP_ID),
      },
    },
    build: {
      outDir,
      sourcemap: false,
      emptyOutDir: true,
      // Privy's supported ESM entry is a shared 539 KB minified vendor module
      // (~156 KB gzip). Keep the warning budget just above that measured,
      // unavoidable entry while chart and application chunks remain below 500 KB.
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        external: ["@stripe/stripe-js"],
        output: {
          manualChunks(moduleId) {
            if (moduleId.includes("/node_modules/echarts/")) {
              if (moduleId.includes("/echarts/charts") || moduleId.includes("/echarts/lib/chart/")) return "charts-series";
              if (moduleId.includes("/echarts/components") || moduleId.includes("/echarts/lib/component/")) return "charts-components";
              if (moduleId.includes("/echarts/renderers") || moduleId.includes("/echarts/lib/renderer/")) return "charts-renderer";
              return "charts-core";
            }
            // Stable vendor chunks: app code changes every deploy, these rarely do, so browsers
            // keep them cached across releases.
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(moduleId)) return "vendor-react";
            if (moduleId.includes("/node_modules/@tanstack/")) return "vendor-tanstack";
            return undefined;
          },
        },
      },
    },
  };
});
