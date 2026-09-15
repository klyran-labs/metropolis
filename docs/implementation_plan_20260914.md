# Implementation Plan: Multi-Tenant SaaS Control Plane

## 1. Principal-architect decisions

AgentGuard is implemented as a database-authoritative, non-custodial SaaS control plane with two product surfaces:

1. A tenant application for fleet governance, policy, audit, telemetry, and subscription management.
2. A platform administration application for plan catalog, tenant lifecycle, subscriptions, billing, and accounting.

PostgreSQL 18 is the system of record for tenant membership, tenant roles, platform roles, policy metadata, subscriptions, payment lifecycle, and accounting entries. Privy authenticates the subject and may provide a non-authoritative routing hint; it never grants a role or tenant membership.

A user has exactly one active tenant membership. Platform roles are held separately in `platform_operators` and are evaluated independently from the six tenant roles.

All durable generated identifiers use PostgreSQL `uuidv7()` defaults or Rust `Uuid::now_v7()`, with `uuid_extract_version(id) = 7` constraints.

New source filenames should describe their domain responsibility (`navigation`, `billing`, `fleet`, `access`) rather than repeat the product brand. The product brand remains configurable through environment and product metadata.

## 2. Runtime profiles

There are exactly three supported runtime profiles:

| Profile | Chain | Compose | Deployment manifest | Startup rule |
| --- | ---: | --- | --- | --- |
| `local` | 10143 | `docker-compose.yml` | `deploy/environments/local/deployment-manifest.json` | Docker Anvil starts first; the deployment flow generates core-contract and zero-supply settlement-token addresses before application startup. |
| `testnet` | 10143 | `docker-compose.testnet.yml` | `deploy/environments/testnet/deployment-manifest.json` | Fails closed until a verified Monad testnet deployment is recorded. |
| `mainnet` | 143 | `docker-compose.mainnet.yml` | `deploy/environments/mainnet/deployment-manifest.json` | Fails closed until a verified Monad mainnet deployment is recorded. |

The gateway requires `AGENTGUARD_PROFILE`, `MONAD_CHAIN_ID`, and `DEPLOYMENT_MANIFEST_PATH`. It validates profile/chain/manifest agreement and verifies bytecode at all required contract addresses before readiness.

## 3. Backend scope

### 3.1 Identity and authorization

- Verify Privy JWT signatures with JWKS caching, issuer, audience, expiry, and not-before checks.
- Resolve tenant membership, tenant role, enterprise address, MFA state, and platform role from PostgreSQL.
- Enforce exactly one active tenant per subject with a database unique constraint.
- Support only hashed, scoped, expiring, revocable machine credentials.
- Apply the six mandated tenant roles: `super_admin`, `sec_ops`, `treasury`, `fleet_devops`, `agent_developer`, `auditor`.
- Apply separate platform roles: `platform_super_admin`, `platform_operations`, `platform_security`, `platform_billing`, `platform_support`, `platform_auditor`, `platform_viewer`.
- Enforce tenant scope before handlers, PBAC deny precedence, typed ABAC checks, and structured non-zero access denial codes.

### 3.2 Tenant APIs

The gateway exposes authenticated, tenant-scoped APIs for:

- fleet registration and reads;
- policy and kill-switch lifecycle;
- audit and finalized chain-event reads;
- telemetry SSE with tenant filtering;
- role changes with idempotency and operation state;
- subscription lookup and checkout.
- authenticated tenant signing-vault provisioning and metadata reads through the gateway;

No route accepts a caller-supplied tenant override. Agent ownership is always resolved through the authenticated tenant.

### 3.3 Platform APIs

Platform-authorized APIs provide:

- real plan and price creation in PostgreSQL;
- tenant and membership administration;
- subscription state and payment lifecycle inspection;
- billing ledger and accounting views.

Plans are not frontend constants and are never seeded with fabricated values. Prices include chain, token, base-unit amount, and billing interval.

### 3.4 Onchain subscription settlement

The current settlement boundary is the verified `AgentWalletGuard` contract. A checkout creates a durable, idempotent payment intent containing the exact EIP-712 `SpendRequest`, configured merchant, token, chain, amount, deadline, and nonce. The client signs and submits the guarded transaction without exposing a master key to the service. The gateway accepts a transaction hash, reads the real receipt, validates the configured guard, success status, and exact `PaymentExecuted` event values, then atomically marks the payment/subscription active and writes one billing ledger entry.

The gateway never reports `confirmed` from a timeout, optimistic client state, or fabricated transaction. CircuitVault is not referenced because its authoritative contract source, ABI, deployment, and event definitions are not present.

### 3.5 Chain ingestion

- Use the shared Alloy provider and bounded JSON-RPC client.
- Decode only events defined by the verified contract interfaces.
- Persist chain, block, transaction, log index, finality, tenant association, and payload.
- Deduplicate events, maintain UUID-free chain cursors by chain, and rewind bounded ranges on reorg evidence.
- Surface stale/unavailable status rather than synthesizing telemetry.

## 4. Frontend replacement scope

The current prototype under `apps/web/src` is discarded and replaced with a compact React 19/Vite application. The replacement is integrated only against the gateway APIs and real Monad reads; there are no demo fleets, random values, fabricated balances, or fake subscriptions.

### 4.1 Shared design system first

Build the shared shell before product screens:

- Material 3 semantic color and elevation tokens;
- light, dark, and system themes;
- spacing tokens 8, 16, 24, 46, and 48, with 46px used for the compact desktop content gutter;
- compact responsive sidenav with icon/label navigation;
- shared buttons, fields, selects, dialogs, tables, badges, empty states, loading states, and error states;
- accessible keyboard focus, reduced-motion behavior, and responsive breakpoints;
- configurable product brand metadata, with domain-oriented filenames.

User-facing copy uses business terminology. It never exposes Docker, containers, daemons, raw ports, library names, stack traces, or development commands.

### 4.2 Tenant application

The tenant application includes:

- overview with real fleet, spend, policy, telemetry, and subscription state;
- fleet operations with tenant-scoped agent registration, policy state, and kill-switch actions;
- policy authoring and onchain transaction lifecycle;
- audit ledger and live telemetry;
- subscription, payment-intent, and receipt status;
- settings for identity, organization controls, roles, PBAC/ABAC, and key lifecycle.

Navigation and actions are capability-gated using server-provided authority. Empty or unavailable data is explicit and actionable.

### 4.3 Platform administration

The platform surface includes:

- plan catalog and real price creation;
- tenant directory and one-tenant membership administration;
- subscription lifecycle and onchain payment receipt monitoring;
- billing ledger, revenue/accounting summaries, and operational audit;
- platform role/access management.

Apache eCharts is used only for real series returned by the gateway. TanStack Query handles server state, TanStack Table handles tabular data, and TanStack Virtual is used where fleet/event volume requires it. The compact shell keeps view state local until deep-link routing is required.

## 5. Verification gates

Backend:

- `cargo fmt --check`
- `cargo check --manifest-path services/gateway/Cargo.toml`
- `cargo clippy --manifest-path services/gateway/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path services/gateway/Cargo.toml`
- migration validation against PostgreSQL 18;
- profile/manifest startup tests;
- HTTP authorization, tenant isolation, payment receipt, and idempotency tests.

Contracts:

- `forge fmt --check --root contracts`
- `forge test --root contracts`
- ABI/event/reason-code parity checks.

Frontend:

- `npm test`
- `npm run build`
- zero `Math.random` runtime usage;
- zero fallback-address usage;
- no technical terminology leaks;
- real API integration tests for tenant and platform paths.

Completion requires all three compose files to parse, production/testnet to fail closed while manifests are unprovisioned, and no obsolete production/staging compatibility paths to remain.

## 6. UI readiness review and required onboarding correction

The current frontend is not yet complete acceptance of the frontend scope above. The following gaps are architectural, not cosmetic:

- A first-time authenticated subject cannot create a tenant. Privy authentication currently fails closed when PostgreSQL has no operator membership, before any tenant-creation capability can be evaluated.
- The UI has no first-run onboarding state or tenant-creation form. The platform view lists tenants but does not create one, and it is reachable only after an existing tenant membership and platform role are already present.
- The dashboard telemetry chart is initialized with an empty series and has no read/query flow. Fleet, policy, and subscription views are partially integrated, but the overview is not a real operational dashboard.
- There is no tenant identity bootstrap, membership confirmation, or actionable distinction between “no tenant yet” and “service unavailable”.

The next approved implementation must therefore add, in this order:

1. An authenticated, pre-membership onboarding route that accepts only the verified Privy subject, creates a PostgreSQL UUID v7 tenant, creates that subject as the sole initial `agent_developer`, and preserves the one-tenant uniqueness constraint. The tenant enterprise address must be proven by the connected wallet signature; it must not be accepted as an unverified label.
2. A narrow no-membership request context allowed only for onboarding and identity-status reads. All tenant and platform data remains unavailable until the transaction commits.
3. A first-run onboarding screen that explains the tenant boundary, collects the display name, proves the enterprise wallet, submits the real request, and refreshes identity state without requiring a manual database operation.
4. A real dashboard read model for tenant health, agent activity, finalized chain events, policy state, subscription/payment status, and telemetry series. Charts must consume returned series or render an actionable empty state; they must never initialize with fabricated or permanently empty demo data.
5. A platform tenant-creation workflow for authorized platform operators, separate from self-service onboarding, plus explicit server-derived capability and status states in the UI.
6. Responsive product-quality visual treatment: navigation hierarchy, tenant identity header, loading/error states, data density appropriate for operations, accessible dialogs/forms, and domain-language copy. Raw records should be rendered as readable operational views rather than JSON blocks.

This correction is required before the frontend scope can be considered complete. Implementation will begin after explicit confirmation of this onboarding/dashboard scope.
