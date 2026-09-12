/**
 * AgentGuard Universal Shared Types & Domain Interfaces
 * Agentic Risk & Spend Control Layer for Monad Metropolis
 * Enforces Domain-Driven Design (DDD): Pure value objects, fixed-point representations,
 * machine-readable reason codes, and EIP-712 schemas for Monad Parallel EVM settlement.
 */

export type Address = `0x${string}`;
export type Hash = `0x${string}`;

/**
 * Standardized Machine-Readable Policy Reason Codes
 * Invariant: Every DENY onchain and offchain carries a non-zero reason code.
 */
export enum ReasonCode {
  ERR_NONE = 0,
  ERR_KILL_SWITCH = 1,
  ERR_MAX_PER_TX = 2,
  ERR_MAX_PER_WINDOW = 3,
  ERR_VELOCITY_EXCEEDED = 4,
  ERR_MERCHANT_NOT_ALLOWED = 5,
  ERR_BUDGET_DEPLETED = 6,
  ERR_EXPIRED = 7,
  ERR_NONCE_REUSED = 8,
  ERR_SIGNATURE_INVALID = 9,
}

export const REASON_CODE_MESSAGES: Record<ReasonCode, string> = {
  [ReasonCode.ERR_NONE]: 'Spend request permitted under current policy',
  [ReasonCode.ERR_KILL_SWITCH]: 'Execution halted: Instant kill switch active for agent',
  [ReasonCode.ERR_MAX_PER_TX]: 'Spend limit exceeded: Amount is above maxPerTx threshold',
  [ReasonCode.ERR_MAX_PER_WINDOW]: 'Window budget exhausted: Cumulative spend exceeds maxPerWindow limit',
  [ReasonCode.ERR_VELOCITY_EXCEEDED]: 'Rate limit tripped: Transaction count exceeds window velocity cap',
  [ReasonCode.ERR_MERCHANT_NOT_ALLOWED]: 'Counterparty blocked: Recipient is not in authorized merchant whitelist',
  [ReasonCode.ERR_BUDGET_DEPLETED]: 'Shared pool depleted: Org-wide budget allocation exhausted',
  [ReasonCode.ERR_EXPIRED]: 'Intent expired: Block timestamp exceeds request deadline',
  [ReasonCode.ERR_NONCE_REUSED]: 'Replay rejected: Spend request nonce has already been consumed',
  [ReasonCode.ERR_SIGNATURE_INVALID]: 'Authentication failed: Cryptographic EIP-712 signature invalid',
};

/**
 * Pure Domain Models: Policy, Request, Decision
 */
export interface SpendPolicy {
  agent: Address;
  maxPerTx: bigint;           // In base units (e.g. Wei / 6-dec USDC)
  maxPerWindow: bigint;       // Max cumulative spend in window
  windowSeconds: number;      // Sliding window duration (e.g. 3600 = 1 hour)
  maxVelocity: number;        // Maximum transaction count in window
  killSwitch: boolean;        // Instant O(1) revocation
  whitelistEnabled: boolean;  // Enforce merchant whitelist if true
}

export interface SpendRequest {
  agent: Address;
  merchant: Address;
  amount: bigint;
  category: `0x${string}`;    // bytes32 category tag (e.g. keccak256("AI_INFERENCE"))
  timestamp: bigint;
  deadline: bigint;
  nonce: bigint;
}

export type DecisionType = 'ALLOW' | 'DENY' | 'PARTIAL';

export interface PolicyDecision {
  decision: DecisionType;
  allowedAmount: bigint;
  reasonCode: ReasonCode;
  reasonMessage: string;
  evaluatedAtTimestamp: bigint;
}

/**
 * Monad-optimized disjoint agent state
 */
export interface AgentSpendState {
  spentInWindow: bigint;
  windowStart: bigint;
  txCountInWindow: number;
  nonce: bigint;
}

/**
 * Reputation and Outcome Tracking
 */
export enum ReputationOutcome {
  SETTLED = 0,
  DISPUTED = 1,
  SLASHED = 2,
  TIMEOUT = 3,
}

export interface ReputationRecord {
  agent: Address;
  counterparty: Address;
  outcome: ReputationOutcome;
  amount: bigint;
  timestamp: bigint;
  txHash: Hash;
}

export interface ReputationSummary {
  agent: Address;
  rollingScoreBps: number;    // 0 to 1,000,000 basis points (1,000,000 = 100.00% trust)
  totalTransactions: number;
  settledCount: number;
  slashedCount: number;
  lastUpdatedTimestamp: bigint;
}

/**
 * x402 Payment Protocol Adaptation
 */
export interface X402PaymentRequirement {
  payTo: Address;
  amount: string;             // Human readable decimal or Wei
  token: Address;             // 0x0 for native MON, or ERC-20 contract address
  chainId: number;            // 10143 for Monad Testnet
  serviceId: string;
  category: string;
  description: string;
}

export interface X402ChallengeResponse {
  statusCode: 402;
  headers: {
    'WWW-Authenticate': string;
    'X-402-Payment-Required': string;
  };
  body: {
    error: 'Payment Required';
    challenge: X402PaymentRequirement;
    supportedPolicies: string[];
  };
}

/**
 * Monad EIP-712 Domain Specification
 */
export const MONAD_TESTNET_CHAIN_ID = 10143;

export const AGENTGUARD_EIP712_DOMAIN = {
  name: 'AgentGuard_PolicyEngine',
  version: '1',
  chainId: MONAD_TESTNET_CHAIN_ID,
};

export const SPEND_REQUEST_TYPES = {
  SpendRequest: [
    { name: 'agent', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'category', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/**
 * Enterprise Agent Fleet Member for Control Plane
 */
export interface FleetAgent {
  id: string;
  name: string;
  address: Address;
  role: string;
  policy: SpendPolicy;
  state: AgentSpendState;
  /** Null when the registry has no recorded outcomes for this agent. */
  reputation: ReputationSummary | null;
  status: 'ACTIVE' | 'REVOKED' | 'RATE_LIMITED';
  recentEvaluations: PolicyDecision[];
}
