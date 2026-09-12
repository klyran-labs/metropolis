# AgentGuard Production Readiness Plan

Review posture: Principal Web3 fintech and platform architect. This plan treats AgentGuard as a non-custodial control plane for autonomous-agent payments on Monad Testnet (chain 10143). Production ready means observable, recoverable, secure, accessible, and truthful when chain data is unavailable.

## Current assessment

The repository has a promising domain split—Solidity policy engine, shared domain types, x402 middleware, and a React control plane—but is not yet production ready.

P0 gaps:

- Contract addresses and deployment artifacts need one authoritative, environment-specific source; no synthetic defaults may reach a deployment build.
- The web control plane must load fleet, policy, spend state, reputation, and audit history from indexed chain data. A connected wallet alone is not a fleet registry.
- All writes need explicit authorization, chain verification, transaction lifecycle states, receipt links, retry safety, and post-confirmation refresh.
- Audit Ledger needs event indexing and reorg-aware confirmation; local-only audit records are not evidence.
- CI must install the exact Foundry dependency and run Solidity tests/invariants, TypeScript tests, build, lint, security scans, and zero-mock checks.
- x402 verification must always receive the deployed AgentWalletGuard address; shared packages must not hide a fallback verifying contract.

## Target architecture

1. **Domain layer** — pure policy value objects, reason-code mapping, spend invariants, and authorization rules. No React, RPC, database, or protocol-specific logic.
2. **Protocol adapters** — Viem/Monad adapter for reads and writes; x402/AP2 adapters for HTTP negotiation; Privy adapter for identity and wallet providers.
3. **Control plane API/indexer** — consume policy, kill-switch, spend, reputation, and payment events. Store block number, transaction hash, log index, chain ID, and finality status. Handle retries, duplicate logs, reorgs, and backfills.
4. **Web application** — query-driven screens with explicit loading, empty, stale, unavailable, unauthorized, pending, confirmed, and failed states. Never infer a record from a form submission.
5. **Operations** — centralized structured logs, metrics/traces, alerting, incident runbooks, key rotation, deployment attestations, and rollback procedures.

## Production navigation and information architecture

Use a stable left navigation with one primary action per screen:

- **Overview** — fleet health, policy coverage, blocked requests, pending transactions, and data freshness.
- **Agents** — searchable agent registry; agent detail is the canonical place for policy, wallet, state, reputation, and actions.
- **Policy Studio** — edit one policy at a time with a human-readable summary, validation, dry-run evaluation, change diff, approval, and onchain confirmation.
- **Payment Simulator** — renamed from “Rogue Agent Simulator”; evaluate a user-entered real intent read-only. It must not invent merchants, amounts, signatures, scenarios, or settlements.
- **Audit Ledger** — indexed, filterable, exportable evidence with reason codes, transaction status, confirmations, and explorer links.
- **Settings** — network, contract deployments, team roles, approval rules, notification policy, and API credentials.

Global UI rules: use “Allowed/Denied,” “Policy evaluation,” “Agent wallet,” “Spend state,” “Kill switch,” “Transaction pending/confirmed/failed,” and “Chain data unavailable.” Avoid prototype language such as “simulation complete,” “finality” for RPC latency, “registered” before confirmation, and “reputation” when no registry outcome exists. Every destructive action requires confirmation, reason, and an accessible result announcement.

## Enterprise feature roadmap

### Phase 0 — Release integrity (P0)

- Remove every runtime mock, hardcoded test address, fake balance, fake hash, local audit record, and fabricated reputation value.
- Make deployment configuration fail closed when RPC, Privy, chain, or contract addresses are missing or invalid.
- Pin Node, npm, Foundry, Solidity compiler, dependencies, and forge-std; make CI reproduce a clean checkout.
- Add contract deployment manifests with code hash, chain ID, deployer, timestamp, and verification URL.

### Phase 1 — Safe core (P0/P1)

- Add role-based access control, multisig/timelock administration, policy-change approvals, emergency pause, and bounded configuration updates.
- Verify all EIP-712 domain fields against the deployed guard and chain ID; enforce deadline, nonce, replay protection, and signature reason codes.
- Add invariant/fuzz tests for kill switch, window rollover, overflow, whitelist behavior, nonce reuse, disjoint agents, and denial-code completeness.
- Add idempotency keys and receipt-confirmation workflows for all writes.

### Phase 2 — Data and operations (P1)

- Ship a reorg-aware event indexer with cursor checkpoints, backfill, deduplication, finality policy, and chain-health monitoring.
- Add OpenTelemetry traces, RPC latency/error metrics, policy decision counters by reason code, transaction confirmation SLOs, and alert routing.
- Add encrypted secret management, least-privilege service identities, dependency/SBOM scanning, SAST/DAST, and independent smart-contract audit gates.
- Define RPO/RTO, backup/restore drills, incident severity matrix, and operational runbooks.

### Phase 3 — Enterprise control plane (P1/P2)

- Organizations, teams, RBAC/ABAC, SSO/SAML/OIDC, SCIM provisioning, tenant isolation, and immutable administrative audit logs.
- Four-eyes approvals for policy changes and treasury actions; configurable limits by agent, merchant, category, time window, and environment.
- Versioned policies, diff history, rollback, scheduled activation, webhooks/API integrations, rate limits, and signed export packages.
- Accessibility conformance (WCAG 2.2 AA), localization/time zones, responsive layouts, keyboard navigation, and performance budgets.

## Definition of done

- npm test, npm run build, Solidity tests/invariants, lint, typecheck, security scans, and zero-mock checks pass from a clean checkout.
- No production bundle contains synthetic addresses, generated transaction hashes, fake balances, or fabricated chain records.
- Every displayed record has a source, chain ID, block/confirmation status, timestamp, and stale-data behavior.
- Critical journeys are tested end-to-end: connect, discover agent, create policy, approve/write, confirm, evaluate, kill switch, recover, and inspect audit evidence.
- Load tests demonstrate agreed p95/p99 RPC and indexer SLOs; chaos tests cover RPC failures, wallet rejection, duplicate delivery, reorg, and partial outage.
- Security, accessibility, privacy, and smart-contract review sign-offs are attached to the release artifact.

## Immediate implementation sequence

1. Commit the Foundry dependency mapping and make clean CI compile contracts.
2. Finish removing fallback addresses and fake EIP-712 configuration; add tests that fail on prohibited patterns.
3. Replace local audit state with indexed events and make the UI show honest empty/stale states.
4. Add transaction state machines and role/approval checks to policy and kill-switch writes.
5. Implement the navigation above, then validate each critical journey with keyboard, screen reader, mobile, and failure-state testing.
