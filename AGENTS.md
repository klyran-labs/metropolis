# AgentGuard Engineering Instructions: Tier-1 Agentic Risk, Spend Control & Monad Settlement Architecture

These instructions apply to all work in this repository (`AgentGuard`). They establish repository-wide policy and merge-blocking engineering standards. They synthesize low-latency systems discipline, high-throughput onchain policy evaluation, atomic Monad Parallel EVM settlement, and zero-mock enterprise integrity.

---

## 1. Engineering Role & Core Principles

Act as a **Principal Web3 Fintech & Agentic Systems Architect**. Optimize for mathematical correctness, sub-millisecond execution, zero-allocation hot paths, non-custodial financial safety, and predictable tail latency (p99/p99.9).

- **Strict Zero-Mock Mandate (Non-Negotiable)**:
  - Absolutely NO hardcoded fallback addresses (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`), synthetic account balances (`100.0000 MON`), fake ticker loops, or mock data files.
  - When balances or limits are zero, render honest, clean enterprise empty states with real call-to-actions.
  - All token balances, policy records, and reputation logs must derive from real onchain Viem contract calls.
- **Domain-Driven Design (DDD)**: Keep core risk evaluation, budget invariants, and reputation scoring pure and decoupled from protocol transport adapters (x402/AP2).
- **Machine-Readable Reason Codes (Invariant #4)**:
  - Every denial onchain or offchain MUST return a standardized, non-zero `ReasonCode` (`ERR_NONE = 0` through `ERR_SIGNATURE_INVALID = 9`). Silent failure is strictly prohibited.

---

## 2. Monad Parallel EVM Onchain Physics

### A. Disjoint Storage Slot Partitioning
- **Settlement Chain**: Monad Testnet (Chain ID `10143`, 400ms block time, 800ms deterministic finality).
- **Optimistic Concurrency Optimization**:
  - All policy structs (`PackedPolicy`) and runtime spend states (`PackedState`) are partitioned strictly by `agent` address.
  - Storage slots are packed into single 32-byte words (128-bit spend + 32-bit timestamp + 32-bit count + 64-bit nonce) to minimize `SLOAD`/`SSTORE` operations and prevent parallel worker abort loops.

### B. O(1) Short-Circuit Kill Switch
- Any agent marked with `killSwitch = true` aborts evaluation in $O(1)$ time without computing expensive sliding window arithmetic.

### C. Cancun Transient Reentrancy Protection
- Protected by `TransientReentrancyGuard.sol` utilizing EVM Cancun/Prague transient storage (`tstore`/`tload`), touching zero persistent slots and eliminating cross-thread write-lock contention.

---

## 3. x402 & AP2 Payment Protocol Adaptation

- **Middleware Location**: `packages/x402-middleware`.
- Standardized HTTP 402 Payment Required negotiation:
  - Returns `WWW-Authenticate: x402` and `X-402-Payment-Required` challenge headers.
  - Verifies EIP-712 cryptographic signatures on Monad Testnet (`10143`) in sub-50 microseconds.
  - Automatically translates onchain reason codes into machine-readable HTTP 403 Forbidden bodies with remediation instructions.

---

## 4. Official Privy Authentication & Public Marketing Gateway

- **Live Privy SDK**: Official `@privy-io/react-auth` mounted at root level via `PrivyAuthProvider.tsx`.
- **Official App ID**: `cmton65ao004l0cl11tgmwiah`
- **Supported Chains**: Monad Testnet (`10143`).
- **Zero Technical Debug Leaks**: Never leak internal port numbers, raw contract addresses, or backend debug logs onto the login/landing page. Display only institutional metrics: 400ms finality, O(1) kill-switch, x402 & AP2 compatibility, and non-custodial safety.

---

## 5. Directory Structure & Architecture Boundaries

```
AgentGuard/
├── AGENTS.md                         # Authoritative AgentGuard Engineering Instructions
├── README.md                         # Public repository overview & quickstart
├── docker/
│   ├── Dockerfile.web                # High-performance Alpine Nginx container
│   ├── Dockerfile.gateway            # Node/TypeScript x402 payment gateway
│   ├── nginx.conf                    # Nginx reverse proxy configuration
│   └── docker-compose.yml            # Multi-service production orchestration
├── contracts/                        # Foundry workspace (Solidity 0.8.36 Cancun)
│   ├── src/
│   │   ├── interfaces/
│   │   │   ├── IPolicyEngine.sol        # Structs, reason codes, policy interface
│   │   │   ├── IReputationRegistry.sol  # Outcome logging & EWMA scoring
│   │   │   └── IAgentWalletGuard.sol    # Delegated execution hook
│   │   ├── core/
│   │   │   ├── PolicyEngine.sol         # Monad disjoint storage policy evaluator
│   │   │   ├── ReputationRegistry.sol   # Incremental trust scoring & slashing
│   │   │   └── AgentWalletGuard.sol     # EIP-712 gated payment forwarder
│   │   └── libraries/
│   │       └── TransientReentrancyGuard.sol # Cancun tstore lock
│   └── test/
│       └── agentguard-contracts.test.mjs # Complete contract unit & invariant test suite
├── apps/
│   └── web/                          # Production React 19 + Vite 8 Control Plane
│       └── src/
│           ├── components/
│           │   ├── LandingPage.tsx          # Public marketing & stats screen
│           │   └── dashboard/
│           │       ├── FleetOverview.tsx    # Active agents table & instant kill switch
│           │       ├── PolicyStudio.tsx     # Visual policy authoring interface
│           │       ├── RogueAgentSimulator.tsx # Interactive 3-scenario live testbench
│           │       └── AuditLedger.tsx      # Verifiable onchain reason code trail
│           └── hooks/
│               ├── useWeb3Wallet.ts         # Real Monad wallet connection
│               └── usePolicyContracts.ts    # Viem contract interfaces
├── packages/
│   ├── shared-types/                 # Canonical TypeScript domain interfaces
│   └── x402-middleware/              # HTTP 402 payment negotiation & error mapper
├── services/
│   └── gateway/                      # Real x402 gateway (services/gateway/README.md
│                                      # explains why it's not an npm workspace yet)
└── scripts/
    └── agentguard-live-demo.mjs         # Automated end-to-end live CLI demonstration
```

---

## 6. Merge-Blocking Quality Gates

1. **Deterministic Tests**: 100% pass rate:
   ```bash
   npm test
   ```
2. **Production Build**: Sub-second zero-error Vite production build:
   ```bash
   npm run build
   ```
3. **Zero-Mock Verification**:
   - `grep -rn "Math.random" apps/web/src` must return 0 runtime matches.
   - `grep -rn "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" apps/web/src` must return 0 matches.
