# AgentGuard Architecture & System Design Blueprint

> Rendered C4 diagrams (system context, containers, components, deployment) live in [`ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md); the ASCII art below is kept for a quick terminal-readable overview.

## 1. Executive Summary & Core Principles

**AgentGuard** is a programmable risk management, spend control, and reputation layer designed for autonomous AI agents executing payments on the **Monad Parallel EVM** (Chain ID `10143`, 400ms block time, 800ms deterministic finality). It natively bridges HTTP 402 agentic payment frameworks (such as x402 and Google AP2) with onchain deterministic risk policies.

AgentGuard is governed by four core architectural mandates:

1. **Strict Zero-Mock Mandate**: All fleet states, window spends, reputation metrics, and risk decisions derive from onchain contract calls or authentic EIP-712 cryptographic proofs.
2. **Disjoint Per-Agent State Partitioning**: To eliminate Monad parallel EVM worker abort loops under optimistic concurrency control (OCC), each agent's execution state is packed into a single disjoint 32-byte storage slot (`PackedState`). Concurrent payments by different agents never touch overlapping storage keys.
3. **Instant $O(1)$ Short-Circuit Kill Switch**: When an agent is compromised or trips safety thresholds, an administrator or authorized automated watcher sets `killSwitch = true`. All subsequent transactions by that agent abort in $O(1)$ time with typed `ReasonCode.ERR_KILL_SWITCH` before running loop or arithmetic checks.
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
│  │   • Private Key in KMS/TEE/Env  │   EIP-712 SpendRequest           │   • Pre-flight Policy Sim    │  │
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
│  │   • Tenant Isolation & PoLP (`My Agents` vs `Network Fleet`)                                      │  │
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

AgentGuard returns standardized integer reason codes (`ReasonCode`) defined in [`IPolicyEngine.sol`](../contracts/src/interfaces/IPolicyEngine.sol) to enable autonomous agent error-handling without parsing brittle string revert messages:

| Code | Identifier | Explanation | Agent Mitigation Action |
| :--- | :--- | :--- | :--- |
| `0` | `ERR_NONE` | Request permitted and recorded | Proceed with payment execution |
| `1` | `ERR_KILL_SWITCH` | Agent kill switch is tripped/active | Enter safe mode; notify human supervisor |
| `2` | `ERR_MAX_PER_TX` | Requested amount exceeds `maxPerTx` | Split payment into smaller chunks |
| `3` | `ERR_MAX_PER_WINDOW` | Rolling window spend limit reached | Back off until rolling window expires |
| `4` | `ERR_VELOCITY_EXCEEDED` | Maximum transaction frequency in window exceeded | Throttle / rate limit request dispatch |
| `5` | `ERR_MERCHANT_NOT_ALLOWED` | Destination address not in whitelist | Request merchant whitelisting |
| `6` | `ERR_BUDGET_DEPLETED` | Organizational/pool budget exhausted | Await treasury refill or budget extension |
| `7` | `ERR_EXPIRED` | Request timestamp past deadline | Generate fresh signature with new deadline |
| `8` | `ERR_NONCE_REUSED` | Replay protection failure / out-of-order nonce | Increment nonce and re-sign |
| `9` | `ERR_SIGNATURE_INVALID` | EIP-712 cryptographic signature invalid or signer unauthorized | Verify agent private key & signature parameters |

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

---

## 6. Multi-Tenant Architecture & Principle of Least Privilege (PoLP)

AgentGuard implements strict tenant scoping to uphold the Principle of Least Privilege across enterprise environments:

### A. Tenant Isolation Model
- **`My Agents` (Default Isolated View)**: Shows exclusively the agents registered, owned, or assigned to the authenticated operator. New users starting without agents see a clean, zero-mock onboarding state with no data leakage from other tenants.
- **`Network Fleet` (Administrative Global View)**: Visible only to `super_admin`, `sec_ops`, and `auditor` for fleet-wide telemetry, network risk analysis, and macro policy monitoring.
- **Role-Based Access Control (RBAC)**:
  - `agent_developer`: Default authenticated role. Empowered with self-serve agent provisioning, policy authoring for owned agents, and dedicated kill-switch toggle authority.
  - `super_admin`: Full global fleet management, IAM governance, and emergency freeze.
  - `sec_ops`: Threat mitigation, risk telemetry, adversarial testing, and kill-switch activation.
  - `treasury`: Budget pools, spend ceilings, and merchant allowlists.
  - `fleet_devops`: Fleet orchestration, telemetry, and runtime monitoring.
  - `auditor`: Read-only compliance inspection, ledger verification, and report export.

---

## 7. Autonomous Agent Key Management & Lifecycle Architecture

### A. Architectural Separation: Human Operator vs. Autonomous Agent
A foundational principle of AgentGuard is that **agents cannot share private keys with human operators**:
- **Human Controller (Privy Embedded / External Wallet)**: Used for governance, policy creation, kill-switch tripping, and administrative treasury management.
- **Autonomous Agent (Dedicated Keypair)**: Operates independently in machine runtimes, headless microservices, or TEE enclaves to sign x402 HTTP requests and EIP-712 micro-settlements without manual human prompts.

```
┌───────────────────────────────────────────────────────────┐
│               1. HUMAN CONTROLLER (Privy)                 │
│  • Authenticates via Email / Passkey / Social             │
│  • Configures PolicyEngine on Monad:                      │
│    setPolicy(agentAddress, maxPerTx, maxPerWindow, ...)   │
│  • Holds Emergency Kill Switch Authority                  │
└─────────────────────────────┬─────────────────────────────┘
                              │ Registers Policy for
                              ▼
┌───────────────────────────────────────────────────────────┐
│              2. AUTONOMOUS AGENT KEYPAIR                  │
│  • Distinct address: 0xAgent...                           │
│  • Provisioned client-side via Web Crypto or KMS/TEE      │
│  • Signs typed EIP-712 SpendRequests autonomously         │
│  • Executed via AgentWalletGuard on Monad (Chain 10143)   │
└───────────────────────────────────────────────────────────┘
```

### B. Client-Side Non-Custodial Key Generation
During agent onboarding in the Web Control Plane:
1. `generatePrivateKey()` uses browser Web Crypto (`crypto.getRandomValues`) to produce a cryptographically secure secp256k1 keypair locally.
2. The private key is displayed to the developer **once** alongside an exported `.env` configuration snippet.
3. The address and metadata are saved to the user-scoped tenant store (`agentVault.ts`) in browser storage. The browser does NOT act as an ongoing transaction signer for the agent; the agent signs independently in its own runtime.

### C. Self-Hosted OpenSigner Enclave Architecture (`services/opensigner`)

For institutional and enterprise deployments requiring that raw private keys never touch client code, disk files in plaintext, or LLM agent memory, AgentGuard provides a self-hosted signing enclave microservice (`services/opensigner`, Port `3001`):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Self-Hosted OpenSigner Enclave Container                  │
│                                                                             │
│   HTTP Ingress (Port 3001)                                                  │
│   ├── POST /api/v1/wallets               ──► Generate secp256k1 Keypair     │
│   │                                          Derive Wallet ID               │
│   │                                          Seal in AES-256-GCM Vault      │
│   │                                          Persist to /data/wallets.json  │
│   │                                                                         │
│   └── POST /api/v1/sign-spend-request    ──► Unseal in-memory               │
│                                              Verify Wallet ID & Agent match │
│                                              Sign EIP-712 Typed Data        │
│                                              Zero plaintext key exposure    │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Cryptographic Vault & Key Derivation**:
   - **Cipher**: AES-256-GCM authenticated symmetric encryption with 96-bit random IVs and 128-bit authentication tags.
   - **Key Derivation Function**: Master encryption keys are derived from `OPENSIGNER_MASTER_KEY` using `scrypt` ($N=16384, r=8, p=1, dkLen=32$) with unique per-vault salts to resist GPU-accelerated dictionary attacks.
   - **Atomic Persistence**: Vault state is written atomically via temporary files before renaming (`fs.renameSync`) to guarantee zero corruption during unexpected power cuts or container termination.

2. **Isolated EIP-712 Programmatic Signing**:
   - The enclave signs EIP-712 `SpendRequest` intents targeting the Monad Parallel EVM (Chain ID `10143`, verifying contract: `AgentWalletGuard`).
   - The signing engine unseals the private key into memory for the duration of the signature computation and returns only the canonical `0x`-prefixed 65-byte ECDSA signature (`r`, `s`, `v`).
   - Private keys are never returned across HTTP interfaces and are omitted from all logs.

3. **Enterprise Key Management Interoperability**:
   - In addition to the local self-hosted OpenSigner container, AgentGuard architecture cleanly abstracts the signing interface to support:
     - **AWS KMS / Google Cloud KMS**: Cloud HSM-backed secp256k1 key rings.
     - **Confidential TEE integration boundary**: A provider-backed attestation service may be added later; the current OpenSigner deployment makes no hardware-isolation claim.
     - **Turnkey / Openfort**: Multi-party computation (MPC) and policy-controlled session signers.

---

## 8. Modern EIPs & Agentic Blockchain Primitives (Non-Proxy)

AgentGuard avoids upgradeable storage proxies (e.g. ERC-1967) to eliminate global implementation slot read contention on Monad's Parallel EVM. Instead, extensibility and modularity are achieved via native standard EIP primitives:

| Primitive | Contract / Service | Architectural Function |
| :--- | :--- | :--- |
| **ERC-1271** | [`AgentWalletGuard.sol`](../contracts/src/core/AgentWalletGuard.sol) | Validates Safe smart accounts, DAOs, and threshold clusters via `isValidSignature(bytes32,bytes)`. |
| **EIP-2612 / EIP-3009** | [`AgentWalletGuard.sol`](../contracts/src/core/AgentWalletGuard.sol) | `executeGatedPaymentWithPermit` bundles permit approvals with gated settlement in a single atomic transaction without prior `approve()` calls. |
| **EIP-7702** | [`AgentDelegationAccount.sol`](../contracts/src/core/AgentDelegationAccount.sol) | Immutable target contract for Pectra/Prague EOA delegation. Enforces `PolicyEngine` spend limits directly within the delegating EOA context. |
| **ERC-7579** | [`AgentGuardHookModule.sol`](../contracts/src/core/AgentGuardHookModule.sol) | Modular account hook (`type 4`) and validator (`type 1`) for Kernel, Safe ERC-7579, and Biconomy. Runs pre-checks via `PolicyEngine` and post-checks via `ReputationRegistry`. |
| **EIP-6551** | [`AgentIdentityRegistry.sol`](../contracts/src/core/AgentIdentityRegistry.sol), [`AgentAccount.sol`](../contracts/src/core/AgentAccount.sol) | Deterministic Token Bound Account registry. Binds the agent's wallet address, spend policy, and reputation score to an ERC-721 NFT passport. |
| **ERC-7677** | [`services/gateway`](../services/gateway) | Standard JSON-RPC Paymaster RPC endpoints (`pm_getPaymasterStubData`, `pm_getPaymasterData`) enabling gasless stablecoin agent transactions. |
| **TEE Attestation** | [`EnclaveAttestationRegistry.sol`](../contracts/src/core/EnclaveAttestationRegistry.sol), [`services/opensigner`](../services/opensigner) | Explicit provider integration boundary. OpenSigner returns `ATTESTATION_UNAVAILABLE` until hardware quote verification is configured. |
