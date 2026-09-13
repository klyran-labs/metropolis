import * as path from 'node:path';
import { EncryptedVault } from './vault.js';
import { OpenSignerEngine } from './signer.js';
import { createOpenSignerServer } from './server.js';

const PORT = parseInt(process.env.PORT || process.env.OPENSIGNER_PORT || '3001', 10);
const VAULT_PATH = process.env.OPENSIGNER_VAULT_PATH || path.resolve(process.cwd(), 'data/opensigner.vault.json');
const MASTER_KEY = process.env.OPENSIGNER_MASTER_KEY || 'agentguard-opensigner-default-local-enclave-secret-2026';

console.log('[OpenSigner] Initializing Sovereign Key Enclave...');
console.log(`[OpenSigner] Vault file: ${VAULT_PATH}`);
console.log(`[OpenSigner] Port: ${PORT}`);

const vault = new EncryptedVault(VAULT_PATH, MASTER_KEY);
const engine = new OpenSignerEngine(vault);
const server = createOpenSignerServer(vault, engine);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OpenSigner] Sovereign Key Enclave running on http://0.0.0.0:${PORT}`);
  console.log(`[OpenSigner] Active sealed wallets: ${vault.count()}`);
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
