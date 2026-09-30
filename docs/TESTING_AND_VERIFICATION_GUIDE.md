# AgentGuard: Testing, Verification & Monad Deployment Guide

This document is the authoritative engineering reference for validating, testing, and deploying **AgentGuard** across all architectural tiers: from low-level Monad Parallel EVM contract invariants to multi-container live infrastructure, autonomous micro-payment gateways, and institutional enterprise control planes.

---

## 1. Multi-Tier Verification Hierarchy

AgentGuard employs a 4-tier testing pyramid engineered to ensure sub-millisecond execution safety, mathematical correctness, zero-state write collisions, and zero-mock enterprise integrity.

```
                    ┌────────────────────────────────────────┐
                    │  Tier 4: Live E2E Integration Suite    │
                    │  (scripts/test-e2e.mjs — 20 Checks)    │
                    │  Cross-Service, Enclave & Settlement   │
                    └───────────────────┬────────────────────┘
                                        │
                    ┌───────────────────▼────────────────────┐
                    │  Tier 3: Service & Component Suites    │
                    │  (npm test — 66 Tests in <500ms)       │
                    │  x402, OpenSigner, MCP, React UI, RBAC │
                    └───────────────────┬────────────────────┘
                                        │
                    ┌───────────────────▼────────────────────┐
                    │  Tier 2: Formal Invariants & Fuzzing   │
                    │  (npm run test:forge — 45 Suites)      │
                    │  64,000 State-Space Calls, Fuzz Tests  │
                    └───────────────────┬────────────────────┘
                                        │
                    ┌───────────────────▼────────────────────┐
                    │  Tier 1: Static Quality & Lint Gates   │
                    │  (npm run lint — Zero-Mock & UI AST)   │
                    │  0 Math.random, 0 Fallback Addresses   │
                    └────────────────────────────────────────┘
```

---

## 2. Comprehensive Architectural Use-Case Coverage Matrix

| Domain | Specific Capability / Scenario | Verification Mechanism | Test Suite Location | Live E2E Verified? |
| :--- | :--- | :--- | :--- | :---: |
| **1. Policy Engine** | Per-Transaction Spend Ceiling (`maxPerTx`) | Invariant & fuzzing (`ERR_MAX_PER_TX = 1`) | `PolicyEngine.t.sol`, `agentguard-contracts.test.mjs` | **Yes** (Policy set & verified onchain) |
| | Rolling Window Ceiling (`maxPerWindow`, `windowSeconds`) | Invariant testing (sliding window reset) | `PolicyEngine.t.sol` | Invariant test suite |
| | Transaction Velocity Limiter (`maxVelocity`) | Invariant state tracking (`ERR_VELOCITY_EXCEEDED = 3`) | `PolicyEngine.t.sol` | `agentguard-fleet-demo.mjs` |
| | Merchant Whitelist Enforcement | State check (`ERR_MERCHANT_NOT_ALLOWED = 4`) | `PolicyEngine.t.sol` | Invariant test suite |
| | $O(1)$ Emergency Short-Circuit Kill Switch | Short-circuit check (`ERR_KILL_SWITCH = 5`) | `PolicyEngine.t.sol`, `test-e2e.mjs` | **Yes** (Instant freeze & restore live) |
| | Disjoint Storage Slot Partitioning | 50 concurrent agent stress tests (0 aborts) | `agentguard-contracts.test.mjs` | Contract test suite |
| | Cancun Transient Reentrancy Protection | `TransientReentrancyGuard.sol` (`tstore`/`tload`) | `PolicyEngine.t.sol` | Contract test suite |
| **2. Reputation Registry** | Settlement Outcome Logging | `ReputationRegistry.sol` append-only logs | `ReputationRegistry.t.sol` | **Yes** (Settlement logged live) |
| | EWMA Dynamic Trust Scoring (PPM Scale) | ADR-0004 mathematical decay invariants | `ReputationRegistry.t.sol`, `test-e2e.mjs` | **Yes** (Score updated to 52.50% live) |
| | Dynamic Slashing & Penalty Decay | Multi-level slashing calculations | `ReputationRegistry.t.sol` | Contract test suite |
| **3. Sovereign Enclave** | Sealed Vault Generation (AES-256-GCM) | Encrypted storage & persistence | `services/opensigner/test` | **Yes** (Sealed in `/data` volume) |
| | Non-Exportable Keypair Lifecycle | Enclave authentication & isolation | `services/opensigner/test` | **Yes** (Client receives address only) |
| | Programmatic EIP-712 Spend Signing | TypedData signature recovery | `services/opensigner/test`, `test-e2e.mjs` | **Yes** (Signed live via `/sign-spend-request`) |
| **4. Autonomous Payments**| HTTP 402 Payment Required Negotiation | Challenge header generation | `packages/x402-middleware`, `test-e2e.mjs` | **Yes** (Gateway challenge verified live) |
| | EIP-712 Spend Authorization Recovery | Rust Axum Gateway (`crypto.rs`) | `services/gateway`, `x402-middleware` | Unit & Parity suites |
| | Reason Code Mapping to HTTP 403 Forbidden | `IPolicyEngine.sol` codes (0–9) | `services/gateway`, `x402-middleware` | Gateway unit tests |
| | Anti-Replay Nonce & Deadline Expiration | `ERR_NONCE_INVALID`, `ERR_DEADLINE_EXPIRED` | `PolicyEngine.t.sol` | Contract test suite |
| **5. Account Abstraction**| ERC-1271 Smart Contract Signature Validation | `isValidSignature` (`0x1626ba7e`) checks | `AgentWalletGuard.t.sol` | Contract test suite |
| | EIP-2612 Gasless Token Permit Forwarding | Permit approval & allowance transfer | `AgentWalletGuard.t.sol` | Contract test suite |
| | EIP-7702 Ephemeral Smart Account Delegation | `AgentDelegationAccount.sol` target | `agentguard-contracts.test.mjs` | Contract test suite |
| | ERC-7579 Spending Guard Hook Module | `AgentGuardHookModule.sol` pre/post checks | `agentguard-contracts.test.mjs` | Contract test suite |
| | ERC-6551 Token Bound Account (TBA) Passport | `AgentIdentityRegistry.sol` TBA resolution | `agentguard-contracts.test.mjs` | Contract test suite |
| **6. Circuit Breakers** | Double-Partitioned Agent Vaults (ADR-0012) | `CircuitVault.sol` balance delta tracking | `CircuitVault.t.sol` | **Yes** (Bytecode verified live) |
| | Dispute Challenge Windows & Stake Slashing | ADR-0013 unilateral challenge resolution | `CircuitVault.t.sol` | Contract test suite |
| **7. Multi-Tenancy** | Principle of Least Privilege (PoLP) Isolation | `fleetScope = 'my_agents'` UI scoping | `apps/web/test/frontend.test.mjs` | Web test suite |
| | Edge Firewall Partitioning (`/admin` Route) | Nginx ingress routing rules | `docker/nginx.conf`, `test-e2e.mjs` | **Yes** (Tenant 404 vs Admin 200) |
| | Strict Security Headers (CSP, X-Frame-Options) | Reverse proxy headers check | `docker/nginx.conf`, `test-e2e.mjs` | **Yes** (CSP & `DENY` verified live) |
| | 6-Tier Institutional RBAC Matrix | Institutional role permissions | `apps/web/src/context/RbacContext.test.tsx` | Web test suite |
| **8. AI Integration** | MCP Server Context Tools | Inspect limits, trip breaker, inspect TBA | `packages/mcp-server/test` | MCP test suite |
| **9. Human Governance** | M-of-N Multi-Operator Quorum (ADR-0014) | High-value spend escalation thresholds | UI approval flows & ADR-0014 design | Governance specification |

---

## 3. Live End-to-End Integration Suite (`npm run test:e2e`)

The live integration suite ([`scripts/test-e2e.mjs`](file:///Users/rahul/development/github/AgentGuard/scripts/test-e2e.mjs)) executes real network requests against all active Docker containers and deployed contracts:

```bash
npm run test:e2e
```

### The 20 Automated Checkpoints:

```
[1/5] Service Connectivity & Operational Health
  ✔ Monad Devnet JSON-RPC is healthy & advancing blocks (Block progression verified)
  ✔ Monad Devnet Chain ID matches canonical Testnet (10143)
  ✔ Rust Axum Gateway /health probe is healthy
  ✔ OpenSigner Sovereign Enclave /health probe is healthy
  ✔ Rust Axum Gateway negotiates live HTTP 402 challenge (Protocol: x402 v1.0)

[2/5] Frontend Edge Defense & Principle of Least Privilege (PoLP)
  ✔ Tenant Web UI serves HTTP 200 with strict CSP headers (CSP & X-Frame-Options validated)
  ✔ Tenant Web UI enforces strict edge firewall: blocks /admin with 404 (PoLP verified)
  ✔ Admin Web UI routes /admin/overview correctly with HTTP 200 (Isolated partition)

[3/5] Monad Parallel EVM Onchain Contract State
  ✔ PolicyEngine.sol contract is deployed & responsive (Bytecode verified)
  ✔ ReputationRegistry.sol contract is deployed & responsive
  ✔ USDC Token contract is deployed with 6 decimals (10^6 precision)
  ✔ CircuitVault.sol contract is deployed & partitioned

[4/5] Sovereign OpenSigner Enclave & Cryptographic Operations
  ✔ OpenSigner authenticated wallet listing succeeds (Sealed AES-256-GCM vault)
  ✔ OpenSigner provision active autonomous keypair for test lifecycle
  ✔ OpenSigner signs EIP-712 SpendRequest for agent with sealed key

[5/5] Autonomous Spend Policy & Circuit Breaker Lifecycle
  ✔ Set onchain spend policy for agent (Max 5.00 USDC / tx) via Viem
  ✔ Read onchain policy confirms limit of 5.00 USDC with active status
  ✔ Activate O(1) emergency kill switch onchain (Instant agent freeze)
  ✔ Reset O(1) emergency kill switch to restore operational state
  ✔ ReputationRegistry records settlement outcome & computes EWMA score onchain (50.00% -> 52.50%)
  ✔ Rust Axum Gateway admits signed x402 payment & enqueues into asynchronous settlement pipeline
  ✔ Rust Axum Gateway NonceSequencer blocks in-flight duplicate nonce (NonceReused (8) blocked in <1ms)
```

---

## 4. Swarm Chaos Engineering & Byzantine Fault-Tolerance (`npm run test:chaos`)

Execute the Byzantine fault-injection harness ([`scripts/chaos-swarm-test.mjs`](file:///Users/rahul/development/github/AgentGuard/scripts/chaos-swarm-test.mjs)):

```bash
npm run test:chaos
```

### The 4 Formal Byzantine Invariants:
1. **Nonce Collision Race (`NonceSequencer`)**:
   - Dispatches 5 concurrent requests with identical agent address and nonce.
   - Formally asserts zero race conditions: exactly 1 request is admitted, while 4 requests are rejected in $<1\text{ms}$ with `ERR_NONCE_REUSED (8)`.
2. **Statistical Anomaly Telemetry (`anomaly.rs`)**:
   - Injects high-frequency sub-second bursts to trigger online $Z$-score drift calculations without halting clean traffic.
3. **Mid-Flight $O(1)$ Emergency Circuit Breaker Freeze**:
   - Trips onchain kill switch while requests are in flight. Verifies immediate rejection with `ERR_KILL_SWITCH (1)` in $<5\text{ms}$.
4. **Disjoint Partitioning & Storage Slot Purity**:
   - Verifies that zero state-write contention occurs across concurrent agent threads on Monad Parallel EVM.

---

## 5. Foundry Invariant & Formal Verification Suite (`npm run test:forge`)

Run the authoritative Foundry invariant suite:

```bash
npm run test:forge
```

### Key Invariants Tested:
1. **Window Spend Invariant** (`PolicyEngineInvariant.t.sol`):
   - Formally proves across 500 fuzzed runs and 64,000 calls that cumulative agent expenditure can **never** exceed the configured `maxPerWindow` ceiling, even under malicious re-ordering or boundary timestamps.
2. **$O(1)$ Kill Switch Dominance**:
   - Asserts that when `killSwitch == true`, `PolicyEngine.evaluate()` and `AgentWalletGuard.executeGatedPayment()` immediately revert/deny with `ERR_KILL_SWITCH (1)` without reading or updating sliding windows.
3. **Cancun Transient Reentrancy Guard**:
   - Asserts that cross-function reentrancy attempts during settlement revert, while transient storage is automatically cleared at transaction boundaries without SSTORE gas costs.
4. **Reputation EWMA Bounds**:
   - Asserts that dynamic trust scores strictly stay within $[0, 1{,}000{,}000]$ (parts-per-million) and that slashing penalizes untrusted counterparties instantaneously.

---

## 5. Monad Public Testnet Deployment Runbook

To deploy and run AgentGuard on the **Monad Public Testnet**, follow these steps:

### 1. Public Testnet Parameters
- **Network Name**: Monad Testnet
- **Chain ID**: `10143`
- **Native Currency**: `MON` (18 decimals)
- **Public RPC Endpoint**: `https://testnet-rpc.monad.xyz`
- **Explorer**: `https://testnet.monadexplorer.com`

### 2. Fund Deployer Account
Verify your account balance on testnet:
```bash
cast balance <YOUR_DEPLOYER_ADDRESS> --rpc-url https://testnet-rpc.monad.xyz
```

### 3. Deploy Protocol Contracts
Execute the deployment script:
```bash
forge script contracts/script/DeployAgentGuard.s.sol:DeployAgentGuard \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key <YOUR_DEPLOYER_PRIVATE_KEY> \
  --broadcast \
  --legacy
```

### 4. Configure Testnet Environment (`docker/.env.testnet`)
Create `.env.testnet` using `docker/.env.testnet.example`:
```ini
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
VITE_RPC_URL=https://testnet-rpc.monad.xyz
POLICY_ENGINE_ADDRESS=<DEPLOYED_POLICY_ENGINE>
REPUTATION_REGISTRY_ADDRESS=<DEPLOYED_REPUTATION_REGISTRY>
AGENT_WALLET_GUARD_ADDRESS=<DEPLOYED_AGENT_WALLET_GUARD>
USDC_TOKEN_ADDRESS=<TESTNET_USDC_ADDRESS>
GATEWAY_MERCHANT_ADDRESS=<MERCHANT_PAYEE_ADDRESS>
PRIVY_APP_ID=cmton65ao004l0cl11tgmwiah
OPENSIGNER_MASTER_KEY=<32_BYTE_HEX_KEY>
OPENSIGNER_API_TOKEN=<32_BYTE_HEX_TOKEN>
```

### 5. Launch the Public Testnet Stack
```bash
docker compose --env-file docker/.env.testnet -f docker/docker-compose.testnet.yml up -d
```

---

## 6. Live Presentation & Demonstration Runbook

When presenting AgentGuard to evaluators or prospective operators, use this streamlined demo flow:

### Step 1: 20-Agent Parallel Fleet Simulation
Run the automated simulation script:
```bash
node scripts/agentguard-fleet-demo.mjs
```
- Demonstrates 20 autonomous agents concurrently operating on Monad.
- Highlights 400ms block processing and zero-contention parallel EVM slot updates.
- Triggers velocity spikes and shows deterministic onchain policy denial.

### Step 2: Interactive Rogue Agent Simulator (UI)
Open **http://localhost:3110** (Tenant Control Plane):
1. Navigate to the **Rogue Agent Simulator** tab.
2. Run **Scenario 1 (Normal Payment)**: observe 400ms approval with `ERR_NONE (0)`.
3. Run **Scenario 2 (Velocity Spike)**: observe instant rejection with `ERR_VELOCITY_EXCEEDED (3)`.
4. Run **Scenario 3 (Limit Breach)**: observe rejection with `ERR_MAX_PER_TX (1)`.
5. Click **Kill Switch** on the agent card: watch subsequent attempts fail in $O(1)$ time with `ERR_KILL_SWITCH (5)`.

### Step 3: Sovereign Enclave & Non-Custodial Architecture
- Show the **Agent Onboarding Modal**: explain that autonomous agents have dedicated keys sealed in OpenSigner ([`services/opensigner`](file:///Users/rahul/development/github/AgentGuard/services/opensigner)).
- Explain keypair separation: human administrators connect via Web3/Privy, while headless bots sign programmatic EIP-712 requests with zero master key transit.

### Step 4: Edge Firewall & Principle of Least Privilege (PoLP)
- Point browser to `http://localhost:3110/admin` $\rightarrow$ Returns **HTTP 404 Not Found** (tenant edge firewall).
- Point browser to `http://localhost:3111/admin/overview` $\rightarrow$ Returns **HTTP 200 OK** (isolated administrative control plane).
