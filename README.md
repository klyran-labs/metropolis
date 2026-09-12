# ComputeX: Sub-Millisecond DePIN Compute Marketplace on Monad

[![Monad Testnet](https://img.shields.io/badge/Monad-Testnet%20(10143)-8A2BE2)](https://testnet-rpc.monad.xyz)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.36-363636)](https://soliditylang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.98.1%20(2024)-DEA584)](https://www.rust-lang.org/)
[![DuckDB](https://img.shields.io/badge/Analytics-Embedded%20DuckDB-FFF000)](https://duckdb.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Executive Summary:** ComputeX establishes an enterprise-grade, verifiable DePIN compute clearinghouse on Monad (Chain ID `10143`). It separates high-frequency offchain order execution and real-time SLA telemetry from onchain state management. By combining a lock-free Rust matching engine with `memmap2` Write-Ahead Logging, an async Tokio telemetry oracle with embedded DuckDB OLAP, a non-custodial dual-asset Solidity settlement layer (USDC compute pricing + native MON gas/collateral staking) with Delivery-versus-Payment (DvP) and 3-of-5 threshold collateral slashing, and an Nginx-backed React 19 SPA with 60 FPS Canvas depth streaming, ComputeX provides AI agents and enterprise labs with guaranteed capacity, stable dollar pricing, and automated parametric risk insurance.

---

### Architecture & System Design Documentation
- 📊 **[Business Plan & Commercial Roadmap](docs/BUSINESS_PLAN.md)**: Institutional strategy, competitive analysis (Vast.ai, RunPod, Akash, CoreWeave), dual-asset economics, agent-native procurement wedge, and 3-year financial forecasts.
- 📘 **[System Architecture Blueprint](docs/ARCHITECTURE.md)**: Deep dive into the Monad Parallel EVM clearing layer, Rust in-memory CLOB engine physics, DuckDB OLAP oracle consensus, cross-border tax compliance, Acceptable Use Policy & Abuse Sentinel, and 4-tier persistence & user identity architecture.
- 🔄 **[End-to-End System Flows & State Machines](docs/SYSTEM_FLOWS.md)**: Exhaustive sequence diagrams and technical lifecycles for Authentication, Spot Matching, Atomic DvP Clearing, Physical Host Daemon Provisioning, Parametric Slashing, Recurring Payments, and Disaster Recovery.

---

## Architectural Alignment Summary

```
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                                   System Topography                                    │
 │                                                                                        │
 │  ┌─────────────────────────────┐   ┌────────────────────────┐   ┌───────────────────┐  │
 │  │ React 19 Canvas Terminal    │──►│ Nginx Reverse Proxy    │──►│ Rust CLOB Matcher │  │
 │  │ (Viem 2.x + ECDH Signer)    │   │ (Rate Limiter + WS)    │   │ (memmap2 WAL)     │  │
 │  └─────────────────────────────┘   └────────────────────────┘   └─────────┬─────────┘  │
 │                                                                           │            │
 │  ┌─────────────────────────────┐   ┌────────────────────────┐             │            │
 │  │ Monad L1 Settlement         │◄──│ 3-of-5 SLA Oracle      │◄────────────┘            │
 │  │ (DvP + ERC-1155 + Slashing) │   │ (Embedded DuckDB OLAP) │                          │
 │  └─────────────────────────────┘   └────────────────────────┘                          │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

| Dimension | Implementation Layer | Operational Metric / Guarantee |
| :--- | :--- | :--- |
| **Matching Speed** | Rust / Tokio WebSocket | $< 3\mu\text{s}$ in-memory CLOB price-time priority matching |
| **Disaster Recovery** | `memmap2` binary WAL | $< 50\text{ms}$ deterministic orderbook recovery on engine restart |
| **State Settlement** | Monad L1 / Solidity 0.8.28 | $\sim 400\text{ms}$ finality via EIP-712 batch signatures & DvP escrow |
| **MEV Protection** | Monotonic `batchSequenceId` | Reordering & mempool front-running eliminated by strict sequence |
| **SLA Insurance** | 3-of-5 Threshold Oracle + Vault | Parametric collateral slashing triggered within 1 block of SLA breach |
| **Cold Path Analytics** | Embedded DuckDB | 24-hour EWMA sliding window & zero-copy Parquet export |
| **Web Performance** | React 19 / HTML5 2D Canvas | 60+ FPS depth ladder rendering with zero DOM re-render thrashing |
| **Mobile Client** | React Native / Expo (`apps/mobile`) | Handheld cluster monitoring, touch depth ladder, & credential vault |
| **Developer SDKs** | TypeScript (`@computex/sdk`) & Python | Autonomous agent EIP-712 signing, ECDH credentials, & live WS streams |

---

## Developer SDKs (TypeScript & Python)

Autonomous AI agents, quant traders, and cluster orchestration pipelines integrate with ComputeX headless via programmatic SDKs:

### TypeScript SDK (`@computex/sdk`)
```typescript
import { ComputeXClient } from '@computex/sdk';
import { privateKeyToAccount } from 'viem/accounts';

const client = new ComputeXClient({
  engineWsUrl: 'wss://terminal.computex.io/ws/v1/',
  settlementAddress: '0x...',
  account: privateKeyToAccount('0x...'),
});

// 1. Offchain zero-gas EIP-712 Order Creation (USDC Settlement)
const signedOrder = await client.createSignedOrder({
  tokenId: 1n, // cGPU-H100 SXM5
  isBid: true,
  priceUsdPerHour: '2.45', // Stable USD pricing settled via USDC
  hours: 48,
});

// 2. Submit to Rust Engine via WebSocket
client.submitOrder(signedOrder);

// 3. Connect Live Stream & Automatic ECDH Credential Decryption
client.connectStream({
  onDepth: (depth) => console.log('Live Depth:', depth.bids[0], depth.asks[0]),
  onTrade: (trade) => {
    if (trade.decryptedCredentials) {
      console.log('SSH String:', trade.decryptedCredentials.rawPayload);
    }
  },
});
```

### Python SDK (`computex-sdk`)
```python
from computex import ComputeXAgentClient, LimitOrderParams

client = ComputeXAgentClient(
    maker_address="0x...",
    settlement_address="0x...",
    engine_ws_url="ws://localhost:9101",
)

# Build EIP-712 order matching ComputeCLOBSettlement.sol on Monad (USDC Settle)
params = LimitOrderParams(token_id=1, is_bid=True, price_usd_per_hour=2.45, hours=24)
payload = client.build_order_payload(params)

# Format WebSocket JSON message
ws_msg = client.format_ws_submit_message(payload, signature="0x...")
```

### Institutional CLI (`@computex/cli`)
```bash
# Check platform status and settlement block height
npx @computex/cli status

# Inspect capacity catalog & machine matrix
npx @computex/cli catalog

# Generate Point-to-Point WireGuard profile
npx @computex/cli wireguard --peer 10.143.0.42 > client.conf

# Generate Kubernetes GPU DaemonSet manifest
npx @computex/cli k8s-manifest --gpus 8 --model H100 > computex-ds.yaml
```

## Repository Structure

```
ScoreFi/  --> [ComputeX]
├── Cargo.toml                              # Workspace manifest (engine, oracle, core)
├── Makefile                                # Unified build, test, and run harness
├── contracts/                              # Solidity ^0.8.26/0.8.36 Cancun Smart Contracts
│   ├── src/
│   │   ├── interfaces/
│   │   │   ├── IComputeCLOB.sol            # Order structs, SLAPolicy, events & errors
│   │   │   └── IParametricSLAVault.sol     # SLA vault interface & slash attestations
│   │   ├── core/
│   │   │   ├── ComputeToken.sol            # ERC-1155 tokenized compute capacity vouchers
│   │   │   ├── ComputeCLOBSettlement.sol   # DvP, batchSequenceId, EIP-712 settlement
│   │   │   └── ParametricSLAVault.sol      # 3-of-5 threshold slashing insurance vault
│   │   └── libraries/
│   │       └── TransientReentrancyGuard.sol# Cancun/Prague tstore reentrancy lock
│   └── test/
│       └── computex-contracts.test.mjs     # Complete contract test suite
│
├── crates/
│   ├── computex-core/                      # Shared types, EIP-712 hashing, ECDH crypto
│   │   └── src/
│   │       ├── types.rs                    # Order, ExecutionMatch, SLAPolicy, NodeTelemetry
│   │       ├── eip712.rs                   # EIP-712 hashing for Order & SlashAttestation
│   │       ├── crypto.rs                   # ECDH shared secret & AES-256-GCM encryption
│   │       └── error.rs                    # Domain error hierarchy
│   ├── computex-engine/                    # Low-latency Rust matching engine + WAL
│   │   └── src/
│   │       ├── orderbook.rs                # Contiguous price-time priority CLOB
│   │       ├── wal.rs                      # memmap2 binary write-ahead logger (<50ms replay)
│   │       ├── risk.rs                     # Pre-trade in-memory escrow margin gate
│   │       ├── server.rs                   # Tokio WebSocket gateway & L2 broadcaster (Port 9101)
│   │       └── main.rs
│   ├── computex-protocol/                  # High-throughput binary framing (0x4358) & FIX 4.4/5.0-SP2
│   │   └── src/
│   │       ├── binary.rs                   # CRC32 IEEE 802.3 fixed 30-byte header frame
│   │       ├── fix.rs                      # Institutional tag-value order protocol parser
│   │       └── wire.rs                     # Protocol versioning & schema serialization
│   ├── computex-audit/                     # Cryptographic audit models and event logging
│   └── computex-oracle/                    # Telemetry oracle + Embedded DuckDB OLAP
│       └── src/
│           ├── telemetry.rs                # NVML & ping metrics collector
│           ├── duckdb_store.rs             # In-process DuckDB sliding window & Parquet
│           ├── threshold.rs                # 3-of-5 threshold consensus aggregator
│           ├── monad_relay.rs              # Alloy L1 settlement & slashing submitter
│           └── main.rs
│
├── services/
│   ├── api-gateway/                        # Authenticated ingress gateway, rate limits, traceparent
│   ├── identity-policy/                    # Spend reservations, dual approvals, wallet rotation
│   ├── provisioning-controller/            # 8-stage lease lifecycle, WireGuard ingress, wipe verification
│   ├── reconciliation/                     # Composite multi-attribute matching, emergency solvency pause
│   └── settlement-keeper/                  # Idempotent Monad batch clearing, revert decoding, journals
│
├── packages/
│   ├── computex-cli/                       # Institutional CLI tool (status, catalog, order, ssh, wireguard, k8s)
│   ├── sdk-ts/                             # TypeScript SDK (@computex/sdk)
│   └── shared-types/                       # Shared TypeScript interfaces
│
├── apps/web/                               # React 19 + Vite + Tailwind + Viem + React Router v7
│   ├── src/
│   │   ├── context/
│   │   │   ├── MarketplaceContext.tsx      # Strict role exclusivity, session persistence
│   │   │   ├── ThemeContext.tsx            # Light/Dark mode state & DOM sync
│   │   │   └── ToastContext.tsx            # Portal toast system with Monad Explorer links
│   │   ├── components/
│   │   │   ├── buyer/
│   │   │   │   ├── BuyerPortal.tsx         # 8-section buyer console (route-synced)
│   │   │   │   ├── CapacityCatalog.tsx     # Filterable capacity cards with quick procurement
│   │   │   │   ├── CredentialDelivery.tsx  # Zero-mock OpenSSH & WireGuard credentials
│   │   │   │   └── OrderLifecycleView.tsx  # Transparent order lifecycle pipeline
│   │   │   ├── seller/
│   │   │   │   ├── SellerPortal.tsx        # 8-section provider console (route-synced)
│   │   │   │   └── ProviderFleetView.tsx   # 10-stage verified hardware fleet management
│   │   │   ├── common/
│   │   │   │   ├── ErrorBoundary.tsx       # Subtree crash isolation & reload recovery
│   │   │   │   ├── NotificationDrawer.tsx  # Slide-over Monad settlements & order fills
│   │   │   │   ├── ThemeToggle.tsx         # Light/Dark theme switcher
│   │   │   │   └── UiState.tsx             # Truthful state primitives (Loading, Empty, Degraded)
│   │   │   ├── fintech/
│   │   │   │   ├── FintechHeader.tsx       # Streamlined tabs & Account/Balance popover
│   │   │   │   └── FintechOverview.tsx     # High-density DePIN metric grid
│   │   │   ├── OrderBookCanvas.tsx         # 60fps HTML5 Canvas depth ladder
│   │   │   ├── Terminal.tsx                # Advanced orderbook & capacity selector
│   │   │   └── TelemetryRadar.tsx          # Real-time node health & SLA tracker
│   │   └── hooks/
│   │       ├── useFocusTrap.ts             # WCAG-compliant modal focus trapping
│   │       ├── useWeb3Wallet.ts            # Real browser Web3 wallet + Monad chain switcher
│   │       ├── useEIP712Order.ts           # Viem order builder & ECDH generator
│   │       └── useOrderBookSocket.ts       # Zero-lag WebSocket consumer
│
└── docker/
    ├── Dockerfile.engine                   # Engine container build
    ├── Dockerfile.oracle                   # Oracle container build
    ├── Dockerfile.web                      # Production web build (Nginx)
    ├── nginx.conf                          # Anti-stale cache control, rate limiter & WS proxy
    ├── docker-compose.yml                  # Local orchestration with Anvil (Chain 10143)
    ├── docker-compose.dev.yml              # Development stack
    └── docker-compose.prod.yml             # Production hardened stack
```

---

## Getting Started

### 1. Build & Test Everything
```bash
make build
make test
```

### 2. Run Contracts Test Suite
```bash
make test-contracts
```

### 3. Run Matching Engine & WAL Test Suite
```bash
make test-engine
```

### 4. Run Telemetry Oracle, DuckDB & Threshold Consensus Test Suite
```bash
make test-oracle
```

### 5. Launch the Services
```bash
# Terminal 1: Core Execution Engine (Port 9101)
make run-engine

# Terminal 2: Telemetry Oracle & Embedded DuckDB (400ms Monad Tick)
make run-oracle

# Terminal 3: React 19 Web Terminal (Port 3110)
make run-web
```

---

## Security & Verification Invariants

1. **Delivery-versus-Payment (DvP)**: Total buyer escrow deducted equals exact seller proceeds plus protocol fee:
   $$\text{TotalPayment} = \text{executionPricePerSec} \times \text{fillAmountSec}$$
   $$\text{SellerProceeds} + \text{ProtocolFee} = \text{TotalPayment}$$
2. **Monotonic Batch Ordering**: Out-of-order execution or mempool front-running is prohibited by onchain sequence checks:
   $$\text{require}(\text{batchSequenceId} == \text{currentBatchSequenceId} + 1)$$
3. **Parametric Slashing Distribution**:
   - $80\%$ of bonded collateral refunded to buyer as liquidated damages.
   - $10\%$ awarded to oracle keeper submitting valid threshold attestation.
   - $10\%$ protocol reserve accumulation.
4. **Disaster Recovery**: Engine reconstructs $100\%$ of active resting orders in $< 50\text{ms}$ upon restart using `memmap2` binary replay.
