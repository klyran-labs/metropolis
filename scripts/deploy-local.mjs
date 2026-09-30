import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fundAllWallets } from './fund-wallets.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, '..');

export async function deployLocalContracts(options = {}) {
  const rpcUrl = options.rpcUrl || process.env.RPC_URL || 'http://127.0.0.1:8545';
  const chainId = options.chainId || 10143;
  let deployerPrivateKey = options.deployerPrivateKey || process.env.DEPLOYER_PRIVATE_KEY;
  const envFilePath = options.envFilePath || process.env.ENV_FILE || join(rootDirectory, '.env.local');
  const customManifestPath = options.manifestPath || process.env.DEPLOYMENT_MANIFEST_PATH;

  if (!deployerPrivateKey) {
    const mnemonic = options.mnemonic || process.env.ANVIL_MNEMONIC;
    if (mnemonic) {
      const derived = mnemonicToAccount(mnemonic);
      deployerPrivateKey = `0x${Buffer.from(derived.getHdKey().privateKey).toString('hex')}`;
    }
  }

  if (!deployerPrivateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY or ANVIL_MNEMONIC is required for a local deployment');
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

  console.log(`Deploying local contracts to ${rpcUrl}`);
  console.log(`Deployer: ${account.address}`);

  const policyEngine = await deployContract('PolicyEngine');
  const reputationRegistry = await deployContract('ReputationRegistry');
  const agentWalletGuard = await deployContract('AgentWalletGuard', [
    policyEngine.address,
    reputationRegistry.address,
  ]);
  const settlementToken = await deployContract('LocalSettlementToken', [account.address]);
  const circuitVault = await deployContract('CircuitVault', [
    settlementToken.address,
    policyEngine.address,
  ]);
  const entryPointAddress = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
  const circuitPaymaster = await deployContract('CircuitPaymaster', [
    account.address,
    entryPointAddress,
    policyEngine.address,
  ]);
  const agentIdentityRegistry = await deployContract('AgentIdentityRegistry');
  const agentAccountImplementation = await deployContract('AgentAccount');
  const agentPassportNFT = await deployContract('AgentPassportNFT');
  const auditAnchorRegistry = await deployContract('AuditAnchorRegistry');

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

  const authorizeVault = await walletClient.writeContract({
    address: circuitVault.address,
    abi: circuitVault.abi,
    functionName: 'setAuthorizedCaller',
    args: [agentWalletGuard.address, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: authorizeVault });

  // Deposit initial gas into CircuitPaymaster
  const fundPaymaster = await walletClient.sendTransaction({
    to: circuitPaymaster.address,
    value: parseEther('10'),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundPaymaster });

  const deploymentDirectory = join(rootDirectory, 'deployments/local');
  mkdirSync(deploymentDirectory, { recursive: true });

  const contractsJsonPath = join(deploymentDirectory, 'contracts.json');
  const manifestJsonPath = customManifestPath || join(rootDirectory, 'deploy/environments/local/deployment-manifest.json');
  mkdirSync(dirname(manifestJsonPath), { recursive: true });

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
    circuitVault: { address: circuitVault.address },
    circuitPaymaster: { address: circuitPaymaster.address },
    agentIdentityRegistry: { address: agentIdentityRegistry.address },
    agentAccountImplementation: { address: agentAccountImplementation.address },
    agentPassportNFT: { address: agentPassportNFT.address },
    auditAnchorRegistry: { address: auditAnchorRegistry.address },
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
      CIRCUIT_VAULT_ADDRESS: circuitVault.address,
      CIRCUIT_PAYMASTER_ADDRESS: circuitPaymaster.address,
      VITE_POLICY_ENGINE_ADDRESS: policyEngine.address,
      VITE_REPUTATION_REGISTRY_ADDRESS: reputationRegistry.address,
      VITE_AGENT_WALLET_GUARD_ADDRESS: agentWalletGuard.address,
      VITE_USDC_TOKEN_ADDRESS: settlementToken.address,
      VITE_CIRCUIT_VAULT_ADDRESS: circuitVault.address,
      VITE_CIRCUIT_PAYMASTER_ADDRESS: circuitPaymaster.address,
      VITE_AGENT_IDENTITY_REGISTRY_ADDRESS: agentIdentityRegistry.address,
      VITE_AGENT_ACCOUNT_IMPLEMENTATION_ADDRESS: agentAccountImplementation.address,
      VITE_AGENT_PASSPORT_NFT_ADDRESS: agentPassportNFT.address,
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
  console.log(`CircuitVault: ${circuitVault.address}`);
  console.log(`CircuitPaymaster: ${circuitPaymaster.address}`);
  console.log(`AgentIdentityRegistry: ${agentIdentityRegistry.address}`);
  console.log(`AgentAccountImplementation: ${agentAccountImplementation.address}`);
  console.log(`AgentPassportNFT: ${agentPassportNFT.address}`);

  // Automatically fund devnet wallets and pre-seed active agent policies
  await fundAllWallets({
    rpcUrl,
    deployerPrivateKey,
    usdcAddress: settlementToken.address,
    walletGuardAddress: agentWalletGuard.address,
    policyEngineAddress: policyEngine.address,
    merchantAddress: account.address,
  });

  return {
    policyEngine: policyEngine.address,
    reputationRegistry: reputationRegistry.address,
    agentWalletGuard: agentWalletGuard.address,
    settlementToken: settlementToken.address,
    circuitVault: circuitVault.address,
    circuitPaymaster: circuitPaymaster.address,
    deployer: account.address,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  deployLocalContracts().catch((error) => {
    console.error('Local deployment failed:', error);
    process.exitCode = 1;
  });
}
