import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatUnits,
  formatEther,
  isAddress,
  parseAbi,
} from 'viem';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, '..');
const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
const chainId = 10143;
const envFilePath = process.env.ENV_FILE || join(rootDirectory, '.env.local');

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
  'function mint(address to, uint256 amount) external',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function owner() external view returns (address)',
]);

const POLICY_ENGINE_ABI = parseAbi([
  'struct SpendPolicy { uint128 maxPerTx; uint128 maxPerWindow; uint32 windowSeconds; uint32 maxVelocity; bool killSwitch; bool whitelistEnabled; }',
  'function setPolicy(address agent, SpendPolicy calldata policy) external',
  'function setMerchantWhitelist(address agent, address merchant, bool allowed) external',
  'function isMerchantWhitelisted(address agent, address merchant) external view returns (bool)',
  'function getAgentPolicy(address agent) external view returns (SpendPolicy memory)',
]);

function readEnv(key, fallback = '') {
  if (process.env[key]) return process.env[key];
  if (existsSync(envFilePath)) {
    const content = readFileSync(envFilePath, 'utf8');
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (match?.[1]) return match[1].trim();
  }
  return fallback;
}

export async function fundAllWallets(customOptions = {}) {
  const activeRpcUrl = customOptions.rpcUrl || rpcUrl;
  const deployerKey = customOptions.deployerPrivateKey || readEnv('DEPLOYER_PRIVATE_KEY');
  const mnemonic = customOptions.mnemonic || readEnv('ANVIL_MNEMONIC');
  const usdcAddress = customOptions.usdcAddress || readEnv('USDC_TOKEN_ADDRESS');
  const walletGuardAddress = customOptions.walletGuardAddress || readEnv('AGENT_WALLET_GUARD_ADDRESS');
  const policyEngineAddress = customOptions.policyEngineAddress || readEnv('POLICY_ENGINE_ADDRESS');
  const merchantAddress = customOptions.merchantAddress || readEnv('GATEWAY_MERCHANT_ADDRESS');

  if (!deployerKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY is required to fund wallets');
  }

  const account = privateKeyToAccount(deployerKey);
  const chain = {
    id: chainId,
    name: 'Monad Local Devnet',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [activeRpcUrl] } },
  };
  const transport = http(activeRpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  console.log('\n======================================================');
  console.log('⚡ AgentGuard Automated Wallet Funding & Policy Seeder');
  console.log('======================================================');
  console.log(`RPC Endpoint: ${activeRpcUrl}`);
  console.log(`Deployer:     ${account.address}`);
  if (usdcAddress) console.log(`USDC Token:   ${usdcAddress}`);
  if (walletGuardAddress) console.log(`Wallet Guard: ${walletGuardAddress}`);
  if (policyEngineAddress) console.log(`PolicyEngine: ${policyEngineAddress}`);

  async function ensureNativeBalance(target, targetMon = '100') {
    try {
      const balance = await publicClient.getBalance({ address: target });
      const minWei = parseEther(targetMon);
      if (balance < minWei) {
        // Try anvil_setBalance first
        try {
          const hexWei = `0x${minWei.toString(16)}`;
          await transport.request({
            method: 'anvil_setBalance',
            params: [target, hexWei],
          });
        } catch {
          // Fallback to direct transfer from deployer
          const hash = await walletClient.sendTransaction({
            to: target,
            value: minWei - balance,
          });
          await publicClient.waitForTransactionReceipt({ hash });
        }
      }
    } catch (err) {
      console.warn(`Could not set native balance for ${target}: ${err.message}`);
    }
  }

  async function ensureTokenBalance(target, targetUsdc = '10000') {
    if (!usdcAddress || !isAddress(usdcAddress)) return;
    try {
      const targetUnits = parseUnits(targetUsdc, 6);
      const balance = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [target],
      });

      if (balance < targetUnits) {
        const topUp = targetUnits - balance;
        const hash = await walletClient.writeContract({
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: 'mint',
          args: [target, topUp],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
    } catch (err) {
      console.warn(`Could not mint tokens for ${target}: ${err.message}`);
    }
  }

  // 1. Ensure Deployer has funds
  console.log('\n[1/5] Funding Deployer...');
  await ensureNativeBalance(account.address, '500');
  await ensureTokenBalance(account.address, '1000000');
  const deployerMon = await publicClient.getBalance({ address: account.address });
  console.log(`  ✓ Deployer Native MON: ${formatEther(deployerMon)} MON`);

  // 2. Fund Anvil Accounts 1..9 if mnemonic is available
  if (mnemonic) {
    console.log('\n[2/5] Funding Anvil Derived Operator Accounts (1..9)...');
    for (let i = 1; i <= 9; i += 1) {
      const derived = mnemonicToAccount(mnemonic, { addressIndex: i });
      await ensureNativeBalance(derived.address, '100');
      await ensureTokenBalance(derived.address, '50000');
      console.log(`  ✓ Account #${i} (${derived.address}): 100 MON, 50,000 USDC`);
    }
  }

  // 3. Fund AgentWalletGuard Escrow Contract
  if (walletGuardAddress && isAddress(walletGuardAddress)) {
    console.log('\n[3/5] Funding AgentWalletGuard Settlement Escrow...');
    await ensureNativeBalance(walletGuardAddress, '50');
    await ensureTokenBalance(walletGuardAddress, '500000');
    console.log(`  ✓ Escrow (${walletGuardAddress}): 50 MON, 500,000 USDC funded`);
  }

  // 4. Fund Gateway Merchant
  if (merchantAddress && isAddress(merchantAddress)) {
    console.log('\n[4/5] Funding Gateway Merchant...');
    await ensureNativeBalance(merchantAddress, '50');
    await ensureTokenBalance(merchantAddress, '50000');
    console.log(`  ✓ Merchant (${merchantAddress}): 50 MON, 50,000 USDC funded`);
  }

  // 5. Pre-seed Standard Autonomous Agents with Policies
  if (mnemonic && policyEngineAddress && isAddress(policyEngineAddress)) {
    console.log('\n[5/5] Pre-provisioning Active Autonomous Agents with Onchain Policies...');
    const agentSeeds = [
      { index: 10, label: 'Apex Arbitrage Bot', maxPerTx: '50.00', maxPerWindow: '500.00', windowSec: 3600 },
      { index: 11, label: 'DeepSeek Research Assistant', maxPerTx: '25.00', maxPerWindow: '150.00', windowSec: 1800 },
      { index: 12, label: 'Sentinel Ingress Relay', maxPerTx: '10.00', maxPerWindow: '50.00', windowSec: 900 },
    ];

    for (const seed of agentSeeds) {
      const agentAccount = mnemonicToAccount(mnemonic, { addressIndex: seed.index });
      await ensureNativeBalance(agentAccount.address, '10');
      await ensureTokenBalance(agentAccount.address, '2500');

      const policyArgs = {
        maxPerTx: parseUnits(seed.maxPerTx, 6),
        maxPerWindow: parseUnits(seed.maxPerWindow, 6),
        windowSeconds: seed.windowSec,
        maxVelocity: 50,
        killSwitch: false,
        whitelistEnabled: Boolean(merchantAddress),
      };

      const setPolicyHash = await walletClient.writeContract({
        address: policyEngineAddress,
        abi: POLICY_ENGINE_ABI,
        functionName: 'setPolicy',
        args: [agentAccount.address, policyArgs],
      });
      await publicClient.waitForTransactionReceipt({ hash: setPolicyHash });

      if (merchantAddress && isAddress(merchantAddress)) {
        const whitelistHash = await walletClient.writeContract({
          address: policyEngineAddress,
          abi: POLICY_ENGINE_ABI,
          functionName: 'setMerchantWhitelist',
          args: [agentAccount.address, merchantAddress, true],
        });
        await publicClient.waitForTransactionReceipt({ hash: whitelistHash });
      }

      console.log(`  ✓ Agent ${seed.label} (${agentAccount.address})`);
      console.log(`    Limit: ${seed.maxPerTx} USDC/tx | ${seed.maxPerWindow} USDC/window | Merchant Whitelist: Active`);
    }
  }

  console.log('\n🎉 All local wallets and agents funded with onchain liquidity!');
  console.log('======================================================\n');
}

// Execute if run directly from CLI
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  fundAllWallets().catch((err) => {
    console.error('Wallet funding failed:', err);
    process.exit(1);
  });
}
