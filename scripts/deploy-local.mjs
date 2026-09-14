import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, '..');
const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
const chainId = 10143;
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

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

  const deployment = {
    status: 'provisioned',
    environment: 'local',
    chainId,
    deployer: account.address,
    contracts: {
      policyEngine: { address: policyEngine.address },
      reputationRegistry: { address: reputationRegistry.address },
      agentWalletGuard: { address: agentWalletGuard.address },
    },
    deployBlock: Number(policyEngine.blockNumber),
  };

  writeFileSync(
    join(deploymentDirectory, 'contracts.json'),
    JSON.stringify(deployment, null, 2) + '\n',
  );
  writeFileSync(
    join(rootDirectory, 'deploy/environments/local/deployment-manifest.json'),
    JSON.stringify(
      {
        environment: 'local',
        status: 'provisioned',
        version: '1.0.0',
        chainId,
        rpcEndpoints: [rpcUrl],
        contracts: deployment.contracts,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`PolicyEngine: ${policyEngine.address}`);
  console.log(`ReputationRegistry: ${reputationRegistry.address}`);
  console.log(`AgentWalletGuard: ${agentWalletGuard.address}`);
}

main().catch((error) => {
  console.error('Local deployment failed:', error);
  process.exitCode = 1;
});
