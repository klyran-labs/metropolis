import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isDeployment = env.VITE_APP_ENV === "production" || env.VITE_APP_ENV === "staging";
  if (isDeployment) {
    for (const key of ["VITE_CHAIN_ID", "VITE_RPC_URL", "VITE_WS_URL", "VITE_CLOB_SETTLEMENT_ADDRESS", "VITE_SLA_VAULT_ADDRESS", "VITE_COMPUTE_TOKEN_ADDRESS", "VITE_USDC_TOKEN_ADDRESS", "VITE_PRIVY_APP_ID"]) {
      if (!env[key]) throw new Error(`ProductionConfigurationError: ${key} must be explicitly configured.`);
    }
    for (const key of ["VITE_CLOB_SETTLEMENT_ADDRESS", "VITE_SLA_VAULT_ADDRESS", "VITE_COMPUTE_TOKEN_ADDRESS", "VITE_USDC_TOKEN_ADDRESS"]) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(env[key]) || /^0x0{40}$/i.test(env[key])) {
        throw new Error(`DeploymentConfigurationError: ${key} must be a valid non-zero contract address.`);
      }
    }
    if (Number(env.VITE_CHAIN_ID) !== 10143) {
      throw new Error("DeploymentConfigurationError: VITE_CHAIN_ID must be Monad Testnet chain 10143.");
    }
  }
  return {
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
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
      "/api/telemetry": {
        target: "http://localhost:9002",
        changeOrigin: true,
      },
      "/ws/v1": {
        target: "ws://localhost:9101",
        ws: true,
      },
    },
  },
  define: {
    "process.env": {
      NODE_ENV: JSON.stringify(env.NODE_ENV || mode),
      VITE_APP_ENV: JSON.stringify(env.VITE_APP_ENV || "local"),
      VITE_CHAIN_ID: JSON.stringify(env.VITE_CHAIN_ID),
      VITE_RPC_URL: JSON.stringify(env.VITE_RPC_URL),
      VITE_WS_URL: JSON.stringify(env.VITE_WS_URL),
      VITE_CLOB_SETTLEMENT_ADDRESS: JSON.stringify(env.VITE_CLOB_SETTLEMENT_ADDRESS),
      VITE_SLA_VAULT_ADDRESS: JSON.stringify(env.VITE_SLA_VAULT_ADDRESS),
      VITE_COMPUTE_TOKEN_ADDRESS: JSON.stringify(env.VITE_COMPUTE_TOKEN_ADDRESS),
      VITE_USDC_TOKEN_ADDRESS: JSON.stringify(env.VITE_USDC_TOKEN_ADDRESS),
      VITE_PRIVY_APP_ID: JSON.stringify(env.VITE_PRIVY_APP_ID),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      external: ["@stripe/stripe-js"],
    },
  },
  };
});
