import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const RPC_URL = process.env.RPC_URL || process.env.MONAD_RPC_URL || 'http://127.0.0.1:8545';
const DEPLOYER_KEY =
  process.env.PRIVATE_KEY ||
  process.env.DEPLOYER_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const account = privateKeyToAccount(DEPLOYER_KEY);

const monadChain = {
  id: 10143,
  name: 'Monad Devnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const publicClient = createPublicClient({ chain: monadChain, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: monadChain, transport: http(RPC_URL) });

async function main() {
  console.log('====================================================');
  console.log(` Funding Agent Wallets on ${RPC_URL}`);
  console.log(` Funder: ${account.address}`);
  console.log('====================================================');

  const contractsPath = join(rootDir, 'deployments/local/contracts.json');
  const agentsPath = join(rootDir, 'deployments/local/agents.json');

  if (!existsSync(contractsPath) || !existsSync(agentsPath)) {
    console.error('Deployment files not found. Please run deploy script first.');
    process.exit(1);
  }

  const contracts = JSON.parse(readFileSync(contractsPath, 'utf8'));
  const agents = JSON.parse(readFileSync(agentsPath, 'utf8'));

  // Fund AgentWalletGuard escrow
  console.log(`Funding AgentWalletGuard escrow (${contracts.agentWalletGuard}) with 50.0 MON...`);
  try {
    const guardTx = await walletClient.sendTransaction({
      to: contracts.agentWalletGuard,
      value: parseEther('50.0'),
    });
    await publicClient.waitForTransactionReceipt({ hash: guardTx });
    console.log('✔ Funded AgentWalletGuard with 50.0 MON');
  } catch (err) {
    console.warn('Could not fund AgentWalletGuard:', err.message);
  }

  // Fund each agent with 5.0 MON
  console.log(`Funding ${agents.length} agent wallets with 5.0 MON each...`);
  for (const agent of agents) {
    try {
      const tx = await walletClient.sendTransaction({
        to: agent.address,
        value: parseEther('5.0'),
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`✔ Funded ${agent.name} (${agent.address.slice(0, 8)}…) with 5.0 MON`);
    } catch (err) {
      console.warn(`Failed to fund ${agent.address}:`, err.message);
    }
  }

  console.log('====================================================');
  console.log(' All agent wallets and escrow funded successfully!');
  console.log('====================================================');
}

main().catch((err) => {
  console.error('Funding script failed:', err);
  process.exit(1);
});
