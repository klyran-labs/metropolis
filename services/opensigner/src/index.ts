import * as path from 'node:path';
import { EncryptedVault } from './vault.js';
import { OpenSignerEngine } from './signer.js';
import { createOpenSignerServer } from './server.js';

const PORT = parseInt(process.env.PORT || process.env.OPENSIGNER_PORT || '3001', 10);
const VAULT_PATH = process.env.OPENSIGNER_VAULT_PATH || path.resolve(process.cwd(), 'data/opensigner.vault.json');
const MASTER_KEY = process.env.OPENSIGNER_MASTER_KEY;
const API_TOKEN = process.env.OPENSIGNER_API_TOKEN;
const RPC_URL = process.env.MONAD_RPC_URL;
const CHAIN_ID = parseInt(process.env.MONAD_CHAIN_ID || '10143', 10);
const ALLOWED_ORIGIN = process.env.OPENSIGNER_ALLOWED_ORIGIN || '';
const POLICY_ENGINE_ADDRESS = process.env.POLICY_ENGINE_ADDRESS as `0x${string}` | undefined;
const AGENT_WALLET_GUARD_ADDRESS = process.env.AGENT_WALLET_GUARD_ADDRESS as `0x${string}` | undefined;
const ALLOWED_TOKEN_ADDRESS = process.env.USDC_TOKEN_ADDRESS as `0x${string}` | undefined;

if (!MASTER_KEY || MASTER_KEY.length < 32) {
  throw new Error('OPENSIGNER_MASTER_KEY must be configured with at least 32 characters');
}
if (!API_TOKEN || API_TOKEN.length < 32) {
  throw new Error('OPENSIGNER_API_TOKEN must be configured with at least 32 characters');
}
if (RPC_URL && (!POLICY_ENGINE_ADDRESS || !AGENT_WALLET_GUARD_ADDRESS || !ALLOWED_TOKEN_ADDRESS)) {
  throw new Error('POLICY_ENGINE_ADDRESS, AGENT_WALLET_GUARD_ADDRESS, and USDC_TOKEN_ADDRESS are required when MONAD_RPC_URL is configured');
}

console.log('[OpenSigner] Initializing Sovereign Key Enclave...');
console.log(`[OpenSigner] Vault file: ${VAULT_PATH}`);
console.log(`[OpenSigner] Port: ${PORT}`);

const vault = new EncryptedVault(VAULT_PATH, MASTER_KEY);
const engine = new OpenSignerEngine(
  vault,
  RPC_URL && POLICY_ENGINE_ADDRESS && AGENT_WALLET_GUARD_ADDRESS && ALLOWED_TOKEN_ADDRESS
    ? {
        rpcUrl: RPC_URL,
        chainId: CHAIN_ID,
        policyEngineAddress: POLICY_ENGINE_ADDRESS,
        agentWalletGuardAddress: AGENT_WALLET_GUARD_ADDRESS,
        allowedTokenAddress: ALLOWED_TOKEN_ADDRESS,
      }
    : undefined,
);
const server = createOpenSignerServer(vault, engine, API_TOKEN, ALLOWED_ORIGIN);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OpenSigner] Sovereign Key Enclave running on http://0.0.0.0:${PORT}`);
  console.log(`[OpenSigner] Active sealed wallets: ${vault.count()}`);
  console.log(
    RPC_URL
      ? `[OpenSigner] Transaction submission enabled via ${RPC_URL} (chain ${CHAIN_ID})`
      : '[OpenSigner] MONAD_RPC_URL not set — chain-bound signing and transaction submission are disabled.',
  );
});

process.on('SIGTERM', () => {
  console.log('[OpenSigner] Shutting down gracefully...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[OpenSigner] Shutting down gracefully...');
  server.close(() => process.exit(0));
});

export { vault, engine, server };
