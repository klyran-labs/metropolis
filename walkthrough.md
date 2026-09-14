# Architecture and verification walkthrough

This repository contains a tenant-isolated SaaS control plane and a platform administration surface for policy-governed agent settlement on Monad.

## Runtime profiles

The backend and control plane support exactly three profiles:

- `local`: a Docker Monad devnet using chain ID `10143`.
- `testnet`: Monad Testnet using chain ID `10143`.
- `mainnet`: Monad Mainnet using chain ID `143`.

Each profile has its own compose file, environment template, and deployment manifest. The gateway fails closed when the manifest is missing, unprovisioned, inconsistent with the profile, or missing deployed bytecode.

## Backend authority

PostgreSQL 18 is authoritative for tenant membership, tenant roles, platform roles, plan catalog, subscriptions, payment lifecycle, and billing ledger entries. A subject can have one active tenant membership. Privy verifies identity; its metadata is only an optional routing hint.

All generated identifiers use PostgreSQL or application UUID v7. Tenant authorization is enforced before tenant-scoped queries, and platform routes use a separate platform-role capability matrix.

## Onchain boundary

Solidity owns policy evaluation, kill switches, spend state, reason codes, reputation, and guarded settlement. The gateway reads policies and receipts from the configured Monad RPC. Policy writes return authorized calldata to the connected tenant wallet, preserving non-custodial signing.

Subscription checkout creates an idempotent payment intent containing the exact EIP-712 spend request. The client signs and submits approval plus guarded settlement, waits for approval receipt finality, and submits the settlement hash. The gateway confirms the receipt only when it targets the configured guard and contains the expected `PaymentExecuted` event values; only then are the subscription and ledger entry activated atomically.

## Control plane

The frontend was replaced with a compact React 19/Vite application using Tailwind CSS, TanStack Query/Table/Virtual, Apache eCharts, and a shared Material 3-inspired token layer. Tenant views cover overview, fleet registration, onchain policy authoring, subscription settlement, and server-authoritative settings. Platform views cover plan publication, tenant directory, and confirmed billing ledger visibility.

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
