import type { Address } from "viem";

export type RuntimeProfile = "local" | "testnet" | "mainnet";

const read = (key: string, fallback = "") => {
  const value = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env?.[key];
  return value?.trim() || fallback;
};

const profile = read("VITE_APP_ENV", "local");
if (!(["local", "testnet", "mainnet"] as string[]).includes(profile)) {
  throw new Error("Unsupported runtime profile.");
}

const runtimeProfile = profile as RuntimeProfile;
const expectedChainId = runtimeProfile === "mainnet" ? 143 : 10143;
const chainId = Number(read("VITE_CHAIN_ID", String(expectedChainId)));
if (chainId !== expectedChainId)
  throw new Error("The configured network does not match the runtime profile.");

const address = (key: string): Address | null => {
  const value = read(key);
  return /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)
    ? (value as Address)
    : null;
};

export type AppTarget = "tenant" | "admin" | "unified";

const targetRaw = read("VITE_APP_TARGET", "unified");
const appTarget: AppTarget =
  targetRaw === "tenant" || targetRaw === "admin" ? targetRaw : "unified";

export const configuration = {
  brand: read("VITE_BRAND_NAME", "AgentGuard"),
  profile: runtimeProfile,
  appTarget,
  chainId,
  rpcUrl: read("VITE_RPC_URL"),
  apiBaseUrl: read("VITE_API_BASE_URL", "/api/v1"),
  privyAppId: read("VITE_PRIVY_APP_ID", "cmton65ao004l0cl11tgmwiah"),
    contracts: {
    policyEngine: address("VITE_POLICY_ENGINE_ADDRESS"),
    reputationRegistry: address("VITE_REPUTATION_REGISTRY_ADDRESS"),
    agentWalletGuard: address("VITE_AGENT_WALLET_GUARD_ADDRESS"),
    settlementToken: address("VITE_USDC_TOKEN_ADDRESS"),
    circuitVault: address("VITE_CIRCUIT_VAULT_ADDRESS"),
    circuitPaymaster: address("VITE_CIRCUIT_PAYMASTER_ADDRESS"),
    agentIdentityRegistry: address("VITE_AGENT_IDENTITY_REGISTRY_ADDRESS"),
    agentAccountImplementation: address("VITE_AGENT_ACCOUNT_IMPLEMENTATION_ADDRESS"),
    agentPassportNFT: address("VITE_AGENT_PASSPORT_NFT_ADDRESS"),
  },
} as const;

export const isTenantTarget = () => configuration.appTarget === "tenant";
export const isAdminTarget = () => configuration.appTarget === "admin";
export const isUnifiedTarget = () => configuration.appTarget === "unified";

export const networkLabel =
  runtimeProfile === "local"
    ? "Local network"
    : runtimeProfile === "testnet"
      ? "Testnet"
      : "Mainnet";
