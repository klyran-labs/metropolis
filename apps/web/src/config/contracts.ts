import { parseAbi } from 'viem';
import { APP_CONFIG } from './env';

export const MONAD_CHAIN_ID = APP_CONFIG.chainId;
export const MONAD_RPC_URL = APP_CONFIG.rpcUrl;
export const MONAD_EXPLORER_URL = 'https://testnet.monadexplorer.com';

// Deployed AgentGuard contract addresses on Monad Testnet (Chain ID 10143)
export const CONTRACT_ADDRESSES = {
  policyEngine: APP_CONFIG.contracts.policyEngine,
  reputationRegistry: APP_CONFIG.contracts.reputationRegistry,
  agentWalletGuard: APP_CONFIG.contracts.agentWalletGuard,
  usdcToken: APP_CONFIG.contracts.usdcToken,
};

export const POLICY_ENGINE_ABI = parseAbi([
  'function setPolicy(address agent, (uint128 maxPerTx, uint128 maxPerWindow, uint32 windowSeconds, uint32 maxVelocity, bool killSwitch, bool whitelistEnabled) policy) external',
  'function setKillSwitch(address agent, bool active) external',
  'function setMerchantWhitelist(address agent, address merchant, bool allowed) external',
  'function evaluate((address agent, address merchant, uint256 amount, bytes32 category, uint256 timestamp, uint256 deadline, uint256 nonce) req) external view returns ((bool allowed, uint256 allowedAmount, uint8 reasonCode, uint256 evaluatedAtTimestamp))',
  'function evaluateAndSpend((address agent, address merchant, uint256 amount, bytes32 category, uint256 timestamp, uint256 deadline, uint256 nonce) req) external returns ((bool allowed, uint256 allowedAmount, uint8 reasonCode, uint256 evaluatedAtTimestamp))',
  'function getAgentPolicy(address agent) external view returns ((uint128 maxPerTx, uint128 maxPerWindow, uint32 windowSeconds, uint32 maxVelocity, bool killSwitch, bool whitelistEnabled))',
  'function getAgentState(address agent) external view returns (uint128 spentInWindow, uint32 windowStart, uint32 txCountInWindow, uint64 nonce)',
  'function isMerchantWhitelisted(address agent, address merchant) external view returns (bool)',
  'function isNonceUsed(address agent, uint256 nonce) external view returns (bool)',
  'event PolicySet(address indexed agent, uint128 maxPerTx, uint128 maxPerWindow, uint32 windowSeconds, uint32 maxVelocity, bool whitelistEnabled)',
  'event KillSwitchUpdated(address indexed agent, bool active)',
  'event MerchantWhitelistUpdated(address indexed agent, address indexed merchant, bool allowed)',
  'event SpendEvaluated(address indexed agent, address indexed merchant, uint256 amount, bool allowed, uint8 reasonCode)',
  'event SpendRecorded(address indexed agent, uint256 amount, uint128 totalSpentInWindow, uint32 txCountInWindow)',
]);

export const REPUTATION_REGISTRY_ABI = parseAbi([
  'function recordOutcome(address agent, address counterparty, uint8 outcome, uint256 amount) external',
  'function getMetrics(address agent) external view returns ((uint32 scoreBps, uint32 totalTransactions, uint32 settledCount, uint32 slashedCount, uint32 disputedCount, uint32 lastUpdatedTimestamp))',
  'function getScore(address agent) external view returns (uint32 scoreBps)',
  'function isTrusted(address agent, uint32 minScoreBps) external view returns (bool)',
  'event OutcomeRecorded(address indexed agent, address indexed counterparty, uint8 outcome, uint256 amount, uint32 newScoreBps)',
]);

export const AGENT_WALLET_GUARD_ABI = parseAbi([
  'function executeGatedPayment((address agent, address merchant, uint256 amount, bytes32 category, uint256 timestamp, uint256 deadline, uint256 nonce) req, bytes signature, address token, bytes extraCallData) external payable returns (bool)',
  'function getPolicyEngine() external view returns (address)',
  'function getReputationRegistry() external view returns (address)',
  'event PaymentExecuted(address indexed agent, address indexed merchant, uint256 amount, uint256 nonce, address token)',
  'event PaymentBlocked(address indexed agent, address indexed merchant, uint256 amount, uint256 nonce, uint8 reasonCode)',
]);

export const ERC20_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
]);

export const AGENTGUARD_EIP712_DOMAIN = {
  name: 'AgentGuard_PolicyEngine',
  version: '1',
  chainId: MONAD_CHAIN_ID,
  verifyingContract: CONTRACT_ADDRESSES.agentWalletGuard,
} as const;
