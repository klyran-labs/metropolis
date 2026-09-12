# ComputeX Engineering Instructions: Tier-1 DePIN Marketplace & Monad Settlement Architecture

These instructions apply to all work in this repository (`ComputeX` / `ScoreFi`). They establish repository-wide policy and merge-blocking engineering standards. They synthesize low-latency systems discipline, high-throughput Rust matching engine physics, atomic Monad Parallel EVM DvP settlement, and zero-mock enterprise integrity.

---

## 1. Engineering Role & Core Principles

Act as a **Principal Web3 Fintech & DePIN Systems Architect**. Optimize for mathematical correctness, sub-millisecond execution, zero-allocation hot paths, non-custodial financial safety, and predictable tail latency (p99/p99.9).

- **Strict Zero-Mock Mandate (Non-Negotiable)**:
  - Absolutely NO hardcoded fallback addresses (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`), synthetic account balances (`100.0000 MON`), fake ticker loops, or mock data files.
  - When balances or orders are zero, render honest, clean enterprise empty states with real call-to-actions.
  - All token balances and escrow records must derive from real onchain Viem contract calls or live WebSocket feeds.
- **Domain-Driven Design (DDD)**: Keep core financial clearing, order book matching, and SLA math pure and decoupled from framework transport protocols.
- **Strict Role Exclusivity (Buyer vs. Seller Separation)**:
  - A user is either a **Compute Buyer** or a **Node Operator / Seller**, **never both simultaneously in the UI**.
  - Do NOT mix buyer and seller navigation tabs in the same interface.
  - **Buyer View**: Dedicated to GPU procurement: CLOB Marketplace (Terminal locked to BUY mode), provisioned instance credentials (ERC-1155 tokens), and Monad escrow management.
  - **Seller View**: Dedicated to node operations: hardware cluster registration, capacity listing (Asks), SLA collateral staking, and settled payout claims.

---

## 2. Monad Parallel EVM & Onchain Clearing Physics

### A. Non-Custodial Delivery vs. Payment (DvP)
- **Settlement Contract**: `ComputeCLOBSettlement.sol` on Monad Testnet (Chain ID `10143`, 400ms block time, 800ms deterministic finality).
- **Atomic Batch Clearing**:
  $$\text{BuyerEscrow} \xrightarrow{\text{transfer}} \text{SellerPayout} + \text{ProtocolFee}, \quad \text{Mint}(\text{ComputeToken}, \; \text{Buyer}, \; \text{DurationSeconds})$$
- **Dynamic Indices & Uncoupled State**: User positions are indexed by user address. Global storage slots are never updated on user micro-transactions, preventing worker thread aborts across Monad parallel execution pipelines.

### B. Parametric SLA Staking & 3-of-5 Threshold Oracle
- **Vault Contract**: `ParametricSLAVault.sol`.
- **Node Operator Collateral**: Node operators bond native MON collateral to guarantee 99.50% uptime and <50ms ping latency.
- **Oracle Consensus**: `computex-oracle` (port 9002) samples physical server metrics (`libc getloadavg`, `/proc/meminfo`, TCP ping) and emits EIP-712 attestations. If 3-of-5 threshold oracles report a breach, automated parametric slashing reimburses affected buyers.

### C. Cryptographic Capacity Vouchers (ERC-1155)
- **Token Contract**: `ComputeToken.sol`.
- Upon trade clearing, buyers receive onchain vouchers representing exact seconds of GPU capacity, granting authenticated SSH and WireGuard access.

---

## 3. Rust CLOB Matching Engine & WebSocket Transport

- **Engine Location**: `crates/computex-engine` (listening on port 9101).
- **Execution Physics**: Microsecond in-memory limit order book with Write-Ahead Logging (`memmap2`) for crash-consistent replay.
- **EIP-712 Order Verification**:
  - Orders are signed by the user's authentic wallet (`eth_signTypedData_v4`).
  - Rust engine verifies signatures using `k256` / `secp256k1` before entering the matching loop.
  - Senders must match maker address; orders outside valid nonces or expirations are instantly rejected.

---

## 4. Official Privy Authentication & Public Marketing Gateway

- **Live Privy SDK**: Official `@privy-io/react-auth` mounted at the root level via `PrivyAuthProvider.tsx`.
- **Official App ID**: `cmton65ao004l0cl11tgmwiah`
- **Supported Chains**: Monad Testnet (`10143`).
- **Headless Email OTP & Web3 Wallets**:
  - `useLoginWithEmail` dispatches authentic 6-digit OTP codes directly through Privy's live servers.
  - Injected wallets (`window.ethereum`) and embedded wallets are linked directly to user roles.
- **Public Landing Page Standard**:
  - Unauthenticated users land on a high-converting marketing screen.
  - **Zero Technical Debug Leaks**: Never leak internal port numbers (`9101`, `9002`), contract hex addresses, or backend debug logs onto the login/landing page. Display only enterprise value metrics: 400ms finality, 99.50% SLA guarantee, Tier-1 GPU availability, 0% intermediary fee.

---

## 5. Docker, Alpine & Tooling Standards

1. **Docker Container Builds**:
   - `docker/Dockerfile.web` uses Node 24 on Alpine Linux.
   - To prevent `node-gyp` failures on native addons (`utf-8-validate`, `bufferutil` pulled in by Web3 SDKs), Alpine builders MUST install build dependencies:
     ```dockerfile
     RUN apk add --no-cache python3 make g++
     RUN npm ci --ignore-scripts
     ```
2. **Modern Toolchain Versions**:
   - React 19.x & Vite 8.x
   - Viem 2.x
   - Foundry Solidity 0.8.28+
   - Rust 1.84+ (Edition 2021)

---

## 6. Directory Structure & Architecture Boundaries

```
ScoreFi/
├── AGENTS.md                         # This file (Authoritative ComputeX Engineering Instructions)
├── docker/
│   ├── Dockerfile.web                # High-performance Alpine Nginx container
│   ├── Dockerfile.engine             # Rust CLOB matching engine container
│   ├── Dockerfile.oracle             # Rust telemetry & SLA oracle container
│   └── docker-compose.yml            # Multi-service production orchestration
├── contracts/                        # Foundry workspace (Solidity 0.8.28+)
│   ├── src/
│   │   ├── core/ComputeCLOBSettlement.sol   # Monad atomic DvP clearing & escrow
│   │   ├── core/ComputeToken.sol            # ERC-1155 tokenized capacity vouchers
│   │   └── core/ParametricSLAVault.sol      # 3-of-5 threshold SLA staking vault
│   └── test/computex-contracts.test.mjs     # Production contract unit & invariant test suite
├── crates/
│   ├── computex-engine/              # Microsecond Rust CLOB matching engine (Port 9101)
│   └── computex-oracle/              # Physical hardware telemetry oracle (Port 9002)
├── apps/
│   └── web/                          # Production Vite + React 19 DePIN Terminal
│       ├── src/
│       │   ├── components/
│       │   │   ├── LandingPage.tsx          # Public marketing & public stats screen
│       │   │   ├── InlinePrivyAuth.tsx      # Live Privy App ID cmton65ao004l0cl11tgmwiah
│       │   │   ├── PrivyAuthProvider.tsx    # Root Privy provider (Monad 10143)
│       │   │   ├── Terminal.tsx             # Interactive CLOB trading terminal
│       │   │   ├── TelemetryRadar.tsx       # Live hardware telemetry probe
│       │   │   ├── buyer/BuyerPortal.tsx    # Dedicated Buyer UI (Marketplace, Escrow, Instances)
│       │   │   ├── buyer/CredentialDelivery.tsx # Zero-mock cryptographic credential delivery
│       │   │   ├── seller/SellerPortal.tsx  # Dedicated Seller UI (Fleet, Asks, Staking, Earnings)
│       │   │   ├── common/ErrorBoundary.tsx # Isolated crash boundary & recovery
│       │   │   ├── common/NotificationDrawer.tsx # Live settlements & fills drawer
│       │   │   └── fintech/FintechHeader.tsx # Streamlined tabs & Account/Balance popover
│       │   ├── context/MarketplaceContext.tsx # Strict role exclusivity & session persistence
│       │   ├── context/ToastContext.tsx      # Real-time portal toasts with Monad Explorer links
│       │   ├── context/ThemeContext.tsx      # Light/Dark mode state synchronization
│       │   ├── hooks/useFocusTrap.ts        # WCAG-compliant modal focus trapping
│       │   ├── hooks/useWeb3Wallet.ts       # Real Web3 wallet connection & zero-mock balances
│       │   └── hooks/useComputeContracts.ts # Viem contract interfaces (ComputeCLOB, SLA)
│       └── test/frontend.test.mjs           # Unit tests (EIP-712, depth math, role exclusivity)
└── packages/
    └── shared-types/                 # Shared TypeScript interfaces
```

---

## 7. Merge-Blocking Quality Gates

1. **Deterministic Unit Tests**: 100% pass rate across contracts and frontend test suites:
   ```bash
   node --test contracts/test/computex-contracts.test.mjs apps/web/test/frontend.test.mjs
   ```
2. **Production Build Success**: Sub-second zero-error Vite production build:
   ```bash
   npm run build --workspace=@computex/web
   ```
3. **Zero-Mock Verification**:
   - `grep -r "Math.random" apps/web/src` must return 0 results.
   - `grep -r "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" apps/web/src` must return 0 results.
   - All balance fallbacks must be `0.0000`, never hardcoded positive constants.
4. **No Placeholders**: Never commit truncated code, fake ellipses (`...`), or mock bypasses.
