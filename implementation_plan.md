# AgentGuard End-to-End Improvement Plan

## Status and approval gate

Status: **Approved; implementation substantially complete; deployment validation remains external.**

This plan was the implementation boundary for the current AgentGuard review. The user explicitly approved it before production, contract, gateway, OpenSigner, deployment, and frontend changes began.

The repository contained existing uncommitted work. That work was treated as user-owned and preserved through targeted patches without resetting unrelated edits.

### Implementation result

The approved P0/P1/P2 slices are implemented across the settlement contracts, Rust gateway, OpenSigner, frontend, deployment configuration, release checks, and documentation. Provider-backed hardware attestation and provisioned testnet/mainnet manifests remain deployment-dependent. Gateway bulkheads/quotas, a repeatable p99 profile, and route-level frontend code splitting are now implemented; the current benchmark records local measurements rather than making a production SLO claim.

Implemented controls include agent-bound CircuitVault signatures and dispute targets, expiry and checked arithmetic guards, sealed OpenSigner route scoping and caller-signature recovery, real-provider failure propagation, onchain paymaster eligibility with configured gas bounds, transactional FinOps synchronization, subject-scoped frontend state, bounded event indexing, non-blocking JWKS refresh, explicit CORS, and an aggregate `check:all` release command.

## Executive verdict

AgentGuard has a substantial end-to-end foundation: Solidity policy, wallet, vault, paymaster, and reputation components; an Axum/Rust gateway with PostgreSQL persistence; an OpenSigner service; React/Vite control-plane screens; deployment manifests; and CI coverage across Node, Rust, Foundry, and frontend build checks.

The current implementation is **not yet safe to describe as production-ready on a live network** because deployment, provider-backed attestation, and external provider credentials have not been validated here. The previously identified trust-boundary and financial-correctness issues have been remediated in code and regression-tested:

1. CircuitVault voucher signatures are bound to the session agent/provider/epoch and reject mismatch, expiry, replay, and arithmetic overflow.
2. OpenSigner exposes only scoped operations; generic typed-data signing, arbitrary transfers, and synthetic attestation are removed or fail closed.
3. Gateway inference and paymaster routes propagate real dependency failures and use configured onchain eligibility checks.
4. FinOps synchronization uses transactional durable ledger updates and strict authoritative pricing decoding.
5. Frontend failure paths use honest empty/error states, configured chain reads, and subject-scoped identity state.

The remaining release work is operational: provision real deployment manifests, install a provider-backed attestation verifier, and run the complete smoke/load profile against those provisioned dependencies. Performance changes are benchmark-led and tied to measured p95/p99 behavior.

## Verified baseline

The following checks were run during the read-only review and passed:

- `npm test`: 65 Node tests plus frontend typecheck.
- `cargo test --manifest-path services/gateway/Cargo.toml`: unit, integration, and doc tests passed.
- `forge test -vv`: 45 Solidity tests passed.
- `npm run build`: production build passed; route-level dynamic imports and vendor splitting reduced the entry surface, while the optional wallet/chart vendor chunks remain intentionally large.
- `npm run lint`, `npm run lint:gateway`, `cargo clippy`, contract/TypeScript lint, and zero-mock lint passed.
- `git diff --check` passed.

The green baseline does not cover the highest-risk cases. The JavaScript contract parity suite is explicitly a hand-written simulator; it does not compile or execute the Solidity implementation. The current aggregate `npm test`/preflight path also does not run the full Rust and Foundry suites as one mandatory gate.

Final validation after implementation:

- `npm test`: 66 tests passed plus frontend typecheck.
- `npm run lint`: zero-mock, UI/theme, ERC-7730, Solidity static/Foundry, TypeScript, and Rust clippy gates passed.
- `npm run build`: all workspaces and Vite production build passed; the existing approximately 1.7 MB minified frontend chunk warning remains.
- `cargo test --manifest-path services/gateway/Cargo.toml`: 7 unit tests and 16 integration tests passed.
- `cargo clippy --manifest-path services/gateway/Cargo.toml --all-targets -- -D warnings`: passed.
- `forge test --root contracts`: 45 Foundry tests and the invariant suite passed.
- `npm run test --workspace=@agentguard/opensigner`: 5 tests passed; `git diff --check` passed.
- `npm run bench:gateway`: repeatable local profile passed and reported p50/p95/p99/p99.9 for fixed-point spend and concurrent tenant admission.

## Prioritized findings and remediations

### P0 — CircuitVault voucher signer is not authenticated

Evidence: `contracts/src/core/CircuitVault.sol`, `_verifySessionVoucher` and the merchant voucher submission path around the current lines 326–339 and 457–491.

The recovered signer is only checked for being non-zero. It is not checked against the authorized agent, session owner, provider, or an ERC-1271 validation path. A valid signature from an unrelated key can therefore satisfy the voucher check and influence merchant settlement within the applicable bucket limits. Existing tests model signature validity as a boolean and do not exercise a malicious signer.

Remediation:

- Define one canonical voucher envelope containing agent/session/provider, amount or delta, nonce, deadline, chain ID, verifying contract, and operation type.
- Bind the recovered signer to the authorized session agent and support contract-wallet validation only through an explicit ERC-1271 path.
- Make replay protection and deadline validation part of the same state transition as voucher acceptance.
- Add Foundry tests for wrong signer, zero signer, expired voucher, wrong chain/domain, wrong session/provider, replay, ERC-1271 success, and ERC-1271 failure.
- Update the TypeScript signing descriptor and documentation so the off-chain and on-chain schemas cannot drift.

### P0 — OpenSigner claims synthetic hardware attestation

Evidence: `services/opensigner/src/vault.ts` around `getEnclaveQuote`; `services/opensigner/src/server.ts` around the quote and verification routes.

The quote is generated from deterministic local values and placeholder PCR/signature fields. Verification checks expiry and echoes caller-controlled identity fields, then reports `ATTESTATION_VALID`. This is a trust claim without cryptographic verification or hardware evidence and violates the repository’s zero-mock mandate.

Remediation:

- Select a real attestation provider contract: AWS Nitro, Intel SGX/DCAP, or another supported provider.
- Implement provider-specific quote parsing, certificate-chain validation, measurement policy, nonce binding, expiry, and expected agent identity checks.
- Register only verified measurements through `EnclaveAttestationRegistry` on the configured chain, or return an explicit “attestation not provisioned” state until the provider is configured.
- Remove synthetic PCRs, signatures, and status values from production paths.
- Add adversarial tests for forged signatures, altered measurements, replayed quotes, expired quotes, wrong nonce, wrong agent, and unsupported provider.
- Keep the UI terminology functional and honest: do not present an enclave guarantee when only a software signer is available.

### P0 — OpenSigner signing authority is broader than the stated architecture

Evidence: `services/opensigner/src/server.ts` around `/api/v1/sign-typed-data` and `/api/v1/execute-transfer`; `services/opensigner/src/signer.ts` around `signGenericTypedData` and ERC-20 transfer execution.

The generic endpoint accepts caller-defined domain, types, primary type, and message. The transfer endpoint accepts arbitrary token, destination, and amount. Combined with a static bearer token and permissive `Access-Control-Allow-Origin: *`, a service compromise can become an arbitrary-signing or arbitrary-transfer capability. This contradicts ADR-0014’s narrow-operation design.

Remediation:

- Remove the generic typed-data endpoint from the production API.
- Expose only typed, versioned operations required by the gateway, with strict chain, verifying-contract, token, destination, amount, policy, nonce, and deadline validation.
- Bind every signing request to an authenticated tenant, registered agent, and gateway-issued intent ID.
- Add idempotency keys and persistent nonce coordination for retry-safe execution.
- Replace the static unrestricted bearer model with secret rotation, scoped credentials, and internal-network/origin restrictions.
- Add tests proving arbitrary domains, contracts, tokens, recipients, amounts, and primary types are rejected.

### P0 — Gateway returns fabricated inference success

Evidence: `services/gateway/src/handlers.rs`, current `chat_completions_handler` and `anthropic_messages_handler` paths around lines 3837–4173; `services/gateway/src/qwen.rs`.

The Qwen handler converts upstream failure into HTTP 200 with `policy_allowed` and a null provider response. The Anthropic-compatible handler returns fixed content and fixed token usage without calling Anthropic. A client can therefore receive a successful-looking result without provider execution or authoritative usage accounting.

Remediation:

- Separate policy evaluation, provider execution, settlement authorization, and response delivery into explicit states.
- Return a dependency-unavailable response with a non-zero machine-readable reason code when the provider is missing or fails.
- Implement a real Anthropic provider adapter, including timeout, bounded retries only where safe, response validation, and streaming SSE if the endpoint promises streaming.
- Record actual provider usage and provider request IDs; never synthesize token counts or content.
- Redact upstream bodies and credentials from logs.
- Add tests for missing configuration, upstream timeout, malformed upstream response, provider 4xx/5xx, and successful real-adapter response mapping.

### P0 — Paymaster JSON-RPC is hardcoded and non-functional

Evidence: `services/gateway/src/handlers.rs`, `paymaster_rpc_handler` around lines 4175–4222.

The handler ignores application state, uses a local deployment address, always reports sponsorship eligibility, returns empty paymaster data, and appends a dummy all-zero signature. This is unsafe across chains and can falsely imply that a UserOperation is sponsorable.

Remediation:

- Resolve the paymaster and EntryPoint addresses from the authoritative chain deployment manifest for the active chain.
- Fail closed when the manifest is unprovisioned or the contract cannot be verified.
- Implement actual eligibility checks for chain, agent, policy, treasury/circuit state, gas limits, nonce, and UserOperation shape.
- Return valid paymaster data only after the configured signer has authorized the exact UserOperation; otherwise return a JSON-RPC error with a non-zero reason code.
- Add integration tests for eligible, expired, wrong-chain, wrong-agent, insufficient treasury, circuit-breaker, and unprovisioned-manifest cases.

### P1 — FinOps can acknowledge work without durable correctness

Evidence: `services/gateway/src/handlers.rs` `finops_sync_handler`; `services/gateway/src/finops.rs` `DistributedFinopsSync`; `services/gateway/src/repository.rs` pricing model persistence.

The handler creates a default pricing model when the database lookup fails, ignores the result of consumption persistence, and can return success after an accounting write failed. Distributed sequence tracking is held in an in-memory `HashMap`, so process restarts and multi-instance deployments lose the deduplication authority.

Remediation:

- Propagate database and validation errors; never synthesize a pricing model for a failed read.
- Add a persistent sync ledger keyed by organization, node, sequence, and idempotency key.
- Use a database transaction with an atomic compare-and-set/upsert, consumption record, and acknowledgement state.
- Define retry behavior for duplicate, out-of-order, and gap sequences.
- Add migration, concurrency, restart, duplicate, and partial-failure tests.

### P1 — FinOps arithmetic is floating-point and input validation is weak

Evidence: `services/gateway/src/finops.rs` overage allocation and pricing calculations; `services/gateway/src/repository.rs` model loading and upsert conversion paths.

Micro-dollar accounting uses `f64` for proportional allocation and rounding. Database values are cast from signed integers without complete range validation, and invalid JSON can become defaults. This undermines deterministic settlement and can create under/over-charge drift.

Remediation:

- Use checked `u128` multiplication/division with an explicit rounding policy for all micro-unit calculations.
- Reject negative values, overflow, invalid discounts, unsorted tiers, zero/invalid caps, and ambiguous units at the domain boundary.
- Parse policy currency and limits using integer or fixed-decimal representations.
- Add property tests for conservation, monotonicity, overflow, tier boundaries, discount limits, and repeated calculation determinism.

### P1 — Paid inference path does not settle despite payment-oriented naming

Evidence: `services/gateway/src/handlers.rs` `inference_handler` around lines 3160–3291.

The route performs a read-only policy evaluation and explicitly states that no settlement transaction was submitted. That behavior is honest for a simulation/evaluation route, but it conflicts with adjacent routes and product language that imply paid provider execution and settlement.

Remediation:

- Rename/document the current operation as read-only evaluation, or create a separate paid execution route.
- For paid execution, require a verified AgentWalletGuard authorization/receipt and provider request receipt before claiming success.
- Bind EIP-712 domain, merchant, amount, nonce, deadline, chain, and request ID; persist idempotency state before external retries.
- Represent policy-only, provider-only, payment-pending, settled, and failed states explicitly in shared types and UI.

### P1 — Frontend failure and configuration paths violate zero-mock and tenant-isolation rules

Evidence: `apps/web/src/screens/tenant/PolicySimulator.tsx`, `AgentInspector.tsx`, `Policy.tsx`, `apps/web/src/hooks/usePolicyContracts.ts`, and `apps/web/src/identity.tsx`.

The UI contains zero-address placeholders, a local RPC fallback, a synthetic nonce fallback, and a direct on-chain policy write fallback that can bypass gateway authorization. Simulation failure can be converted into a synthetic denial/quarantine state. Identity cache keys and local storage are not consistently scoped to the authenticated subject, so a prior tenant name or platform-access result can survive an account switch.

Remediation:

- Remove placeholder addresses, default local RPC URLs, synthetic nonce values, and generated snippets that claim settlement without a real receipt.
- Propagate unavailable-chain and unavailable-gateway states as honest empty/error states with functional remediation language.
- Decide whether policy writes are gateway-authorized or wallet-direct; do not silently switch between trust models. Prefer one signed intent flow with a verifiable receipt.
- Scope all query keys and browser-vault/local-storage keys by subject and clear or invalidate them on identity transition/logout.
- Add runtime tests for account switching, chain unavailable, gateway unavailable, failed simulation, rejected transaction, and successful receipt confirmation.

### P1 — Event indexing and gateway dependencies need bounded failure behavior

Evidence: `services/gateway/src/chain.rs`, `main.rs`, and `auth.rs`.

The event listener can request from a historical cursor to `latest` without a bounded window, potentially producing oversized log queries while catching up. It polls with fixed sleep/backoff and has no complete dependency metrics. Readiness verifies contracts on every probe, increasing RPC pressure. JWKS refresh holds the write lock during network I/O. Gateway CORS and headers are broad, while rate limits and per-tenant concurrency controls are not evident.

Remediation:

- Bound event query windows, use a safe/finalized head policy, persist cursor progress, and expose lag/error metrics.
- Add cancellation, exponential backoff with jitter, and alertable listener health state.
- Separate cheap liveness from cached readiness; refresh contract verification on a controlled interval.
- Implement stale-while-revalidate/single-flight JWKS refresh with network I/O outside the shared lock.
- Use explicit CORS/header policies, route-specific body limits, per-tenant rate/concurrency quotas, and provider/RPC bulkheads.
- Benchmark before changing allocators or data structures; preserve correctness and observability as the primary constraints.

### P2 — Test, release, and documentation gates do not fully represent the system

Evidence: root scripts, `Makefile`, `contracts/test/agentguard-contracts.test.mjs`, `.github/workflows/ci.yml`, `docs/GAP_ANALYSIS.md`, and deployment manifests.

The repository has strong individual checks but no single mandatory command that runs Node, frontend, Rust, Foundry, static integrity checks, and build validation together. Some documentation is stale relative to the current repository, while testnet and mainnet manifests remain intentionally unprovisioned.

Remediation:

- Add a `check:all`/release gate that runs the real Solidity, Rust, Node, frontend, zero-mock, lint, build, and diff checks.
- Keep the JavaScript contract parity suite explicitly labeled as a fast model test; require Foundry for authoritative Solidity behavior.
- Add security regression suites for the P0/P1 findings and frontend runtime tests rather than only source-string assertions.
- Extend integrity checks to detect placeholder addresses, fake attestation markers, fixed provider responses/usages, local-RPC fallbacks, and ignored persistence errors.
- Reconcile README, ADRs, gap analysis, runbooks, and deployment manifests with actual provisioning and attestation capabilities.

## Target architecture decisions

### Trust and settlement

Use a single canonical request identity across UI, gateway, signer, and contracts:

`tenant + agent + operation + chainId + verifyingContract + merchant/provider + amount + nonce + deadline + requestId`

The gateway should create and authorize a signed intent, the signer should accept only the narrow intent type, the contract should validate the same fields, and the gateway should report success only after the required on-chain and provider receipts are durable and correlated.

Read-only policy simulation must remain a separate capability from paid execution. Names, response codes, and UI states must make that distinction unambiguous.

### Failure semantics

Every denial or dependency failure must return a non-zero reason code and an honest state. No handler may turn an upstream failure into a successful-looking response, and no UI may turn an RPC failure into an inferred policy result.

### Low-latency execution

Keep the hot path bounded and measurable:

- pre-validate and normalize at the boundary;
- use integer arithmetic and fixed-size identifiers for risk and accounting decisions;
- avoid unbounded RPC log ranges and unbounded in-memory queues;
- isolate slow providers and authentication refreshes with bulkheads;
- instrument p50/p95/p99/p99.9 latency, allocation-sensitive paths, RPC calls, and queue depth;
- only adopt allocator or lock-free changes after a reproducible benchmark demonstrates a tail-latency benefit.

## Phased implementation plan

### Phase 0 — Safety baseline and test harness

- Preserve and inventory all existing user changes.
- Add the aggregate release check command without changing production behavior.
- Add regression-test scaffolding for Solidity adversarial cases, OpenSigner request validation, gateway dependency failures, FinOps transactions, and frontend runtime behavior.
- Add a machine-readable reason-code map shared by contracts, Rust, and TypeScript where one does not already exist.

### Phase 1 — Remove unsafe success and signing behavior

- Fix CircuitVault signer binding, voucher domain, nonce, deadline, and replay behavior.
- Remove synthetic attestation claims or implement a real provider-backed verifier and registry flow.
- Replace generic OpenSigner signing and arbitrary transfer inputs with narrow, authenticated operations.
- Make gateway inference and paymaster routes fail closed and use real configured providers/contracts.
- Remove frontend placeholder/fallback values and direct trust-boundary bypasses.

### Phase 2 — Make settlement and accounting durable

- Implement the explicit evaluate-versus-execute state machine.
- Add receipt correlation, idempotency, durable nonce coordination, and recovery semantics.
- Replace floating-point FinOps math with checked integer arithmetic.
- Add persistent sync sequencing/deduplication and transactional acknowledgements.
- Tighten wallet threshold/grant authorization to the intended treasury/administrative capabilities and document approval requirements.

### Phase 3 — Harden latency and operations

- Bound and instrument event indexing.
- Split liveness/readiness and cache dependency verification.
- Make JWKS refresh non-blocking to authentication readers.
- Add per-tenant quotas, route concurrency controls, provider/RPC bulkheads, and explicit CORS.
- Add Criterion-style or equivalent gateway benchmarks and a repeatable load profile for p95/p99/p99.9 measurements.
- Split large frontend routes/components with dynamic imports and set a bundle-size budget.

Implemented in this review: bounded tenant admission, provider/RPC semaphore bulkheads, explicit `ERR_RATE_LIMITED`, the `gateway_latency` benchmark, route-level React lazy loading, Vite vendor splitting, and tree-shaken ECharts registration with chart subchunks. The web build keeps a measured 550 KB warning budget for Privy's supported shared authentication entry (538.75 KB minified, 155.69 KB gzip); all application and chart chunks remain below 500 KB. The benchmark is intentionally descriptive until it is run on the target production host.

### Phase 4 — Release and documentation integrity

- Update deployment manifests and fail-closed provisioning documentation.
- Reconcile README, ADRs, gap analysis, operational runbooks, and UI copy.
- Add CI enforcement for the aggregate checks and security regression tests.
- Run a final clean-tree review, migration rehearsal, local end-to-end flow, and testnet smoke test only when a real provisioned manifest is available.

## Verification and acceptance criteria

The implementation should not be considered live-production complete until all of the following are true:

- A voucher signed by an unrelated key cannot affect CircuitVault settlement; replay, expiry, domain, and session mismatch tests pass.
- No production endpoint returns synthetic attestation, fixed provider content, fixed usage, dummy signatures, or hardcoded environment-specific contract addresses.
- Provider, RPC, database, and signer failures return explicit non-zero reason codes and do not create false success records.
- Paymaster responses are derived from the active provisioned deployment and exact UserOperation eligibility.
- FinOps results are deterministic, integer-safe, durable, idempotent, and restart-safe.
- Tenant and identity data cannot cross account switches through query caches, local storage, or fallback state.
- The full aggregate quality gate passes: Node, frontend typecheck/build, Rust tests/clippy, Foundry tests, lint, zero-mock/integrity checks, and diff validation.
- Benchmark results document p50/p95/p99/p99.9 behavior for gateway admission and spend evaluation; production RPC/provider latency must be measured separately against provisioned dependencies, and no latency claim is made without a measured result.
- Documentation accurately states which chains are provisioned, which signing/attestation capabilities are available, and which flows are simulation-only.

## Approval record

The user approved the plan and requested end-to-end implementation. The repository implementation and local validation are complete for the in-scope code changes; live-network attestation, deployment, provider, and load validation remain explicitly external follow-ups.

## UX hardening tranche

The control plane now includes a consequential-action review flow for policy publication, a reusable transaction lifecycle status component, safe operator-facing error translation, keyboard-operable fleet and telemetry rows, accessible policy/agent/copilot drawers, and wallet settlement status visibility. These changes preserve real onchain and API data sources while making approval boundaries, failure remediation, and confirmation state explicit.

Remaining UX follow-ups are product expansion rather than hidden correctness gaps: a persistent incident inbox, fleet bulk operations, saved views, and block/finality freshness indicators sourced from the gateway telemetry contract. The first-run readiness checklist is now implemented from real organization and telemetry state.
