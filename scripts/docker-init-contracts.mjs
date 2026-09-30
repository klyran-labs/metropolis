import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployLocalContracts } from './deploy-local.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, '..');
const rpcUrl = process.env.RPC_URL || process.env.MONAD_RPC_URL || 'http://monad-devnet:8545';
const manifestPath = process.env.DEPLOYMENT_MANIFEST_PATH || join(rootDirectory, 'deploy/environments/local/deployment-manifest.json');
const anvilMnemonic = process.env.ANVIL_MNEMONIC || 'puppy velvet canal sight dice present honey cruel version danger stable slim';

async function waitForRpc(url, maxAttempts = 30) {
  console.log(`[contracts-init] Probing Monad RPC readiness at ${url}...`);
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.result !== undefined) {
          console.log(`[contracts-init] RPC connection established (block: ${parseInt(data.result, 16)})`);
          return true;
        }
      }
    } catch {
      // Retrying
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function checkDeployedBytecode(url, address) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [address, 'latest'],
        id: 2,
      }),
    });
    const data = await res.json();
    return Boolean(data.result && data.result !== '0x' && data.result.length > 2);
  } catch {
    return false;
  }
}

async function main() {
  const isRpcReady = await waitForRpc(rpcUrl);
  if (!isRpcReady) {
    console.error(`[contracts-init] FATAL: RPC endpoint ${rpcUrl} did not respond within timeout.`);
    process.exit(1);
  }

  let isAlreadyDeployed = false;
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const policyEngineAddress = manifest.contracts?.policyEngine?.address;
      if (policyEngineAddress && policyEngineAddress !== '0x0000000000000000000000000000000000000000') {
        const hasCode = await checkDeployedBytecode(rpcUrl, policyEngineAddress);
        if (hasCode) {
          console.log(`[contracts-init] Verified active bytecode for PolicyEngine at ${policyEngineAddress}.`);
          isAlreadyDeployed = true;
        }
      }
    } catch (err) {
      console.warn(`[contracts-init] Manifest check exception (${err.message}). Proceeding with clean deployment.`);
    }
  }

  if (isAlreadyDeployed) {
    console.log('[contracts-init] Monad devnet ledger and contracts are healthy. Initialization complete.');
    process.exit(0);
  }

  console.log('[contracts-init] No deployed contracts found onchain. Commencing atomic devnet provisioning...');
  await deployLocalContracts({
    rpcUrl,
    mnemonic: anvilMnemonic,
    manifestPath,
  });

  console.log('[contracts-init] Devnet provisioning succeeded. System ready.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[contracts-init] Provisioning failed:', err);
  process.exit(1);
});
