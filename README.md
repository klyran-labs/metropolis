# AgentGuard: Programmable Risk & Spend Control Layer for Agentic Payments on Monad

[![Monad Testnet](https://img.shields.io/badge/Monad-Testnet%20(10143)-8A2BE2)](https://testnet-rpc.monad.xyz)
[![Rust Gateway](https://img.shields.io/badge/Gateway-Rust%20(Axum%20%2B%20Tokio)-DEA584)](services/gateway)
[![OpenSigner](https://img.shields.io/badge/OpenSigner-Self--Hosted%20Enclave-00C49F)](services/opensigner)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.36-363636)](https://soliditylang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![x402](https://img.shields.io/badge/Protocol-x402%20%2B%20AP2-0052FF)](https://github.com/coinbase/x402)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Thesis:** Autonomous AI agents paying via micro-payment protocols (**x402**, **AP2**) require real-time economic guardrails before executing payments. Without deterministic limits, a compromised bot or recursive tool loop can drain a treasury in seconds. Existing chains choke on the high-frequency micro-state writes (limits, velocity counters, sliding windows) required for real-time risk evaluation. **Monad's Parallel EVM, disjoint storage partitioning, and sub-second (~400ms) finality** make it possible to enforce enterprise-grade risk control fully onchain, non-custodially, and in real time.

---

## Table of Contents
- [1. System Architecture & Topography](#1-system-architecture--topography)
- [2. Monad Parallel EVM Physics](#2-monad-parallel-evm-physics)
- [3. Standardized Reason Codes](#3-standardized-reason-codes)
- [4. Tenant Isolation & Key Architecture](#4-tenant-isolation--key-architecture)
- [5. Modern EIPs & Agentic Primitives](#5-modern-eips--agentic-primitives)
- [6. Quickstart (Under 30 Seconds)](#6-quickstart-under-30-seconds)
- [7. Docker Deployment Topologies](#7-docker-deployment-topologies)
- [8. Hackathon Track & Roadmap](#8-hackathon-track--roadmap)

---

## 1. System Architecture & Topography

AgentGuard sits as an immutable, non-custodial gatekeeper between autonomous agent keypairs and onchain liquidity.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Enterprise Control Plane (apps/web)                             │
│  React 19 + Tailwind v4 + Viem 2.x + Privy Auth (App ID: cmton65ao004l0cl11tgmwiah)    │
│  - Tenant-Isolated Fleet Overview (My Agents vs Network Fleet, Instant Kill Switch)    │
│  - 1-Click Provisioning: Self-Hosted OpenSigner Enclave / Web Crypto Keypair / Import  │
│  - Policy Studio (Visual rule authoring: limits, sliding windows, merchant whitelists) │
│  - Audit Ledger (Verifiable Monad transactions + machine-readable reason codes)        │
│  - Interactive Rogue Agent Simulator (Live agent payment & burst spike sandbox)        │
└───────────────────────┬────────────────────────────────────────┬───────────────────────┘
                        │                                        │
                        │ Provision Agent                        │ Sign SpendRequest
                        ▼                                        ▼
┌───────────────────────────────────────────┐    ┌───────────────────────────────────────┐
│     Self-Hosted OpenSigner Enclave        │    │    High-Throughput Rust Gateway       │
│  (services/opensigner — Port 3001)        │    │  (services/gateway — Port 8080)       │
│  - AES-256-GCM sealed agent key storage   │    │  - Sub-50µs EIP-712 recovery & verify │
│  - Zero plaintext key leakage to disk     │    │  - HTTP 402 challenge negotiation     │
│  - EIP-712 SpendRequest signing for Monad │    │  - PostgreSQL-authoritative RBAC      │
│  - Endpoints: /api/v1/wallets, /sign      │    │  - Pre-flight RPC policy simulation   │
└───────────────────────────────────────────┘    └───────────────────┬───────────────────┘
                                                                     │
                                                                     ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   Settlement & Transport Adapters (packages/x402-middleware)           │
│  - x402 HTTP Challenge Generator (createX402Challenge)                                 │
│  - EIP-712 Payment Header Encoder & Parser (encodeX402Authorization)                   │
│  - Canonical TypeScript Domain Types & Protocol Serializers                            │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│            Monad Parallel EVM Onchain Core (Solidity 0.8.36 Cancun/Prague)             │
│                                                                                        │
│  ┌─────────────────────────────┐   ┌────────────────────────┐   ┌───────────────────┐  │
│  │ PolicyEngine.sol            │   │ ReputationRegistry.sol │   │ AgentWalletGuard  │  │
│  │ - Disjoint Storage Slots    │   │ - Incremental EWMA     │   │ - EIP-712 Intent  │  │
│  │ - Velocity Sliding Windows  │   │ - Append-Only Outcomes │   │ - ERC-1271 Checks │  │
│  │ - Instant Kill-Switch Check │   │ - Non-linear Slashing  │   │ - EIP-2612 Permit │  │
│  └─────────────────────────────┘   └────────────────────────┘   └───────────────────┘  │
│                                                                                        │
│  ┌─────────────────────────────┐   ┌────────────────────────┐   ┌───────────────────┐  │
│  │ AgentDelegationAccount.sol  │   │ AgentGuardHookModule   │   │ AgentIdentity     │  │
│  │ - EIP-7702 Delegated EOA    │   │ - ERC-7579 Hook / Val  │   │ - EIP-6551 TBA    │  │
│  │ - Ephemeral Execution Code  │   │ - Modular Smart Account│   │ - EnclaveRegistry │  │
│  └─────────────────────────────┘   └────────────────────────┘   └───────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

> Comprehensive documentation and diagrams available in [`docs/ARCHITECTURE_DIAGRAMS.md`](docs/ARCHITECTURE_DIAGRAMS.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [Architectural Decision Records (ADR 0001–0008)](docs/ADR/0008-qwen-agent-inference-and-x402-settlement.md).

---

## 2. Monad Parallel EVM Physics

### A. Zero-Contention Disjoint Storage Layout
Monad executes transactions across parallel worker pipelines using Optimistic Concurrency Control (OCC). Transactions touching conflicting storage slots abort and re-execute sequentially.

AgentGuard achieves non-conflicting parallel execution by **partitioning all persistent state strictly by agent address** and packing structs into single 32-byte words (128-bit spend + 32-bit timestamp + 32-bit count + 64-bit nonce):

```solidity
// Disjoint storage slot layout: Zero worker collision between distinct agents
mapping(address => PackedPolicy) private _policies;
mapping(address => PackedState) private _states;
mapping(address => mapping(address => bool)) private _merchantWhitelists;
mapping(address => mapping(uint256 => bool)) private _usedNonces;
```

### B. Gas Profile & Performance Metrics

| Operation | EVM Storage Access | Gas Cost | Monad Throughput Bound |
| :--- | :--- | :--- | :--- |
| **`PolicyEngine.evaluate`** | 1 SLOAD (`PackedPolicy`) + 1 SLOAD (`PackedState`) | ~4,200 gas | Pure view / Simulation (>50,000 ops/sec) |
| **`PolicyEngine.evaluateAndSpend`** | 2 SLOADs + 1 SSTORE (`PackedState`) + 1 SSTORE (nonce) | ~23,800 gas | **5,000 - 8,000 tx/sec on Monad** |
| **Instant Kill Switch Check** | 1 SLOAD (cached in first word) | ~2,400 gas | Sub-block immediate abort |
| **Offchain EIP-712 Verification** | `secp256k1` ecrecover in Rust / C | 42µs CPU | **25,000+ verifications/sec per core** |

---

## 3. Standardized Reason Codes

**Invariant:** Every policy denial onchain and offchain carries a non-zero, machine-readable reason code and explanation. Silent failures are strictly prohibited.

| Reason Code | Identifier | Explanation & Remediation |
| :---: | :--- | :--- |
| `0` | `ERR_NONE` | Spend request permitted under current policy. |
| `1` | `ERR_KILL_SWITCH` | Execution halted: Instant kill switch active for agent. Contact administrator. |
| `2` | `ERR_MAX_PER_TX` | Spend limit exceeded: Amount is above `maxPerTx` threshold. Split payment. |
| `3` | `ERR_MAX_PER_WINDOW` | Window budget exhausted: Cumulative spend exceeds `maxPerWindow` limit. |
| `4` | `ERR_VELOCITY_EXCEEDED` | Rate limit tripped: Transaction count exceeds sliding window velocity cap. |
| `5` | `ERR_MERCHANT_NOT_ALLOWED` | Counterparty blocked: Recipient is not in authorized merchant whitelist. |
| `6` | `ERR_BUDGET_DEPLETED` | Shared pool depleted: Org-wide budget allocation exhausted. |
| `7` | `ERR_EXPIRED` | Intent expired: Block timestamp exceeds request deadline. |
| `8` | `ERR_NONCE_REUSED` | Replay rejected: Spend request nonce has already been consumed. |
| `9` | `ERR_SIGNATURE_INVALID` | Authentication failed: Cryptographic EIP-712 signature invalid on Monad (10143). |

---

## 4. Tenant Isolation & Key Architecture

Autonomous AI agents run headless 24/7 in cloud environments and require dedicated private keys to sign payments without human intervention.

```
┌─────────────────────────────────────────────────────────────┐
│                 Connected Human User (0xUser)               │
│       Role: Agent Developer / Owner (Privy / Browser)       │
└──────────────────────────────┬──────────────────────────────┘
                               │
               Admin Authority │ setPolicy() & setAgentAdmin()
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Autonomous Agent Keypair (0xAgent)             │
│   • Generated Client-Side via Web Crypto (Sub-ms)           │
│   • Exports .env Snippet: AGENT_PRIVATE_KEY=0x...           │
│   • Signs EIP-712 SpendRequest Autonomously in Cloud        │
└──────────────────────────────┬──────────────────────────────┘
                               │
               SpendRequest    │ Gated on Monad
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Monad PolicyEngine & Guard                   │
│   • Verifies: signer == req.agent                           │
│   • Enforces: maxPerTx, maxPerWindow, velocity limits       │
│   • Instant Kill Switch controlled by 0xUser                │
└─────────────────────────────────────────────────────────────┘
```

1. **Signer Separation**:
   - The **human controller** (`0xUser`) never shares their master private key or seed phrase with the agent bot.
   - The **agent bot** (`0xAgent`) operates inside a strict financial sandbox bounded by Monad smart contracts.
2. **Self-Hosted OpenSigner Enclave (`services/opensigner`)**:
   - Uses AES-256-GCM authenticated encryption with `scrypt` master key derivation to seal private keys at rest.
   - Exposes REST endpoints (`POST /api/v1/wallets`, `POST /api/v1/sign-spend-request`) so agents request EIP-712 signatures without ever handling raw private keys.
3. **1-Click In-Browser Generation**:
   - Web Crypto derives a fresh, secure Ethereum keypair directly in the browser with copyable `.env` snippets.
4. **Tenant-Isolated Control Plane**:
   - Operators view only their own managed agents by default (`fleetScope = 'my_agents'`), preventing competitor reconnaissance of spend ceilings and whitelists.

---

## 5. Modern EIPs & Agentic Primitives

To maintain maximum parallel throughput on Monad and eliminate storage-proxy read hotspots, AgentGuard natively implements 7 modern standards:

1. **ERC-1271 Smart Contract Signatures**: Supports Safe smart accounts, DAOs, and multi-sig agents via `isValidSignature(bytes32,bytes)`.
2. **EIP-2612 Atomic Permit**: `executeGatedPaymentWithPermit` bundles ERC-20 permit approvals with gated settlement in a single atomic transaction without prior `approve()` calls.
3. **EIP-7702 Ephemeral Delegation**: `AgentDelegationAccount.sol` allows EOA agents to delegate execution code during transactions, executing batch gated payments directly from the EOA balance.
4. **ERC-7579 / ERC-4337 Modular Account Hooks**: `AgentGuardHookModule.sol` implements standard Hook (`type 4`) and Validator (`type 1`) interfaces for Kernel, Safe ERC-7579, and Biconomy smart accounts.
5. **EIP-6551 Token Bound Accounts (TBA)**: `AgentIdentityRegistry.sol` and `AgentAccount.sol` bind agent budget allocations, spend policies, and reputation scores to an ERC-721 identity NFT passport.
6. **ERC-7677 Paymaster RPC**: Rust Gateway implements standard JSON-RPC endpoints (`pm_getPaymasterStubData`, `pm_getPaymasterData`) enabling gasless stablecoin agent transactions.
7. **TEE Remote Attestation**: OpenSigner provides hardware-sealed quotes (`mrenclave`) via `/api/v1/attestation/quote`, verified onchain via `EnclaveAttestationRegistry.sol`.

---

## 6. Quickstart (Under 30 Seconds)

### 1. Install & Test
```bash
# Clone and install dependencies
git clone https://github.com/rahul-aiml-mba/agentguard.git
cd agentguard
npm install

# Run the complete deterministic test suite
npm test
```

### 2. Launch the Web Control Plane
```bash
npm run dev --workspace=@agentguard/web
```
Open **[http://localhost:3110](http://localhost:3110)** in your browser. The control plane uses the configured runtime profile and only renders records returned by the gateway or verified Monad reads.

The local compose profile requires real contract addresses generated by `scripts/deploy-local.mjs`. Testnet and mainnet profiles intentionally remain unavailable until their deployment manifests contain verified bytecode addresses.

---

## 7. Docker Deployment Topologies

AgentGuard provides three targeted Docker deployment environments:

### A. Local Monad Devnet (Anvil + Gateway + OpenSigner + Web)
```bash
# Start local devnet stack
make docker-up

# Deploy contracts and register fleet policies to local Anvil
node scripts/deploy-local.mjs

# Tear down
make docker-down
```
- **Enterprise Web Control Plane**: `http://localhost:3110`
- **High-Throughput Rust x402 Gateway**: `http://localhost:8080`
- **Self-Hosted OpenSigner Enclave**: `http://localhost:3001`
- **Monad Anvil RPC**: `http://localhost:8545`

### B. Public Monad Testnet Stack
Connects directly to the live Monad Testnet (`https://testnet-rpc.monad.xyz`, Chain ID `10143`):
```bash
cp docker/.env.testnet.example docker/.env.testnet
make docker-testnet-up
```

### C. Enterprise Production Stack
Hardened multi-stage deployment with container resource limits, log rotation, TLS readiness, and RPC failover:
```bash
cp docker/.env.production.example docker/.env.production
make docker-prod-up
```

---

## 8. Hackathon Track & Roadmap

- **Main Track:** Trust, Identity & AI Infrastructure (30,000 USD Prize Pool)
- **Target Sponsor Bounties:** 
  - **Privy (5k USD):** Deep role governance & tenant-isolated fleet management.
  - **Alibaba Cloud Qwen 3.8 Max (5k USD credits):** Autonomous agent inference gated by Monad x402 micropayments (see [`docs/ADR/0008-qwen-agent-inference-and-x402-settlement.md`](docs/ADR/0008-qwen-agent-inference-and-x402-settlement.md)).
  - **Envio HyperSync (1k USD):** Sub-10ms onchain event indexing.
  - **Alchemy (1k USD credits):** Resilient Monad RPC infrastructure.
  - **Monad Community (5k USD):** High-impact Metropolis open-source contribution.
- **Roadmap & Sprint Execution:** Complete 4-week execution plan available in [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## 9. Quality Gates & Linting

```bash
# Run zero-mock integrity checks, UI interaction safety contract, and typechecks
make lint

# Run sub-second production build
npm run build

# Validate ERC-7730 clear signing descriptors against canonical Monad deployment
node scripts/validate-erc7730.mjs
```

---

## License
MIT License. See [LICENSE](LICENSE) for details.
