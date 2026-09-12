/**
 * ComputeX Universal Shared Types & Domain Interfaces
 * Enforces DDD standards: Pure value objects, fixed-point representations, and EIP-712 schemas.
 */

export type Address = `0x${string}`;
export type Hash = `0x${string}`;

export type OrderSide = 'BID' | 'ASK';

export interface ComputeOrder {
  maker: Address;
  isBid: boolean;
  pricePerSec: bigint;
  amount: bigint;
  nonce: bigint;
  expiry: bigint;
  tokenId: bigint;
  ecdhPublicKey: `0x${string}`;
}

export interface ExecutionMatchPayload {
  matchId: number;
  makerId: number;
  takerId: number;
  maker: Address;
  taker: Address;
  tokenId: number;
  executionPricePerSec: bigint;
  fillAmountSec: bigint;
  totalCostWei: bigint;
  timestampNs: number;
}

export interface L2BookLevel {
  price: number;
  amountHours: number;
  orderCount: number;
}

export interface L2DepthSnapshot {
  tokenId: number;
  timestampNs: number;
  bids: L2BookLevel[];
  asks: L2BookLevel[];
}

export interface NodeTelemetryReport {
  instanceId: number;
  timestamp: number;
  gpuUtilizationPct: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  temperatureC: number;
  pcieTxMbps: number;
  pcieRxMbps: number;
  pingLatencyMs: number;
  uptimePpm: number;
}

export interface SLAPolicyRecord {
  instanceId: number;
  provider: Address;
  buyer: Address;
  bondedStakeWei: bigint;
  minUptimePpm: number;
  maxLatencyMs: number;
  active: boolean;
}

export interface SlashAttestationPayload {
  instanceId: bigint;
  actualUptimePpm: number;
  actualLatencyMs: number;
  deadlineBlock: bigint;
  nonce: bigint;
}

export interface ThresholdProofPayload {
  attestation: SlashAttestationPayload;
  signatures: Hash[];
  oracleAddresses: Address[];
}

export interface DecryptedCredentialConfig {
  orderId: number;
  tokenId: number;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  wireguardConfig: string;
  dockerEndpoint?: string;
}

export const MONAD_TESTNET_CHAIN_ID = 10143;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Canonical Settlement Lifecycle State Machine
 * Draft -> WalletAuthorized -> FundsLocked -> Matched -> SettlementSubmitted
 *   -> SettlementConfirmed -> CapacityProvisioning -> CapacityActive
 *   -> Completed -> Reconciled
 * ═══════════════════════════════════════════════════════════════════════
 */
export type CanonicalSettlementState =
  | 'Draft'
  | 'WalletAuthorized'
  | 'FundsLocked'
  | 'Matched'
  | 'SettlementSubmitted'
  | 'SettlementConfirmed'
  | 'CapacityProvisioning'
  | 'CapacityActive'
  | 'Completed'
  | 'Reconciled'
  | 'Failed';

export interface SettlementTransitionEvent {
  eventId: string;
  orderId: number | string;
  actor: Address | string;
  timestamp: number;
  txHash?: Hash | string;
  previousState: CanonicalSettlementState;
  newState: CanonicalSettlementState;
  idempotencyKey: string;
  failureReason?: string;
}

export const CANONICAL_SETTLEMENT_ORDER: readonly CanonicalSettlementState[] = [
  'Draft',
  'WalletAuthorized',
  'FundsLocked',
  'Matched',
  'SettlementSubmitted',
  'SettlementConfirmed',
  'CapacityProvisioning',
  'CapacityActive',
  'Completed',
  'Reconciled',
] as const;

export function isValidSettlementTransition(
  from: CanonicalSettlementState,
  to: CanonicalSettlementState
): boolean {
  if (to === 'Failed') return true;
  const validTransitions: Record<CanonicalSettlementState, CanonicalSettlementState[]> = {
    Draft: ['WalletAuthorized', 'Failed'],
    WalletAuthorized: ['FundsLocked', 'Failed'],
    FundsLocked: ['Matched', 'Failed'],
    Matched: ['SettlementSubmitted', 'Failed'],
    SettlementSubmitted: ['SettlementConfirmed', 'Failed'],
    SettlementConfirmed: ['CapacityProvisioning', 'Failed'],
    CapacityProvisioning: ['CapacityActive', 'Failed'],
    CapacityActive: ['Completed', 'Failed'],
    Completed: ['Reconciled', 'Failed'],
    Reconciled: [],
    Failed: ['Draft'],
  };
  return (validTransitions[from] || []).includes(to);
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Enterprise Product Terminology Dictionary
 * Replaces raw Web3/crypto protocol terms with institutional enterprise terms
 * ═══════════════════════════════════════════════════════════════════════
 */
export const ENTERPRISE_TERMINOLOGY = {
  CLOB: 'Capacity Marketplace',
  LIVE_CLOB_DEPTH: 'Available Capacity',
  BID: 'Purchase Order',
  ASK: 'Capacity Listing',
  MAKER_ORDER: 'Signed Purchase/Listing Authorization',
  COMPUTE_TOKEN: 'Capacity Entitlement',
  ESCROW: 'Protected Trading Balance',
  INSTANCE: 'Capacity Allocation',
  NODE_OPERATOR: 'Compute Provider',
  NODE: 'Compute Host / Provider Fleet',
  BONDED_STAKE: 'SLA Collateral',
  SLASHING: 'SLA Collateral Adjustment',
  ORACLE: 'Independent Health Verifier',
  CLOB_ONLINE: 'Marketplace Connected',
  ORACLE_CONNECTING: 'Health Data Unavailable',
  FINALITY_400MS: 'Network Confirmation Target (400ms)',
  EIP712_SIGNATURE: 'Wallet Authorization',
} as const;
