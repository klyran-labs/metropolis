/**
 * AgentGuard x402 Gateway — environment configuration.
 *
 * This replaces the previous docker/Dockerfile.gateway stub (a one-line inline
 * `http.createServer` that always returned 402 and never touched PolicyEngine,
 * signatures, or Monad at all — see docs/GAP_ANALYSIS.md, finding 1.4) with a
 * real, testable configuration surface.
 */

export interface GatewayConfig {
  port: number;
  chainId: number;
  rpcUrl: string;
  policyEngineAddress: `0x${string}`;
  reputationRegistryAddress: `0x${string}`;
  agentWalletGuardAddress: `0x${string}`;
  usdcTokenAddress: `0x${string}`;
  /** The merchant/payTo address this gateway paywalls its resources for. */
  merchantAddress: `0x${string}`;
  /**
   * Private key for the relayer account that submits `executeGatedPayment`
   * transactions on Monad. Intentionally optional: without it the gateway
   * still issues x402 challenges, verifies EIP-712 signatures, and simulates
   * policy decisions via `evaluate` (a free view call) — it only refuses (503)
   * at the final on-chain settlement step. This lets the gateway run safely
   * with no funds-moving credential configured, e.g. in a review/staging
   * environment, rather than needing a real private key just to boot.
   */
  relayerPrivateKey: `0x${string}` | null;
}

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

function requireAddress(env: NodeJS.ProcessEnv, key: string, fallback?: `0x${string}`): `0x${string}` {
  const value = env[key] ?? fallback;
  if (!value || !HEX_ADDRESS_RE.test(value)) {
    throw new Error(`AgentGuard Gateway: missing or invalid required address env var ${key}`);
  }
  return value as `0x${string}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const relayerKeyRaw = env.GATEWAY_RELAYER_PRIVATE_KEY;
  if (relayerKeyRaw && !HEX_KEY_RE.test(relayerKeyRaw)) {
    throw new Error('AgentGuard Gateway: GATEWAY_RELAYER_PRIVATE_KEY is set but is not a valid 32-byte hex key');
  }

  return {
    port: Number(env.PORT ?? 8080),
    chainId: Number(env.MONAD_CHAIN_ID ?? 10143),
    rpcUrl: env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz',
    policyEngineAddress: requireAddress(env, 'POLICY_ENGINE_ADDRESS'),
    reputationRegistryAddress: requireAddress(env, 'REPUTATION_REGISTRY_ADDRESS'),
    agentWalletGuardAddress: requireAddress(env, 'AGENT_WALLET_GUARD_ADDRESS'),
    usdcTokenAddress: requireAddress(env, 'USDC_TOKEN_ADDRESS'),
    merchantAddress: requireAddress(env, 'GATEWAY_MERCHANT_ADDRESS'),
    relayerPrivateKey: (relayerKeyRaw as `0x${string}` | undefined) ?? null,
  };
}
