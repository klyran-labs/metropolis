/**
 * Contract ABI fragments used by the gateway. Copied verbatim from the
 * already-typechecked fragments in apps/web/src/config/contracts.ts (single
 * source of correctness — see docs/GAP_ANALYSIS.md §4 for the follow-up to
 * consolidate both into packages/shared-types once a package install step is
 * available to safely add `viem` as a shared-types dependency; see this
 * package's README for why that wasn't done opportunistically here).
 */
import { parseAbi } from 'viem';

export const POLICY_ENGINE_ABI = parseAbi([
  'function evaluate((address agent, address merchant, uint256 amount, bytes32 category, uint256 timestamp, uint256 deadline, uint256 nonce) req) external view returns ((bool allowed, uint256 allowedAmount, uint8 reasonCode, uint256 evaluatedAtTimestamp))',
  'function getAgentPolicy(address agent) external view returns ((uint128 maxPerTx, uint128 maxPerWindow, uint32 windowSeconds, uint32 maxVelocity, bool killSwitch, bool whitelistEnabled))',
  'function getAgentState(address agent) external view returns (uint128 spentInWindow, uint32 windowStart, uint32 txCountInWindow, uint64 nonce)',
]);

export const AGENT_WALLET_GUARD_ABI = parseAbi([
  'function executeGatedPayment((address agent, address merchant, uint256 amount, bytes32 category, uint256 timestamp, uint256 deadline, uint256 nonce) req, bytes signature, address token, bytes extraCallData) external payable returns (bool)',
]);
