# ADR 0013: Monad Parallel Epoch Clearing & Split-State Dispute Resolution Architecture

## Status
**Implemented** (Supersedes Monad Metropolis target — fully deployed)

## Context
In high-throughput autonomous machine commerce, AI agents interact continuously with APIs, compute clusters, and data providers using HTTP 402 micro-vouchers. 

However, implementing high-frequency clearing on Monad Parallel EVM reveals four fundamental systems hazards:
1. **Parallel Write-Write Storage Collisions**: If 500 agents allocate credit to the same provider (e.g. Anthropic) in the same block, writing to a single shared provider slot causes transaction aborts and serializes execution.
2. **Merchant Dispute Lockout Attacks**: If dispute states are written to shared keys, a malicious agent can spam transactions to cause write-conflicts on the merchant's voucher submission, running down the dispute clock to steal compute.
3. **ERC-20 Allowance & Relayer Contention**: Real-time ERC-20 `transfer` calls to compensate gas relayers cause write collisions on `balances[relayer]` across concurrent agent transactions.
4. **Capital Inefficiency (Float Lockup)**: Pre-allocating credit to providers can freeze unspent enterprise capital indefinitely if the provider goes offline or refuses to sign session closures.

## Decision

We implement **`CircuitVault.sol`**, a production clearing kernel architected specifically for Monad Parallel EVM execution physics:

### 1. Double-Partitioned Agent-Anchored Storage Slots
All allocations are anchored strictly by the `agent` address:
```solidity
mapping(address agent => mapping(address provider => mapping(uint256 epoch => EpochBucket))) public agentEpochAllocation;
```
* **Concurrency Guarantee**: Storage keys resolve to `keccak256(agent, provider, epoch)`. Because keys are partitioned by `agent`, 500 parallel transactions allocating to the same merchant write to completely orthogonal storage slots in MonadDB with zero execution aborts.

### 2. Split-State Challenge Protocol
Dispute resolution storage is split into two independent, non-conflicting keys:
* **Agent Challenge Slot**: `mapping(address agent => mapping(bytes32 sessionId => UnilateralChallenge)) public agentChallenges;`
* **Merchant Settlement Slot**: `mapping(address provider => mapping(bytes32 sessionId => uint256)) public merchantSettlements;`
* **Zero Contention**: When an agent requests a unilateral close (`requestUnilateralClose`), it writes to its own slot. The merchant submits its highest signed voucher (`submitMerchantVoucher`) writing strictly to its provider slot. The agent cannot spam the merchant's slot to block voucher inclusion.
* **Resolution**: `finalizeUnilateralClose()` executes a read-only comparison across both slots after the 200-block challenge window expires.

### 3. Monotonic Spend Floors & Dual-Settlement Primitives
We strictly disentangle streaming settlements from explicit session teardowns:
* **`settleVoucherDelta`**: Incremental streaming settlement. The merchant claims earned delta (`cumulativeSpent - cumulativeSettled`). The allocation cap remains open; unspent float stays in the bucket.
* **`terminalClose`**: Explicit session teardown. The merchant claims final delta, the bucket is marked `isClosed = true`, and the remaining unspent float is returned to the enterprise treasury in the same transaction.

### 4. Cancun Transient Storage (`tstore`/`tload`) Reentrancy Lock
We eliminate persistent disk writes for execution locks using EVM Cancun/Prague Transient Storage (EIP-1153):
```solidity
modifier nonReentrantTransient() {
    assembly {
        if tload(0) {
            mstore(0x00, 0x3ee5aeb5) // ReentrancyGuardReentrantCall()
            revert(0x1c, 0x04)
        }
        tstore(0, 1)
    }
    _;
    assembly {
        tstore(0, 0)
    }
}
```

### 5. Sharded Lazy-Settled Relayer Compensation
To prevent write-write collisions on `balances[relayer]` in external ERC-20 contracts:
* Gas reimbursements accrue internally: `relayerGasCredits[relayer][shardId] += gasFeeUsdc;`.
* Relayers claim accumulated payouts off-path in single aggregated batch withdrawals.

### 6. Balance-Delta Treasury Custody & Solvency Invariant
* `deposit()` enforces balance-delta tracking (`token.balanceOf(this) - balanceBefore`) to protect against fee-on-transfer and rebasing token insolvency.
* `requestWithdrawal()` and `finalizeWithdrawal()` enforce a 30-minute unbonding cooldown and require zero active pending unbonding to prevent timelock reset griefing.

## Consequences

### Positive
* **Zero Parallel State Aborts**: Eliminates all write-write contention across concurrent agents, merchant dispute submissions, and relayer reimbursements.
* **Eliminates Hostage Attacks**: Unilateral challenge window guarantees enterprise float recovery even if external merchants go offline.
* **Audit-Ready Solvency**: Guarantees `totalDeposited >= allocatedBuckets + claimableRelayerCredits + pendingWithdrawals`.
