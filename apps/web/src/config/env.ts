import type { Address } from "viem";

export type AppEnvironment = "local" | "testnet" | "staging" | "production" | "development" | "test";

export interface AppConfig {
  appEnv: AppEnvironment;
  isProduction: boolean;
  isDevelopment: boolean;
  chainId: number;
  rpcUrl: string;
  wsUrl: string;
  privyAppId: string;
  contracts: {
    clobSettlement: Address;
    slaVault: Address;
    computeToken: Address;
    usdcToken: Address;
  };
  oracleQuorum: {
    threshold: number;
    totalOracles: number;
  };
  strictZeroMock: true;
}

const rawEnv = (
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_APP_ENV) ||
  (typeof process !== "undefined" && process.env?.VITE_APP_ENV) ||
  "local"
).toLowerCase() as AppEnvironment;

const appEnv: AppEnvironment = ["local", "testnet", "staging", "production", "development", "test"].includes(rawEnv)
  ? rawEnv
  : "local";

const getEnvVar = (key: string, fallback: string): string => {
  if (typeof import.meta !== "undefined" && (import.meta as any).env && (import.meta as any).env[key]) {
    return (import.meta as any).env[key] as string;
  }
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  return fallback;
};

import monadTestnetContracts from '../../../../deployments/monad-testnet/contracts.json';
import monadTestnetChain from '../../../../deployments/monad-testnet/chain.json';

// Canonical defaults aligned with deployments/monad-testnet/ manifests
const DEFAULTS_BY_ENV: Record<string, { rpc: string; ws: string; clob: Address; sla: Address; token: Address; usdc?: Address }> = {
  local: {
    rpc: "http://127.0.0.1:8545",
    ws: "ws://127.0.0.1:9101/ws/v1/depth",
    clob: monadTestnetContracts.clobSettlement as Address,
    token: monadTestnetContracts.computeToken as Address,
    sla: monadTestnetContracts.slaVault as Address,
    usdc: monadTestnetContracts.usdcToken as Address,
  },
  development: {
    rpc: "http://127.0.0.1:8545",
    ws: "ws://127.0.0.1:9101/ws/v1/depth",
    clob: monadTestnetContracts.clobSettlement as Address,
    token: monadTestnetContracts.computeToken as Address,
    sla: monadTestnetContracts.slaVault as Address,
    usdc: monadTestnetContracts.usdcToken as Address,
  },
  test: {
    rpc: "http://127.0.0.1:8545",
    ws: "ws://127.0.0.1:9101/ws/v1/depth",
    clob: monadTestnetContracts.clobSettlement as Address,
    token: monadTestnetContracts.computeToken as Address,
    sla: monadTestnetContracts.slaVault as Address,
    usdc: monadTestnetContracts.usdcToken as Address,
  },
  testnet: {
    rpc: monadTestnetChain.rpcUrl,
    ws: `${monadTestnetChain.wsUrl}/depth`,
    clob: monadTestnetContracts.clobSettlement as Address,
    token: monadTestnetContracts.computeToken as Address,
    sla: monadTestnetContracts.slaVault as Address,
    usdc: monadTestnetContracts.usdcToken as Address,
  },
  staging: {
    rpc: "https://staging-rpc.monad.xyz",
    ws: "wss://staging-clob.computex.network/ws/v1/depth",
    clob: monadTestnetContracts.clobSettlement as Address,
    token: monadTestnetContracts.computeToken as Address,
    sla: monadTestnetContracts.slaVault as Address,
    usdc: monadTestnetContracts.usdcToken as Address,
  },
  production: {
    rpc: monadTestnetChain.rpcUrl,
    ws: "wss://clob.computex.network/ws/v1/depth",
    clob: monadTestnetContracts.clobSettlement as Address,
    token: monadTestnetContracts.computeToken as Address,
    sla: monadTestnetContracts.slaVault as Address,
    usdc: monadTestnetContracts.usdcToken as Address,
  },
};

const activeDefaults = DEFAULTS_BY_ENV[appEnv] || DEFAULTS_BY_ENV.local;
const isProduction = appEnv === "production";
const isDeployment = appEnv === "production" || appEnv === "staging";

const requireDeploymentEnv = (key: string, fallback: string): string => {
  const value = getEnvVar(key, "");
  if (isDeployment && !value) {
    throw new Error(`DeploymentConfigurationError: ${key} must be explicitly configured.`);
  }
  return value || fallback;
};

const clobSettlement = requireDeploymentEnv("VITE_CLOB_SETTLEMENT_ADDRESS", activeDefaults.clob) as Address;
const slaVault = requireDeploymentEnv("VITE_SLA_VAULT_ADDRESS", activeDefaults.sla) as Address;
const computeToken = requireDeploymentEnv("VITE_COMPUTE_TOKEN_ADDRESS", activeDefaults.token) as Address;
const usdcToken = requireDeploymentEnv("VITE_USDC_TOKEN_ADDRESS", activeDefaults.usdc || "") as Address;

if (isDeployment) {
  for (const [key, address] of [
    ["VITE_CLOB_SETTLEMENT_ADDRESS", clobSettlement],
    ["VITE_SLA_VAULT_ADDRESS", slaVault],
    ["VITE_COMPUTE_TOKEN_ADDRESS", computeToken],
    ["VITE_USDC_TOKEN_ADDRESS", usdcToken],
  ] as const) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || address === "0x0000000000000000000000000000000000000000") {
      throw new Error(`DeploymentConfigurationError: ${key} must be a valid non-zero contract address.`);
    }
  }
}

const chainId = Number(requireDeploymentEnv("VITE_CHAIN_ID", "10143"));
if (!Number.isSafeInteger(chainId) || chainId !== 10143) {
  throw new Error("DeploymentConfigurationError: VITE_CHAIN_ID must be Monad Testnet chain 10143.");
}

const privyAppId = requireDeploymentEnv("VITE_PRIVY_APP_ID", "");
if (isDeployment && !/^\S+$/.test(privyAppId)) {
  throw new Error("DeploymentConfigurationError: VITE_PRIVY_APP_ID must be configured.");
}

const rpcUrl = requireDeploymentEnv("VITE_RPC_URL", activeDefaults.rpc);
const wsUrl = requireDeploymentEnv("VITE_WS_URL", activeDefaults.ws);
if (isDeployment) {
  let rpcProtocol = "";
  let wsProtocol = "";
  try {
    rpcProtocol = new URL(rpcUrl).protocol;
    wsProtocol = new URL(wsUrl).protocol;
  } catch {
    throw new Error("DeploymentConfigurationError: VITE_RPC_URL and VITE_WS_URL must be valid absolute URLs.");
  }
  if (!['http:', 'https:'].includes(rpcProtocol)) {
    throw new Error("DeploymentConfigurationError: VITE_RPC_URL must use HTTP(S).");
  }
  if (!['ws:', 'wss:'].includes(wsProtocol)) {
    throw new Error("DeploymentConfigurationError: VITE_WS_URL must use WS(S).");
  }
}

export const APP_CONFIG: AppConfig = {
  appEnv,
  isProduction,
  isDevelopment: appEnv === "development" || appEnv === "local",
  chainId,
  rpcUrl,
  wsUrl,
  privyAppId,
  contracts: {
    clobSettlement,
    slaVault,
    computeToken,
    usdcToken,
  },
  oracleQuorum: {
    threshold: 3,
    totalOracles: 5,
  },
  strictZeroMock: true,
} as const;
