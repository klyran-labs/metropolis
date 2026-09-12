import { parseAbi } from 'viem';
import { APP_CONFIG } from './env';

export const MONAD_CHAIN_ID = APP_CONFIG.chainId;
export const MONAD_RPC_URL = APP_CONFIG.rpcUrl;
export const MONAD_EXPLORER_URL = 'https://testnet.monadexplorer.com';

// Deployed contract addresses on Monad Testnet (Chain ID 10143)
export const CONTRACT_ADDRESSES = {
  computeCLOB: APP_CONFIG.contracts.clobSettlement,
  computeToken: APP_CONFIG.contracts.computeToken,
  slaVault: APP_CONFIG.contracts.slaVault,
  usdcToken: APP_CONFIG.contracts.usdcToken,
};

export const COMPUTE_CLOB_ABI = parseAbi([
  'function depositEscrow() external payable',
  'function withdrawEscrow(uint256 amount) external',
  'function depositToken(address token, uint256 amount) external',
  'function withdrawToken(address token, uint256 amount) external',
  'function escrowBalances(address account) external view returns (uint256)',
  'function tokenEscrows(address account, address token) external view returns (uint256)',
  'function cancelOrder(uint256 nonce) external',
  'function protocolFeeBps() external view returns (uint256)',
  'function currentBatchSequenceId() external view returns (uint256)',
  'event EscrowDeposited(address indexed depositor, uint256 amount)',
  'event EscrowWithdrawn(address indexed withdrawer, uint256 amount)',
  'event TokenEscrowDeposited(address indexed account, address indexed token, uint256 amount)',
  'event TokenEscrowWithdrawn(address indexed account, address indexed token, uint256 amount)',
  'event OrderCancelled(address indexed maker, uint256 indexed nonce)',
  'event BatchSettled(uint256 indexed batchSequenceId, uint256 tradesCount)',
  'event TradeSettled(bytes32 indexed tradeHash, uint256 indexed tokenId, address indexed maker, address taker, uint256 executionPricePerSec, uint256 fillAmount, uint256 totalCost)',
]);

export const COMPUTE_TOKEN_ABI = parseAbi([
  'function balanceOf(address account, uint256 id) external view returns (uint256)',
  'function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) external view returns (uint256[] memory)',
  'function isApprovedForAll(address account, address operator) external view returns (bool)',
  'function uri(uint256 id) external view returns (string memory)',
]);

export const PARAMETRIC_SLA_VAULT_ABI = parseAbi([
  'function bondedStakes(uint256 instanceId) external view returns (uint256)',
  'function bondStake(uint256 instanceId) external payable',
  'function circuitBreakerPaused() external view returns (bool)',
  'event StakeBonded(uint256 indexed instanceId, address indexed provider, uint256 amount)',
  'event CollateralSlashed(uint256 indexed instanceId, address indexed aggrievedBuyer, uint256 refundAmount, uint256 keeperReward, uint256 burnAmount)',
]);

export const ERC20_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
]);

export const EIP712_DOMAIN = {
  name: 'ComputeX_CLOB',
  version: '1',
  chainId: MONAD_CHAIN_ID,
  verifyingContract: CONTRACT_ADDRESSES.computeCLOB,
} as const;

export const ORDER_TYPES = {
  Order: [
    { name: 'maker', type: 'address' },
    { name: 'isBid', type: 'bool' },
    { name: 'pricePerSec', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'ecdhPublicKey', type: 'bytes' },
  ],
} as const;
