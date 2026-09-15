# Architecture and verification walkthrough

This repository contains a tenant-isolated SaaS control plane and a platform administration surface for policy-governed agent settlement on Monad.

## Runtime profiles

The backend and control plane support exactly three profiles:

- `local`: a Docker Monad devnet using chain ID `10143`.
- `testnet`: Monad Testnet using chain ID `10143`.
- `mainnet`: Monad Mainnet using chain ID `143`.

Each profile has its own compose file, environment template, and deployment manifest. The gateway fails closed when the manifest is missing, unprovisioned, inconsistent with the profile, or missing deployed bytecode.

The local profile is bootstrapped by `make docker-up`: an ignored Anvil mnemonic and deployer account are generated first, Docker Anvil starts with that account, the deployment flow publishes the core contracts and zero-supply local settlement token, and the resulting addresses are written to the ignored `.env.local` before application images are built.

## Backend authority

PostgreSQL 18 is authoritative for tenant membership, tenant roles, platform roles, plan catalog, subscriptions, payment lifecycle, and billing ledger entries. A subject can have one active tenant membership. Privy verifies identity; its metadata is only an optional routing hint.

All generated identifiers use PostgreSQL or application UUID v7. Tenant authorization is enforced before tenant-scoped queries, and platform routes use a separate platform-role capability matrix.

## Onchain boundary

Solidity owns policy evaluation, kill switches, spend state, reason codes, reputation, and guarded settlement. The gateway reads policies and receipts from the configured Monad RPC. Policy writes return authorized calldata to the connected tenant wallet, preserving non-custodial signing.

Subscription checkout creates an idempotent payment intent containing the exact EIP-712 spend request. The client signs and submits approval plus guarded settlement, waits for approval receipt finality, and submits the settlement hash. The gateway confirms the receipt only when it targets the configured guard and contains the expected `PaymentExecuted` event values; only then are the subscription and ledger entry activated atomically.

## Control plane

The frontend has been elevated into a **Tier-1 Modern SaaS Control Plane** built on React 19, Vite 8, TanStack Router, TanStack Table, and TanStack Virtual:

- **Dual-Bar Navigation Shell**:
  - **Slim 56px Left Icon Rail** (`SlimIconRail`): Ultra-dense vertical icon navigation with brand mark, active indicators, and tooltips.
  - **Top Control Bar** (`TopBar`): Workspace context switcher breadcrumbs, primary CTA (`+ New Agent`), `Cmd+K` Omni-Search trigger, AI Copilot quick launcher, live ambient Monad Finality Beacon (`● Monad Testnet · 400ms`), and user avatar profile menu.
  - **Horizontal Subheader Bar** (`SubheaderTabs`): Pill navigation across workspace sections (`Overview`, `Fleet`, `Treasury`, `Policy`, `Billing`, `Settings`) paired with Cancun transient storage epoch telemetry.
- **Executive Highlights & Posture Grid**:
  - **Operational Posture Hero**: Swift agent provisioning and spend governance overview.
  - **Executive Highlights Card**: All-time protected spend headline metric, delta trend badge (`+2.7%`), multi-segment stacked allocation progress bar (Sovereign Enclaves, Connected Wallets, Treasury Pools, Parallel Relayers), and itemized channel breakdown.
- **High-Density Fleet Table & Master-Detail Inspection**:
  - Dense virtualized fleet table with inline search filter (`Search agents, tiers, vaults...`).
  - **Master-Detail Slide-Over Drawer** (`AgentInspector`): 440px slide-over sheet inspecting Monad disjoint storage slots (`PackedPolicy` 32-byte word), real-time spend velocity meters, wallet fund loads/unloads, and reason code audit trails.
- **Emergency O(1) Circuit Breaker & Undo Primitive**:
  - Emergency halt control short-circuiting parallel EVM execution in $O(1)$ time.
  - 5-second reversible countdown Undo Toast (`UndoToastContainer`).
- **AI Risk Copilot** (`AICopilot`):
  - Natural language policy compiler that synthesizes spend limits into live generative action widgets.
  - Plain-English diagnostic assistant for standardized Monad reason codes (Codes 1 through 9).
- **Omni-Command Palette** (`CommandPalette`):
  - Global `Cmd+K` keyboard shortcut for instant fuzzy navigation, agent actions, and theme switching.

The brand is configuration-driven through `VITE_BRAND_NAME`; domain-oriented source filenames do not repeat the brand.

## Verification

The authoritative gates are:

```bash
npm test
npm run build --workspace=@agentguard/web
cargo test --manifest-path services/gateway/Cargo.toml
cargo clippy --manifest-path services/gateway/Cargo.toml --all-targets -- -D warnings
forge fmt --check --root contracts
forge test --root contracts
```

Migration scripts are stored in `services/gateway/migrations` and are validated against PostgreSQL 18 during release verification.
