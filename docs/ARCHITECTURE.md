# AgentGuard Architecture & System Design Blueprint

> Rendered C4 diagrams (system context, containers, components, deployment) live in [`ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md); the ASCII art below is kept for a quick terminal-readable overview.

## 1. Executive Summary & Core Principles

**AgentGuard** is a programmable risk management, spend control, and reputation layer designed for autonomous AI agents executing payments on the **Monad Parallel EVM** (Chain ID `10143`, 400ms block time, 800ms deterministic finality). It natively bridges HTTP 402 agentic payment frameworks (such as x402 and Google AP2) with onchain deterministic risk policies.

AgentGuard is governed by four core architectural mandates:

1. **Strict Zero-Mock Mandate**: All fleet states, window spends, reputation metrics, and risk decisions derive from onchain contract calls or authentic EIP-712 cryptographic proofs.
2. **Disjoint Per-Agent State Partitioning**: To eliminate Monad parallel EVM worker abort loops under optimistic concurrency control (OCC), each agent's execution state is packed into a single disjoint 32-byte storage slot (`PackedState`). Concurrent payments by different agents never touch overlapping storage keys.
3. **Instant $O(1)$ Short-Circuit Kill Switch**: When an agent is compromised or trips safety thresholds, an administrator or authorized automated watcher sets `killSwitch = true`. All subsequent transactions by that agent abort in $O(1)$ time with typed `ReasonCode.KILL_SWITCH_ACTIVE` before running loop or arithmetic checks.
4. **Non-Custodial Delivery vs. Payment (DvP)**: Agent treasury funds remain non-custodial in smart contracts. Payments clear atomically only if pre-transaction risk conditions, rolling velocity limits, and recipient whitelists are satisfied.

---

## 2. Bounded Context Topography

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       AgentGuard Enterprise Topography                                     │
│                                                                                                         │
│  ┌─────────────────────────────────┐   HTTP 402 Challenge/Response    ┌──────────────────────────────┐  │
│  │   Autonomous Agent Client       │◄────────────────────────────────►│   AgentGuard x402 / AP2 Gateway │  │
│  │   • LLM / ReAct / Tool Runner   │   PAYMENT-REQUIRED (x402)        │   • EIP-712 Signer Recovery  │  │
│  │   • Private Key in HSM / KMS    │   EIP-712 SpendRequest           │   • Pre-flight Policy Sim    │  │
│  │   • Signs Typed SpendRequests   │                                  │   • Forward to Monad RPC     │  │
│  └────────────────┬────────────────┘                                  └──────────────┬───────────────┘  │
│                   │                                                                  │                  │
│                   │                                                                  │ Gated Execution  │
│                   ▼                                                                  ▼                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                           Monad Parallel EVM Smart Contracts (Chain 10143)                        │  │
│  │                                                                                                   │  │
│  │  ┌──────────────────────────────┐  evaluate()   ┌──────────────────────────────┐                  │  │
│  │  │   AgentWalletGuard.sol       │──────────────►│   PolicyEngine.sol           │                  │  │
│  │  │   • EIP-712 Signature Verify │               │   • PackedState (1 SLOAD)    │                  │  │
│  │  │   • Nonce Protection         │◄──────────────│   • Rolling Window Velocity  │                  │  │
│  │  │   • Atomic Token Settlement  │ ReasonCode    │   • O(1) Kill Switch         │                  │  │
│  │  └──────────────┬───────────────┘               └──────────────────────────────┘                  │  │
│  │                 │                                                                                 │  │
│  │                 │ recordOutcome()                                                                 │  │
│  │                 ▼                                                                                 │  │
│  │  ┌──────────────────────────────┐                                                                 │  │
│  │  │   ReputationRegistry.sol     │                                                                 │  │
│  │  │   • EWMA Trust Metric (BPS)  │                                                                 │  │
│  │  │   • Non-linear Slashing      │                                                                 │  │
│  │  └──────────────────────────────┘                                                                 │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                   ▲                                                     │
│                                                   │ Viem 2.x RPC                                        │
│  ┌────────────────────────────────────────────────┴──────────────────────────────────────────────────┐  │
│  │                                   AgentGuard Web Control Plane                                       │  │
│  │   • React 19 + Tailwind CSS v4                                                                    │  │
│  │   • Fleet Overview & Real-Time Velocity Gauges                                                    │  │
│  │   • Visual Policy Studio                                                                          │  │
│  │   • Interactive Rogue Agent Simulator                                                             │  │
│  │   • Cryptographic Audit Ledger                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Storage Optimization & Monad Parallel EVM Physics

### A. Single 32-Byte Slot Packing (`PackedState`)
Standard EVM contracts perform multiple `SLOAD` operations per transfer (reading spent amount, window start, transaction counter, and nonce from separate storage slots). Each storage access incurs 2,100 gas for cold slots and introduces state conflicts.

`PolicyEngine.sol` packs mutable agent execution state into a single 256-bit word:

```solidity
struct PackedState {
    uint128 spentInWindow;     // bits 0..127: Cumulative spend in current rolling window
    uint32  windowStart;       // bits 128..159: Unix timestamp of window inception
    uint32  txCountInWindow;   // bits 160..191: Number of transactions evaluated
    uint64  nonce;             // bits 192..255: Monotonically increasing agent nonce
}
```

- **Gas Efficiency**: Evaluating and updating state consumes exactly $1 \text{ SLOAD}$ and $1 \text{ SSTORE}$ (~23,800 total transaction gas).
- **Concurrency Isolation**: Because `mapping(address => PackedState)` stores each agent's word at `keccak256(agent, slot_index)`, transactions originating from different agents touch completely disjoint storage slots. Monad's Parallel EVM pipeline schedules them across concurrent execution cores without OCC conflicts.

### B. Cancun Transient Storage (`tstore` / `tload`)
Reentrancy protection in `AgentWalletGuard.sol` uses transient storage opcodes:
- Entry: `assembly { tstore(GUARD_SLOT, 1) }`
- Exit: `assembly { tstore(GUARD_SLOT, 0) }`
- Gas cost: 100 gas per check versus 5,000+ gas for classic storage reentrancy guards, while resetting cleanly at transaction end.

---

## 4. Machine-Readable Reason Codes

AgentGuard returns standardized integer reason codes (`ReasonCode`) to enable autonomous agent error-handling without parsing brittle string revert messages:

| Code | Identifier | Explanation | Agent Mitigation Action |
| :--- | :--- | :--- | :--- |
| `0` | `SUCCESS` | Request permitted and recorded | Proceed with payment execution |
| `1` | `POLICY_NOT_FOUND` | No policy configured for agent | Request policy provisioning from owner |
| `2` | `KILL_SWITCH_ACTIVE` | Agent manually or automatically frozen | Enter safe mode; alert operator |
| `3` | `EXCEEDS_TX_LIMIT` | Requested amount exceeds `maxPerTx` | Split payment into smaller chunks |
| `4` | `EXCEEDS_WINDOW_LIMIT` | Rolling window spend limit reached | Back off until rolling window expires |
| `5` | `EXCEEDS_VELOCITY` | Too many transactions within window | Rate limit request dispatch |
| `6` | `MERCHANT_NOT_WHITELISTED` | Destination address not whitelisted | Request merchant whitelisting |
| `7` | `NONCE_ALREADY_USED` | Replay protection failure | Increment nonce and re-sign |
| `8` | `DEADLINE_EXPIRED` | Request timestamp past deadline | Generate fresh signature |
| `9` | `UNAUTHORIZED_SIGNER` | Recovered signer does not match agent | Verify signing key credentials |

---

## 5. x402 / AP2 Protocol Integration

When an agent requests a protected API resource without payment:
1. **HTTP 402 Payment Required**: Gateway returns header:
   `PAYMENT-REQUIRED: x402 token=0x... amount=5000000000000000000 agent=0x... recipient=0x... deadline=1741503600 nonce=1`
2. **EIP-712 Signing**: Agent signs structured payload using its local private key.
3. **HTTP Authorization**: Agent repeats request with header:
   `PAYMENT-SIGNATURE: x402 req=base64(json) sig=0x...`
4. **Onchain Dispatch**: Gateway verifies signature and dispatches `executeGatedPayment` on Monad.
5. **Sub-second Settlement**: Monad finalizes the block in 400ms, transferring funds to the merchant and updating the agent's reputation score.
