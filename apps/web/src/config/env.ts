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
    policyEngine: Address;
    reputationRegistry: Address;
    agentWalletGuard: Address;
    usdcToken: Address;
  };
  /**
   * Block PolicyEngine was deployed at, used to bound eth_getLogs scans when
   * discovering the agent roster / activity feed from onchain events instead
   * of scanning from genesis. Defaults to 0 (scan everything) when unset -
   * operators should set VITE_POLICY_ENGINE_DEPLOY_BLOCK once the contracts
   * are actually deployed, for query performance on a long-lived chain.
   */
  policyEngineDeployBlock: bigint;
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

import monadTestnetContracts from '@deployments/monad-testnet/contracts.json';
import monadTestnetChain from '@deployments/monad-testnet/chain.json';

const DEFAULTS_BY_ENV: Record<string, { rpc: string; ws: string; policyEngine: Address; reputationRegistry: Address; agentWalletGuard: Address; usdcToken: Address }> = {
  local: {
    rpc: "http://127.0.0.1:8545",
    ws: "ws://127.0.0.1:8545",
    policyEngine: monadTestnetContracts.policyEngine as Address,
    reputationRegistry: monadTestnetContracts.reputationRegistry as Address,
    agentWalletGuard: monadTestnetContracts.agentWalletGuard as Address,
    usdcToken: monadTestnetContracts.usdcToken as Address,
  },
  development: {
    rpc: "http://127.0.0.1:8545",
    ws: "ws://127.0.0.1:8545",
    policyEngine: monadTestnetContracts.policyEngine as Address,
    reputationRegistry: monadTestnetContracts.reputationRegistry as Address,
    agentWalletGuard: monadTestnetContracts.agentWalletGuard as Address,
    usdcToken: monadTestnetContracts.usdcToken as Address,
  },
  test: {
    rpc: "http://127.0.0.1:8545",
    ws: "ws://127.0.0.1:8545",
    policyEngine: monadTestnetContracts.policyEngine as Address,
    reputationRegistry: monadTestnetContracts.reputationRegistry as Address,
    agentWalletGuard: monadTestnetContracts.agentWalletGuard as Address,
    usdcToken: monadTestnetContracts.usdcToken as Address,
  },
  testnet: {
    rpc: monadTestnetChain.rpcUrl,
    ws: monadTestnetChain.wsUrl,
    policyEngine: monadTestnetContracts.policyEngine as Address,
    reputationRegistry: monadTestnetContracts.reputationRegistry as Address,
    agentWalletGuard: monadTestnetContracts.agentWalletGuard as Address,
    usdcToken: monadTestnetContracts.usdcToken as Address,
  },
  staging: {
    rpc: "https://staging-rpc.monad.xyz",
    ws: "wss://staging-rpc.monad.xyz",
    policyEngine: monadTestnetContracts.policyEngine as Address,
    reputationRegistry: monadTestnetContracts.reputationRegistry as Address,
    agentWalletGuard: monadTestnetContracts.agentWalletGuard as Address,
    usdcToken: monadTestnetContracts.usdcToken as Address,
  },
  production: {
    rpc: monadTestnetChain.rpcUrl,
    ws: monadTestnetChain.wsUrl,
    policyEngine: monadTestnetContracts.policyEngine as Address,
    reputationRegistry: monadTestnetContracts.reputationRegistry as Address,
    agentWalletGuard: monadTestnetContracts.agentWalletGuard as Address,
    usdcToken: monadTestnetContracts.usdcToken as Address,
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

const policyEngine = requireDeploymentEnv("VITE_POLICY_ENGINE_ADDRESS", activeDefaults.policyEngine) as Address;
const reputationRegistry = requireDeploymentEnv("VITE_REPUTATION_REGISTRY_ADDRESS", activeDefaults.reputationRegistry) as Address;
const agentWalletGuard = requireDeploymentEnv("VITE_AGENT_WALLET_GUARD_ADDRESS", activeDefaults.agentWalletGuard) as Address;
const usdcToken = requireDeploymentEnv("VITE_USDC_TOKEN_ADDRESS", activeDefaults.usdcToken) as Address;

if (isDeployment) {
  for (const [key, address] of [
    ["VITE_POLICY_ENGINE_ADDRESS", policyEngine],
    ["VITE_REPUTATION_REGISTRY_ADDRESS", reputationRegistry],
    ["VITE_AGENT_WALLET_GUARD_ADDRESS", agentWalletGuard],
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

const privyAppId = requireDeploymentEnv("VITE_PRIVY_APP_ID", "cmton65ao004l0cl11tgmwiah");
if (isDeployment && !/^\S+$/.test(privyAppId)) {
  throw new Error("DeploymentConfigurationError: VITE_PRIVY_APP_ID must be configured.");
}

const rpcUrl = requireDeploymentEnv("VITE_RPC_URL", activeDefaults.rpc);
const wsUrl = requireDeploymentEnv("VITE_WS_URL", activeDefaults.ws);

const rawDeployBlock = getEnvVar("VITE_POLICY_ENGINE_DEPLOY_BLOCK", "0");
let policyEngineDeployBlock: bigint;
try {
  policyEngineDeployBlock = BigInt(rawDeployBlock);
  if (policyEngineDeployBlock < 0n) throw new Error("negative");
} catch {
  throw new Error("DeploymentConfigurationError: VITE_POLICY_ENGINE_DEPLOY_BLOCK must be a non-negative integer.");
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
    policyEngine,
    reputationRegistry,
    agentWalletGuard,
    usdcToken,
  },
  policyEngineDeployBlock,
  strictZeroMock: true,
} as const;
