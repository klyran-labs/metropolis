import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fundAllWallets } from './fund-wallets.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, '..');
const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
const chainId = 10143;
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
const envFilePath = process.env.ENV_FILE || join(rootDirectory, '.env.local');

if (!deployerPrivateKey) {
  throw new Error('DEPLOYER_PRIVATE_KEY is required for a local deployment');
}

const account = privateKeyToAccount(deployerPrivateKey);
const chain = {
  id: chainId,
  name: 'Monad Local Devnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });

function loadArtifact(name) {
  const artifactPath = join(rootDirectory, `contracts/out/${name}.sol/${name}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function deployContract(name, args = []) {
  const artifact = loadArtifact(name);
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error(`${name} deployment did not return a contract address`);
  }
  return {
    address: receipt.contractAddress,
    abi: artifact.abi,
    blockNumber: receipt.blockNumber,
  };
}

async function main() {
  console.log(`Deploying local contracts to ${rpcUrl}`);
  console.log(`Deployer: ${account.address}`);

  const policyEngine = await deployContract('PolicyEngine');
  const reputationRegistry = await deployContract('ReputationRegistry');
  const agentWalletGuard = await deployContract('AgentWalletGuard', [
    policyEngine.address,
    reputationRegistry.address,
  ]);
  const settlementToken = await deployContract('LocalSettlementToken', [account.address]);

  const authorizePolicy = await walletClient.writeContract({
    address: policyEngine.address,
    abi: policyEngine.abi,
    functionName: 'setAuthorizedCaller',
    args: [agentWalletGuard.address, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: authorizePolicy });

  const authorizeReputation = await walletClient.writeContract({
    address: reputationRegistry.address,
    abi: reputationRegistry.abi,
    functionName: 'setReporter',
    args: [agentWalletGuard.address, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: authorizeReputation });

  const deploymentDirectory = join(rootDirectory, 'deployments/local');
  mkdirSync(deploymentDirectory, { recursive: true });

  const contractsJsonPath = join(deploymentDirectory, 'contracts.json');
  const manifestJsonPath = join(rootDirectory, 'deploy/environments/local/deployment-manifest.json');
  let existingContracts = {};
  if (existsSync(contractsJsonPath)) {
    try {
      const existing = JSON.parse(readFileSync(contractsJsonPath, 'utf8'));
      existingContracts = existing.contracts || {};
    } catch {}
  } else if (existsSync(manifestJsonPath)) {
    try {
      const existing = JSON.parse(readFileSync(manifestJsonPath, 'utf8'));
      existingContracts = existing.contracts || {};
    } catch {}
  }

  const mergedContracts = {
    ...existingContracts,
    policyEngine: { address: policyEngine.address },
    reputationRegistry: { address: reputationRegistry.address },
    agentWalletGuard: { address: agentWalletGuard.address },
    settlementToken: { address: settlementToken.address },
  };

  const deployment = {
    status: 'provisioned',
    environment: 'local',
    chainId,
    deployer: account.address,
    contracts: mergedContracts,
    deployBlock: Number(policyEngine.blockNumber),
  };

  writeFileSync(
    contractsJsonPath,
    JSON.stringify(deployment, null, 2) + '\n',
  );
  writeFileSync(
    manifestJsonPath,
    JSON.stringify(
      {
        environment: 'local',
        status: 'provisioned',
        version: '1.0.0',
        chainId,
        rpcEndpoints: [rpcUrl],
        contracts: mergedContracts,
      },
      null,
      2,
    ) + '\n',
  );

  if (existsSync(envFilePath)) {
    const values = {
      POLICY_ENGINE_ADDRESS: policyEngine.address,
      REPUTATION_REGISTRY_ADDRESS: reputationRegistry.address,
      AGENT_WALLET_GUARD_ADDRESS: agentWalletGuard.address,
      USDC_TOKEN_ADDRESS: settlementToken.address,
      VITE_POLICY_ENGINE_ADDRESS: policyEngine.address,
      VITE_REPUTATION_REGISTRY_ADDRESS: reputationRegistry.address,
      VITE_AGENT_WALLET_GUARD_ADDRESS: agentWalletGuard.address,
      VITE_USDC_TOKEN_ADDRESS: settlementToken.address,
    };
    let envContent = readFileSync(envFilePath, 'utf8');
    for (const [key, value] of Object.entries(values)) {
      const line = `${key}=${value}`;
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      envContent = pattern.test(envContent)
        ? envContent.replace(pattern, line)
        : `${envContent.trimEnd()}\n${line}\n`;
    }
    const merchantPattern = /^GATEWAY_MERCHANT_ADDRESS=.*$/m;
    if (merchantPattern.test(envContent) && /^GATEWAY_MERCHANT_ADDRESS=$/m.test(envContent)) {
      envContent = envContent.replace(merchantPattern, `GATEWAY_MERCHANT_ADDRESS=${account.address}`);
    }
    writeFileSync(envFilePath, envContent);
  }

  console.log(`PolicyEngine: ${policyEngine.address}`);
  console.log(`ReputationRegistry: ${reputationRegistry.address}`);
  console.log(`AgentWalletGuard: ${agentWalletGuard.address}`);
  console.log(`LocalSettlementToken: ${settlementToken.address}`);

  // Automatically fund devnet wallets and pre-seed active agent policies
  await fundAllWallets({
    rpcUrl,
    deployerPrivateKey,
    usdcAddress: settlementToken.address,
    walletGuardAddress: agentWalletGuard.address,
    policyEngineAddress: policyEngine.address,
    merchantAddress: account.address,
  });
}

main().catch((error) => {
  console.error('Local deployment failed:', error);
  process.exitCode = 1;
});
