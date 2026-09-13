import { createWalletClient, createPublicClient, http, parseEther, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CHAIN_ID = 10143;

// Default prefunded anvil account #0
const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const account = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);

const transport = http(RPC_URL);
const publicClient = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: 'Monad Local Devnet',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport,
});

const walletClient = createWalletClient({
  account,
  chain: {
    id: CHAIN_ID,
    name: 'Monad Local Devnet',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport,
});

function loadArtifact(name) {
  const artifactPath = join(rootDir, `contracts/out/${name}.sol/${name}.json`);
  const raw = readFileSync(artifactPath, 'utf8');
  const json = JSON.parse(raw);
  return {
    abi: json.abi,
    bytecode: json.bytecode.object,
  };
}

async function deployContract(name, args = []) {
  const artifact = loadArtifact(name);
  console.log(`Deploying ${name}...`);
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✔ ${name} deployed at ${receipt.contractAddress} (block ${receipt.blockNumber})`);
  return { address: receipt.contractAddress, abi: artifact.abi, blockNumber: receipt.blockNumber };
}

async function main() {
  console.log('====================================================');
  console.log(` Deploying AgentGuard Contracts to ${RPC_URL}`);
  console.log(` Deployer: ${account.address}`);
  console.log('====================================================');

  // 1. Deploy PolicyEngine
  const policyEngine = await deployContract('PolicyEngine');

  // 2. Deploy ReputationRegistry (no constructor args)
  const reputationRegistry = await deployContract('ReputationRegistry');

  // 3. Deploy AgentWalletGuard (takes policyEngine, reputationRegistry)
  const treasuryAddress = account.address;
  const agentWalletGuard = await deployContract('AgentWalletGuard', [
    policyEngine.address,
    reputationRegistry.address,
  ]);

  // 4. Authorize AgentWalletGuard in PolicyEngine and ReputationRegistry
  console.log('Authorizing AgentWalletGuard in PolicyEngine and ReputationRegistry...');
  const authTx = await walletClient.writeContract({
    address: policyEngine.address,
    abi: policyEngine.abi,
    functionName: 'setAuthorizedCaller',
    args: [agentWalletGuard.address, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: authTx });

  const repAuthTx = await walletClient.writeContract({
    address: reputationRegistry.address,
    abi: reputationRegistry.abi,
    functionName: 'setReporter',
    args: [agentWalletGuard.address, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: repAuthTx });
  console.log('✔ AgentWalletGuard authorized as caller and reporter');

  // 5. Pre-create a shared Budget Pool
  console.log('Creating initial Budget Pool...');
  const poolId = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const orgId = '0x2222222222222222222222222222222222222222222222222222222222222222';
  const createPoolTx = await walletClient.writeContract({
    address: policyEngine.address,
    abi: policyEngine.abi,
    functionName: 'createBudgetPool',
    args: [poolId, orgId, parseEther('25.0'), 86400],
  });
  await publicClient.waitForTransactionReceipt({ hash: createPoolTx });
  console.log('✔ Initial Budget Pool created (25.0 MON capacity)');

  // 6. Pre-provision 20 Fleet Agents with onchain policies
  console.log('Registering 20 autonomous fleet agents onchain...');
  const AGENT_NAMES = [
    'Inference-Compute-Procure',
    'Firecrawl-Data-Scraper',
    'Model-Training-Cluster',
    'DeFi-Arbitrage-Engine',
    'Treasury-Rebalance-Bot',
    'GitHub-PR-Evaluator',
    'Code-Review-Agent',
    'API-Gateway-Settler',
    'Cloud-Instance-Bidding',
    'Vector-Index-Worker',
    'Sub-Graph-Indexer',
    'Synthetic-Data-Gen',
    'RPC-Node-Health-Guard',
    'Cross-Chain-Relayer',
    'AP2-Mandate-Signer',
    'x402-Merchant-Payer',
    'Rogue-Detector-Agent',
    'Risk-Auditor-Bot',
    'Invariant-Audit-Prover',
    'Emergency-Cutoff-Sentinel',
  ];

  const agentAddresses = [];
  const policies = [];

  for (let i = 0; i < 20; i++) {
    const rawHex = (0x1000 + i).toString(16).padStart(64, '0');
    const agentWallet = privateKeyToAccount(`0x${rawHex}`);
    agentAddresses.push(agentWallet.address);

    const maxPerTx = parseEther((0.2 + (i % 5) * 0.1).toFixed(2));
    const maxPerWindow = parseEther((2.0 + (i % 5) * 0.5).toFixed(2));
    const maxVelocity = 5 + (i % 6);

    policies.push({
      maxPerTx,
      maxPerWindow,
      windowSeconds: 3600,
      maxVelocity,
      killSwitch: i === 16, // One agent with emergency stop for demonstration
      whitelistEnabled: false,
    });
  }

  // Batch register policies on PolicyEngine
  const batchTx = await walletClient.writeContract({
    address: policyEngine.address,
    abi: policyEngine.abi,
    functionName: 'batchSetPolicies',
    args: [agentAddresses, policies],
  });
  await publicClient.waitForTransactionReceipt({ hash: batchTx });
  console.log(`✔ Batch set policies for ${agentAddresses.length} agents on PolicyEngine`);

  // Assign first 5 agents to the pool
  for (let i = 0; i < 5; i++) {
    const assignTx = await walletClient.writeContract({
      address: policyEngine.address,
      abi: policyEngine.abi,
      functionName: 'assignAgentToPool',
      args: [agentAddresses[i], poolId],
    });
    await publicClient.waitForTransactionReceipt({ hash: assignTx });
  }
  console.log('✔ Assigned 5 agents to shared budget pool');

  // Pre-fund AgentWalletGuard escrow and all 20 agent wallets with native MON
  console.log('Funding AgentWalletGuard escrow and 20 agent wallets with native MON...');
  const guardFundTx = await walletClient.sendTransaction({
    to: agentWalletGuard.address,
    value: parseEther('50.0'),
  });
  await publicClient.waitForTransactionReceipt({ hash: guardFundTx });
  console.log('✔ Funded AgentWalletGuard escrow with 50.0 MON');

  for (let i = 0; i < agentAddresses.length; i++) {
    const fundTx = await walletClient.sendTransaction({
      to: agentAddresses[i],
      value: parseEther('5.0'),
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTx });
  }
  console.log(`✔ Funded all ${agentAddresses.length} agent wallets with 5.0 MON each`);

  // 7. Write deployment artifact
  const deploymentInfo = {
    chainId: CHAIN_ID,
    policyEngine: policyEngine.address,
    reputationRegistry: reputationRegistry.address,
    agentWalletGuard: agentWalletGuard.address,
    usdcToken: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea',
    protocolTreasury: treasuryAddress,
    deployBlock: Number(policyEngine.blockNumber),
  };

  mkdirSync(join(rootDir, 'deployments/local'), { recursive: true });
  writeFileSync(
    join(rootDir, 'deployments/local/contracts.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );

  writeFileSync(
    join(rootDir, 'deployments/monad-testnet/contracts.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );

  const fleetManifest = agentAddresses.map((addr, idx) => ({
    name: AGENT_NAMES[idx] || `Agent-${idx + 1}`,
    address: addr,
    role: 'Autonomous Operational Agent',
  }));
  writeFileSync(
    join(rootDir, 'deployments/local/agents.json'),
    JSON.stringify(fleetManifest, null, 2)
  );
  writeFileSync(
    join(rootDir, 'deployments/monad-testnet/agents.json'),
    JSON.stringify(fleetManifest, null, 2)
  );

  console.log('====================================================');
  console.log(' Deployment Complete!');
  console.log(` PolicyEngine:        ${policyEngine.address}`);
  console.log(` ReputationRegistry:  ${reputationRegistry.address}`);
  console.log(` AgentWalletGuard:    ${agentWalletGuard.address}`);
  console.log(` Deploy Block:        ${policyEngine.blockNumber}`);
  console.log('====================================================');
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
