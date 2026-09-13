# Implementation Plan: Circuit Protocol SaaS Architecture

**Dual-Track Engineering Plan: Authoritative Rust Backend & SaaS-Grade React 19 Frontend**

---

## 1. Executive Summary & Architectural Separation

In enterprise security architecture, **access control enforced only on the frontend is a cosmetic illusion**. 

To guarantee un-bypassable security:
* **The Rust Backend (`services/gateway`) is the AUTHORITATIVE ENFORCEMENT ENGINE**: It evaluates RBAC roles, PBAC declarative policies, and dynamic ABAC environmental attributes in Tower middleware before any request touches memory or broadcasts to the Monad blockchain.
* **The React 19 Frontend (`apps/web`) is the USER-CENTRIC CONTROL PLANE**: It presents high-density SaaS views, manages optimistic UI state transitions (`useOptimistic`), renders visual policy builders, and exposes live SSE telemetry without developer leaks.

Below are the two distinct, decoupled implementation plans.

---

# PART A: BACKEND IMPLEMENTATION PLAN (Rust / Axum)

### Objective
Build an asynchronous, high-throughput Rust service (`services/gateway`) that acts as the zero-trust policy gateway, SSE telemetry broadcaster, and Monad Parallel EVM settlement relayer, enforcing **RBAC, PBAC, and ABAC** at the network boundary.

---

### A.1. Tri-Vector Access Control Engine in Rust

```
┌────────────────────────────────────────────────────────────────────────┐
│                   RUST AXUM AUTHORIZATION PIPELINE                     │
└────────────────────────────────────────────────────────────────────────┘

 [ Incoming Request (REST API / Intent Payload / WebSocket / SSE) ]
                         │
                         ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ TOWER MIDDLEWARE: `TenantContextLayer` & `AuthClaimsExtractor`        │
 │ - Decodes Privy JWT / Bearer API Key (`cir_live_sec_...`)            │
 │ - Extracts: `org_id`, `user_id`, `role`, `clearance_level`, `mfa`    │
 │ - Rejects invalid or expired signatures with HTTP 401 Unauthorized   │
 └───────────────────────┬──────────────────────────────────────────────┘
                         │
                         ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ TOWER MIDDLEWARE: `RbacEnforcerLayer`                                │
 │ - Asserts principal role satisfies baseline action capability       │
 │ - Rejects unauthorized role mutations with HTTP 403 Forbidden        │
 └───────────────────────┬──────────────────────────────────────────────┘
                         │
                         ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ IN-MEMORY EVALUATOR: `PbacEngine` (Policy-Based Access Control)      │
 │ - Evaluates declarative JSON rules (Cedar / Rego format) in Rust     │
 │ - Checks target resource pattern and multi-signature requirements    │
 │ - If action requires dual-approval: checks active multisig ticket    │
 └───────────────────────┬──────────────────────────────────────────────┘
                         │
                         ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ DYNAMIC CONTEXT EVALUATOR: `AbacEngine` (Attribute-Based Control)    │
 │ - Evaluates 4 contextual vectors:                                    │
 │   1. Subject: MFA presence, IP CIDR, SSO department                  │
 │   2. Resource: Agent risk tier (`critical` vs `sandbox`)             │
 │   3. Action: Gross amount ceiling, calldata selector blacklist       │
 │   4. Environment: Monad base fee, time-of-day trading window         │
 └───────────────────────┬──────────────────────────────────────────────┘
                         │ (ALL PASSED)
                         ▼
    [ Route Handler / Monad CircuitVault Alloy Dispatcher ]
```

#### 1. RBAC Layer in Rust (`services/gateway/src/auth/rbac.rs`)
* **Role Representation**:
  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
  pub enum Role {
      SuperAdmin,
      SecOps,
      Treasury,
      FleetDevops,
      AgentDeveloper,
      Auditor,
      Custom(u32), // Reference to custom enterprise role definition
  }
  ```
* **Capability Matrix Check**: Middleware verifies permissions such as `can_trip_circuit_breaker`, `can_modify_treasury`, `can_manage_iam`.

#### 2. PBAC Engine in Rust (`services/gateway/src/auth/pbac.rs`)
* **Declarative Rule Schema**:
  ```rust
  #[derive(Debug, Clone, Serialize, Deserialize)]
  pub struct PbacPolicy {
      pub id: String,
      pub org_id: String,
      pub effect: PolicyEffect, // Allow | Deny
      pub principals: Vec<String>,
      pub actions: Vec<String>,
      pub resources: Vec<String>,
      pub conditions: PbacConditions,
  }
  
  #[derive(Debug, Clone, Serialize, Deserialize)]
  pub struct PbacConditions {
      pub max_amount: Option<u128>,
      pub required_multisig_signatures: Option<u8>,
      pub eligible_approver_roles: Vec<Role>,
  }
  ```
* Evaluates incoming actions against the enterprise's stored policy graph cached in `DashMap<String, Vec<PbacPolicy>>` in sub-microsecond time.

#### 3. ABAC Context Evaluator in Rust (`services/gateway/src/auth/abac.rs`)
* **Dynamic Context Struct**:
  ```rust
  pub struct AbacContext {
      pub client_ip: IpAddr,
      pub mfa_authenticated: bool,
      pub agent_environment: AgentEnvironment, // Production | Staging | Sandbox
      pub agent_risk_tier: RiskTier,           // Tier1Critical | Tier2Standard | Tier3Test
      pub transaction_amount: u128,
      pub function_selector: [u8; 4],
      pub monad_base_fee: u128,
      pub current_timestamp: u64,
  }
  ```
* Enforces environmental policies (e.g. "Reject high-value allocations if Monad base fee > 50 gwei or outside 09:00–17:00 EST").

---

### A.2. Per-Tenant Isolation Engine in Rust (`services/gateway/src/tenant.rs`)
1. **Tenant-Scoped Context**:
   * Every request context contains `TenantContext { org_id: String, enterprise_address: Address }`.
   * All database queries, in-memory caches, and fleet lookups use compound keys: `(org_id, agent_address)`.
   * **Zero Cross-Tenant Leakage**: Rejects any request attempting to access or mutate an entity where `entity.org_id != context.org_id`.
2. **Dedicated Relayer Gas Pools**:
   * The gateway maintains thread-isolated ephemeral sub-relayer wallets sharded by `org_id` and `thread_id` to eliminate nonce collisions and lock contention.

---

### A.3. Streaming Telemetry & Monad RPC Pipeline (`services/gateway/src/telemetry.rs`)
1. **SSE Endpoint (`GET /api/v1/telemetry/stream`)**:
   * Utilizes `tokio::sync::broadcast` channel to broadcast real-time JSON events to connected frontend clients:
     - `CircuitBreakerTripped { agent, authority, timestamp }`
     - `SpendEvaluated { agent, provider, amount, allowed, reason_code }`
     - `EpochAllocated { agent, provider, epoch, cap }`
     - `UnilateralChallengeStarted { agent, session_id, block_number }`
2. **Alloy Monad Event Listener**:
   * Subscribes to Monad Testnet (`10143`) WebSocket logs, parsing EVM custom errors (`PolicyEvaluationFailed(uint8)`) directly from simulation buffers and transaction receipts.

---

# PART B: FRONTEND IMPLEMENTATION PLAN (React 19 + Vite 8)

### Objective
Discard all legacy prototype demo UI code and build an institutional, SaaS-grade enterprise control plane in `apps/web` utilizing modern React 19 primitives, dark-mode financial design tokens, and capability-gated workflows.

---

### B.1. Six Core Enterprise Modules

#### 1. Flight Deck (`FlightDeckView.tsx`)
* **Executive Cockpit**:
  * Global Solvency Gauge: Displays real-time ratio: $B_{\text{Vault}} \ge A_{\text{Epoch}} + C_{\text{Relayer}}$.
  * Real-Time Programmatic Velocity Ticker: Tokens/sec and USD/hr stream via SSE.
  * Active Circuit Breakers Indicator: Number of quarantined agents with 1-click global emergency halt.

#### 2. Fleet Operations Grid (`FleetOperationsGrid.tsx`)
* **High-Density Agent Data Grid**:
  * Paginated table supporting 1,000+ agents with search, status filters, and risk tier badges.
  * Instant $O(1)$ Circuit Breaker Switch with **React 19 `useOptimistic`**: Updates UI to `FROZEN` in 0ms while the background Rust API dispatches to Monad.
  * Live spend velocity meters against hourly rate cards and token caps.

#### 3. Epoch Clearing Studio (`EpochClearingStudio.tsx`)
* **Visual Clearinghouse for `CircuitVault.sol`**:
  * Active Provider Epoch Buckets (Anthropic, OpenAI, AWS, custom RPCs).
  * Monotonic Spend Progress Bars (`cumulativeSettled` vs `cumulativeSpent` vs `allocatedCap`).
  * Live Dispute Challenge Monitor: Countdown timer for the 200-block unilateral challenge window.
  * Terminal Receipt Inspector: Two-way cryptographic signature verification visualizer.

#### 4. Telemetry & Cognitive Intercepts (`TelemetryInterceptView.tsx`)
* **Live ReasonCode Event Feed**:
  * Decoded EVM Custom Error badges (`ERR_SPEND_LIMIT_EXCEEDED`, `ERR_UNAUTHORIZED_TARGET`).
  * Deterministic Fallback Traces (L1: Model Downgrade, L2: Alt-Solver, L3: HITL Escalation).
  * 1-Click Human-in-the-Loop (HITL) approval modal to sign EIP-712 override vouchers.

#### 5. FinOps & Treasury Custody (`FinOpsTreasuryView.tsx`)
* **Enterprise Float & Rate Cards**:
  * Treasury Deposit & Timelocked Withdrawal module (with 30-minute unbonding timer).
  * Rate Card Configurator: Flat Custom Discount, Tiered Volume Ladders, Committed-Use PTUs.

#### 6. Governance & Access Management (`GovernanceAccessView.tsx`)
* **Enterprise Access Control Studio**:
  * **RBAC Role Matrix**: Displays 6 built-in roles and capability checkboxes + Custom Role Creator.
  * **PBAC Visual Rule Builder**: Author declarative Cedar/Rego-style JSON policies with multi-signature triggers.
  * **ABAC Environmental Controls**: IP CIDR whitelist editor, trading hours scheduler, gas ceiling inputs.
  * **Audit Ledger & SOC2 Export**: Cryptographically verifiable event log with 1-click PDF/CSV attestation export.

---

### B.2. Frontend Component Architecture & Cleanup

#### Deprecated Files to Remove:
* `RogueAgentSimulator.tsx`, `FleetDemoController.tsx`, `SimulatorView.tsx`, `AutonomousAgentPlayground.tsx`.

#### Core Application Shell:
* `CircuitConsole.tsx`: Main authenticated SaaS shell with top-level organization badge, SSE live stream connection, keyboard-first `Cmd+K` command palette, and modular sub-view routing.

---

# PART C: INTEGRATION & VERIFICATION PLAN

### Automated Testing Matrix
1. **Rust Backend Tests (`cargo test`)**:
   - `test_rbac_middleware_enforcement`: Asserts auditor role cannot call `trip_circuit_breaker`.
   - `test_pbac_rule_evaluation`: Asserts >$10k allocation requires dual-signature approval ticket.
   - `test_abac_environmental_rejection`: Asserts requests outside allowed IP CIDR return HTTP 403.
   - `test_tenant_isolation_boundary`: Asserts Tenant A cannot read Tenant B's fleet or audit logs.
   - `test_sse_telemetry_broadcast`: Asserts live broadcast channel delivers transaction events to subscribers.
2. **Frontend React 19 Tests (`npm test`)**:
   - Verify zero developer terminology leaks (no raw ports, no docker jargon, no stack traces).
   - Test optimistic UI toggle on Circuit Breakers (`useOptimistic`).
   - Test RBAC capability gating on buttons and navigation tabs.
   - Zero `Math.random` across all frontend files.
3. **End-to-End Build**:
   ```bash
   npm run typecheck
   npm run build
   cargo check --workspace
   npm test
   ```

---

# Principal Architect Review: Part A Execution Gate

## Review Result

Part A is directionally correct but is not implementation-ready against the current repository. The existing gateway has x402 parsing, EIP-712 recovery, a direct `PolicyEngine.evaluate` RPC call, and Privy role administration, but it does not yet provide the authorization pipeline, durable tenant boundary, telemetry stream, or settlement relayer described above.

The following repository facts are merge-blocking constraints:

1. `services/gateway/src/privy.rs` only decodes JWT payloads; it does not verify the JWT signature, issuer, audience, expiry, or Privy's signing-key rotation. Accepting the current path in production would permit forged operator claims.
2. `AppState.local_roles` is keyed only by DID and has a local/default-viewer fallback. It is not a tenant-safe source of truth and must not be used for production authorization.
3. No `TenantContext`, RBAC middleware, PBAC evaluator, ABAC evaluator, service-account store, API-key verifier, or request authorization decision model exists in the gateway.
4. The current role names and defaults do not match the six-role hierarchy mandated by `AGENTS.md` (`super_admin`, `sec_ops`, `treasury`, `fleet_devops`, `agent_developer`, `auditor`).
5. The Rust `ReasonCode` mapping diverges from `contracts/src/interfaces/IPolicyEngine.sol`: the contract uses `ERR_EXPIRED = 7` and `ERR_NONCE_REUSED = 8`, while Rust assigns `Expired = 8`, omits nonce reuse, and adds `Custom = 10`. The Solidity interface is the canonical onchain source; no fabricated or silent code may be introduced.
6. `CircuitVault.sol`, its deployment artifact, and its ABI are not present. The current contracts expose `PolicyEngine` and `AgentWalletGuard`, so a CircuitVault relayer/listener cannot truthfully be implemented until that contract is supplied and deployed.
7. Existing local/testnet compose defaults and deployment manifests contain synthetic or environment-inappropriate addresses and a development private key. Production and testnet startup must fail closed unless deployment-specific values are supplied from an authoritative manifest or environment.
8. The current successful baseline is limited to five gateway crypto/auth parsing tests: `cargo test --manifest-path services/gateway/Cargo.toml` passes, but it does not exercise HTTP middleware, tenant boundaries, policy authorization, SSE, RPC event ingestion, or settlement.

## Revised Part A Scope

The implementation will be split into independently verifiable backend increments. Each increment must be fully wired into the Axum router, configuration, container/deployment manifests, tests, and operational documentation before it is considered complete. No in-memory fallback will be enabled in production.

### A0. Contract and configuration truth

* Make chain ID, RPC endpoints, contract addresses, merchant address, Privy configuration, and signing/relayer configuration explicit and environment-specific.
* Remove hardcoded fallback addresses and development private keys from gateway configuration and deployment manifests. Local development may use a generated local deployment manifest, but it must be produced by the deployment flow and validated against chain code, never invented in application code.
* Load and validate the authoritative deployment manifest at startup; verify chain ID and deployed bytecode for required contracts before readiness becomes healthy.
* Correct the Rust Solidity bindings to use the exact deployed `SpendRequest` and reason-code definitions, including `uint256 nonce` and `ERR_NONCE_REUSED = 8`.
* Treat `CircuitVault` as a hard dependency only after its Solidity source, ABI, deployed address, and event/error signatures exist. Until then, Part A may implement the existing PolicyEngine/AgentWalletGuard path, but must not advertise CircuitVault settlement as available.

### A1. Verified identity and request context

Create an explicit `RequestContext` assembled by one authentication layer before protected handlers run:

* Verify Privy JWTs using cached JWKS, issuer/audience checks, expiry and not-before checks, and bounded key-refresh behavior. Do not retain `decode_jwt_payload` as an authentication path.
* Support machine identities only through a persisted, hashed API-key record with organization, agent address, status, expiry, and scoped capabilities. Never store or log plaintext API keys.
* Extract `org_id`, `user_id`/DID, role, MFA state, clearance, subject address, and identity kind into typed claims.
* Reject ambiguous or conflicting identity headers. Development-only caller headers must be compiled/configured out of production and must never grant elevated access in a production environment.
* Redact credentials, JWTs, private keys, and raw authorization payloads from logs and error responses.

### A2. Tenant, RBAC, PBAC, and ABAC authorization

Implement pure, allocation-conscious domain evaluators behind repository traits:

* `TenantContext` is mandatory for every non-public route. All agent, policy, audit, service-account, and telemetry queries use `(org_id, agent_address)` or an equivalent tenant-owned key.
* RBAC uses exactly the six mandated built-in roles and an explicit capability matrix. Role mutation requires the appropriate administrative capability and cannot cross organizations.
* PBAC evaluates versioned, tenant-owned allow/deny policies with action/resource matching, amount limits, approver-role requirements, and dual-approval ticket state. Deny rules take precedence and policy evaluation must be deterministic.
* ABAC evaluates typed subject, resource, action, and environment attributes. IP/CIDR, MFA, risk tier, environment, transaction amount, function selector, gas ceiling, and trading-window checks must be explicit and fail closed when required attributes are unavailable.
* Authorization must produce a structured decision containing allow/deny, policy version, matched rule IDs, tenant identity, and a non-zero machine-readable denial code. Chain `ReasonCode` values remain exactly aligned to the Solidity enum; offchain authorization denials use a separately versioned access-denial taxonomy rather than overloading or fabricating onchain spend codes.
* Use a durable production policy/tenant repository. An in-memory implementation is permitted only as an injected test repository and must not be reachable from production startup.

### A3. Route protection and tenant-scoped APIs

* Apply the authorization layers to role administration, policy/kill-switch mutation, fleet reads, audit reads, telemetry subscriptions, and settlement dispatch before handler state access.
* Add explicit tenant-scoped routes for fleet/policy/audit reads and mutations. A requested organization or agent that is not owned/assigned to the authenticated organization returns a structured forbidden response without revealing whether the record exists.
* Add idempotency keys and authorization decision correlation IDs to all state-changing operations. Return transaction lifecycle states (`submitted`, `pending`, `confirmed`, `failed`) only from real RPC/receipt observations.
* Keep public health/liveness responses free of private contract details. Readiness must report dependency status without exposing secrets or raw RPC errors.

### A4. Telemetry and chain event ingestion

* Add a bounded `tokio::sync::broadcast` event hub with tenant-filtered subscriptions and explicit lag/disconnect behavior.
* Add an Alloy chain listener for the events that actually exist on the deployed contracts (`SpendEvaluated`, `SpendRecorded`, `KillSwitchUpdated`, payment events, and related indexed logs). Decode logs from verified ABI definitions, retain chain ID/block/transaction hash/log index, deduplicate, and apply the configured finality policy.
* Add reorg handling and cursor checkpoints before exposing events as confirmed evidence. A disconnected or stale listener must surface an honest unavailable/stale state; it must not fabricate telemetry.
* Expose `GET /api/v1/telemetry/stream` as an authenticated, tenant-filtered SSE endpoint with heartbeat, retry metadata, and no cross-tenant event delivery.
* Implement CircuitVault event support only after the contract readiness gate in A0 is satisfied.

### A5. Monad policy evaluation and settlement boundary

* Reuse a shared provider/client rather than constructing an RPC provider per request. Bound concurrency, timeouts, and retries; classify RPC failures without converting them into policy denials.
* Keep read-only policy evaluation separate from state-changing settlement. The latter must use an explicit relayer/transaction state machine, chain/contract verification, nonce strategy, receipt confirmation, retry/idempotency rules, and no custody of user or agent master keys.
* Shard relayer state only by an actually provisioned organization/agent or transaction domain. Do not claim thread-isolated wallets without a real key-management and nonce-reconciliation design.
* Preserve atomic onchain authorization: no offchain PBAC/ABAC allow may bypass `PolicyEngine` or `AgentWalletGuard`, and every onchain denial must carry the canonical non-zero reason code.

### A6. Verification and operational integration

Add deterministic tests before each increment is merged:

* signed Privy JWT acceptance/rejection, JWKS rotation, expiry, audience/issuer, API-key hashing and revocation;
* six-role capability matrix, PBAC deny precedence, dual approval, ABAC CIDR/MFA/time/gas/risk checks;
* tenant A/B isolation for reads, writes, SSE, audit records, and service accounts;
* canonical reason-code parity against the Solidity interface and denial-schema completeness;
* HTTP middleware ordering and protected-route tests using an in-process Axum router;
* event decoding, deduplication, finality, cursor recovery, reorg behavior, SSE filtering, lag, and disconnect tests;
* real-RPC integration tests gated by an explicit configured endpoint and deployment manifest, never synthetic responses;
* container/deployment startup tests proving missing production configuration fails closed and prohibited address/private-key patterns are rejected.

Update `services/gateway/README.md`, `docs/runbooks/gateway-operations-runbook.md`, the relevant ADRs, compose/Kubernetes manifests, and deployment artifacts in the same change. Completion requires `cargo test`, `cargo check`, formatting/lint checks, and the repository's zero-mock gates, with every new route and capability reachable from the deployed service.

## Approval Gate

Before implementation begins, explicitly confirm:

1. approval of this revised Part A scope and the fail-closed configuration changes;
2. whether the implementation should include the missing `CircuitVault.sol` contract/deployment work, or stop the relayer/listener at the existing `PolicyEngine`/`AgentWalletGuard` boundary until an authoritative CircuitVault deployment is supplied;
3. the production persistence target for tenant, PBAC/ABAC, service-account, idempotency, and event-index data (for example, the repository's intended database or another approved durable store).
