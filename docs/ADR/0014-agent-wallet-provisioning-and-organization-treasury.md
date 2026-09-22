# ADR 0014: Agent Wallet Provisioning, Organization Treasury Wallets, and Load/Unload Flows

## Status
**Accepted; Phase 1/2 code implemented, live deployment validation pending**

## Decisions (finalized)

Investigation while starting implementation surfaced a gap this ADR originally glossed over: the sovereign-wallet path must be explicit about who signs and who broadcasts. The existing checkout flow (`Billing.tsx`) signs *and submits* every transaction from a human's own connected Privy wallet — `wallet.address` stands in for `agent` there, it is never an OpenSigner wallet. OpenSigner now supports only the two constrained transaction shapes documented below, while the gateway's paymaster RPC admits sponsorship only after an onchain eligibility check. So "how does a wallet nobody holds a human key for ever pay gas or move funds" is an explicit deployment choice: Phase 1 sovereign wallets require their own MON balance; paymaster sponsorship is a separately configured path.

Three ways to close that gap, weighed as principal architect:

1. **A gateway-operated meta-transaction relayer** (industry-standard pattern — Defender Relayer / Gelato / Biconomy). Clean in theory, but a plain ERC-20 `transfer()` submitted by a relayer moves funds out of the *relayer's own* balance, not the treasury's — so this only works for Load/Unload if paired with either an EIP-2612 `permit` (requires confirming the settlement token supports it) or a new onchain treasury contract the relayer is authorized to pull from. It also means introducing a brand-new hot key (a relayer private key) into the gateway process with its own nonce-management subsystem — a new category of operational secret.
2. **A new `OrgTreasury.sol` contract** holding tenant funds with an onchain access list. Architecturally the most "correct" long-term answer, but shipping a new, unaudited, funds-holding contract in the same pass as everything else is the least defensible thing to call "production grade" — a money-holding contract deserves its own review cycle, not a rider on this feature.
3. **Extend OpenSigner with two narrowly-scoped, hardcoded transaction shapes it can sign *and broadcast*, gas paid from the wallet's own MON balance.** Not "sign anything" — exactly two fixed call shapes, both of which still flow through the same PolicyEngine enforcement (for Unload) that every other spend in this system already goes through.

**Decision: (3).** It's the only option that adds zero new categories of custody (OpenSigner already holds the key being used) and zero new unaudited contracts, while giving PolicyEngine a real enforcement point on every agent-initiated transfer — including Unload — rather than a bypass. Concretely: OpenSigner exposes `POST /api/v1/execute-treasury-load` only for the configured settlement token and a registered AgentGuard agent, plus `POST /api/v1/execute-gated-payment` for policy-gated unloads. It does not expose generic typed-data signing or arbitrary ERC-20 transfers. Sovereign wallets — both agent and treasury — need a small MON gas balance to submit anything themselves; the Load UI bundles a fixed MON top-up alongside every token transfer into a sovereign wallet so this is never a separate manual step. Paymaster/ERC-4337 and/or an audited `OrgTreasury.sol` remain the real Phase 2/3 answer for fully gasless sovereign wallets — noted here, not silently dropped.

**Approval threshold**: `organization_wallets.approval_threshold INT NOT NULL DEFAULT 1` — the `approval_tickets` M-of-N mechanism is fully wired and enforced by the Load/Unload handlers, not stubbed, but defaults to 1 (no extra approval beyond normal RBAC + wallet access) so Phase 1 is usable immediately. Tenants raise it per wallet from Manage Access.

**Multisig treasury wallets**: supported from day one, not deferred — the ownership-proof verification path used for external treasury registration is extended to accept both ECDSA (`ecrecover`) and ERC-1271 (`isValidSignature`) so a Safe or any smart-contract wallet registers exactly like an EOA.

**Gas for sovereign wallets**: decided above — explicit MON funding, no paymaster dependency for Phase 1.

## Context

Two related gaps surfaced during frontend work on the tenant/admin control plane:

1. **Agent registration requires a pre-existing wallet.** Fleet's "Register an agent" form is a free-text address field ("Provide an existing wallet address"). OpenSigner (`services/opensigner`) generates real secp256k1 keypairs, seals them with AES-256-GCM, and exposes the scoped `/sign-spend-request` flow; generic typed-data signing is intentionally absent. The remaining provisioning and agent-to-wallet lifecycle work is tracked separately from the signing boundary.

2. **The tenant has exactly one wallet, and it's a person's.** `organizations.enterprise_address` is set once, at onboarding, to whichever wallet signed the ownership proof — i.e. the founding operator's personal wallet. `register_agent_handler` hard-requires `admin_address == enterprise_address` (`handlers.rs:1079`), so every agent in a tenant is administratively tied to that one address. There is no concept of an organization-owned treasury distinct from "whoever happened to onboard," no way to register additional org wallets, and no per-wallet access control — anyone with the `treasury` role can act on the tenant's only wallet.

This ADR addresses both, plus the "load/unload" primitive needed to fund and defund agent wallets from an org treasury.

### Prior art already in the repo (and why it changes the design)

ADR-0007 ("Modern EIPs & Agentic Primitives") is marked **Accepted** and describes seven integrated primitives, three of which are directly relevant here and **already written**:

- **ERC-6551 Token-Bound Accounts** (`AgentIdentityRegistry.sol`, `AgentAccount.sol`): an agent's canonical identity is meant to be an NFT; the TBA deterministically derived from it *is* the agent's wallet. `AgentAccount.execute()` gates on `msg.sender == owner()` (NFT holder); `isValidSigner()` implements ERC-1271 by checking the caller against the same `owner()`. Transferring the NFT transfers the wallet's control — this is the system's designed answer to "how do you hand an agent to a different team" and, as this ADR will argue, to key rotation.
- **EIP-7702 delegation** (`AgentDelegationAccount.sol`): lets an EOA delegate its code so *every* outgoing payment from that EOA is natively evaluated against `PolicyEngine`, without a separate guard-contract trust hop.
- **ERC-7677 Paymaster** (`/v1/paymaster` JSON-RPC in the gateway): gasless settlement, which matters directly for "does a freshly generated agent wallet need native MON before it can do anything."

**None of this is deployed.** `deploy/environments/local/deployment-manifest.json` has exactly four contracts: `policyEngine`, `reputationRegistry`, `agentWalletGuard`, `settlementToken`. There is no ERC-721 agent-identity contract, `AgentIdentityRegistry` isn't deployed, `AgentAccount`'s implementation isn't deployed. The gateway's own startup fails closed unless it verifies bytecode at every *required* contract address — so any design that assumes TBAs exist today would violate the project's own zero-fabrication rule the moment someone actually ran it.

That fact shapes this ADR into two phases rather than one design.

## Decision

### Phase 1 — ship now, against what's actually deployed

**Agent wallets are OpenSigner-generated plain EOAs, spent through the existing, already-wired `AgentWalletGuard.executeGatedPayment` path** — the exact mechanism Billing.tsx already uses for subscription checkout. Nothing new is added to OpenSigner's signing surface.

- **Register (auto-generate)**: Fleet's registration form gains a second path. `POST /api/v1/agents` accepts `walletSource: "external" | "sovereign"`. For `sovereign`, the gateway calls OpenSigner's existing `POST /api/v1/wallets` (same call `create_signing_wallet_handler` already makes), gets back a real `{walletId, address}`, and registers the agent against that address in one transaction — writing both `agents` and `signing_wallets` rows, with a new `agents.wallet_id` FK linking them.
- **Load (fund)**: a plain ERC-20 `transfer()` from an organization treasury wallet to the agent's address. No signing capability is needed from OpenSigner — the *source* wallet signs, same pattern as every other onchain action in this app (client-side `eth_sendTransaction` for external wallets; see Phase 1 UI below for the sovereign-treasury case).
- **Unload (sweep back)**: modeled as a **policy-gated spend to a whitelisted merchant**, not a new primitive. The org treasury address is added to the agent's approved-merchant list (the same `whitelistEnabled` dimension Policy.tsx already edits), and OpenSigner signs a normal `SpendRequest` via its existing `/sign-spend-request` endpoint. This is the load-bearing design choice in Phase 1: **OpenSigner never gains a "sign an arbitrary transfer" capability.** Its signing surface stays exactly what it is today — EIP-712 payloads evaluated by `PolicyEngine` — which means sweep-to-treasury carries the identical guarantees as any other agent spend (limits, velocity, kill switch, merchant allowlist all apply). A compromised or over-permissioned "sweep anywhere" endpoint would be a materially larger attack surface than reusing the existing gated-spend path; this ADR explicitly rejects that alternative.
- **Revoke/decommission**: pause the agent (existing kill switch), then run one Unload to sweep remaining balance to treasury. No new mechanism required.
- **Gas**: Phase 1 EOAs need native MON for gas like any EOA. Loading a sovereign agent wallet means sending both the settlement token and a small MON top-up, or wiring the already-built-but-undeployed paymaster (flagged as Phase 1.5 below, not required to ship the core flow).

### Phase 2 — the architecturally correct target: ERC-6551 Token-Bound Accounts

Once an ERC-721 `AgentIdentity` contract and `AgentIdentityRegistry`/`AgentAccount` are deployed and bytecode-verified (a real, separate deployment-and-audit effort — not something to fast-follow casually), agent wallets migrate to TBAs:

- The org mints an `AgentIdentity` NFT and sets its owner to the OpenSigner-generated address. `AgentIdentityRegistry.createAccount(...)` deterministically derives the TBA — *that* address, not the OpenSigner EOA, holds funds and is `req.agent` in every `SpendRequest`.
- `AgentAccount.isValidSigner(signer, ...)` returns valid exactly when `signer == owner()`. Since the OpenSigner address *is* `owner()` (via the NFT), its existing `/sign-spend-request` signatures verify against the TBA through the guard's already-implemented ERC-1271 path (ADR-0007 §1) — zero new contract logic needed for spend, and the sweep-as-policy-gated-spend trick from Phase 1 keeps working unchanged.
- **This is what actually solves key rotation properly.** If an OpenSigner key is ever suspected compromised, the org transfers the identity NFT to a fresh owner — funds never move, only *who can command them* changes, atomically, in one transaction. A raw-EOA model (Phase 1) has no equivalent: compromise means racing to sweep funds before an attacker does.
- Agent handoff between teams, or between tenants in an acquisition/offboarding scenario, becomes an NFT transfer instead of a wallet migration.
- Longer-term: EIP-7702 delegation (`AgentDelegationAccount`) removes the guard-contract indirection entirely, making policy enforcement a property of the EOA itself rather than something a caller has to choose to route through.

Phase 2 is described here so Phase 1's data model doesn't have to be redone — `agents.wallet_id` and `signing_wallets` are designed to be reusable as "the signer," with the TBA address becoming `agents.agent_address` once Phase 2 ships.

## Organization Treasury Wallets

Replaces the single `enterprise_address` model with a proper multi-wallet, access-controlled treasury.

- **New table `organization_wallets`**: `id, org_id, address, label, kind ('external' | 'sovereign'), wallet_id (nullable FK → signing_wallets), status, created_by_subject, created_at`. `organizations.enterprise_address` is left exactly as-is for backward compatibility (existing onboarding-proof semantics, existing bytecode/role checks untouched) and is treated as the tenant's first treasury wallet going forward — not replaced, just no longer the *only* one.
- **Adding a wallet**: two paths, mirroring onboarding's existing ownership-proof pattern.
  - *External*: connect a wallet, sign the same kind of ownership-proof message onboarding already uses (`personal_sign`), submit. No custody change — this covers real multisigs (Safe, etc.) as well as EOAs.
  - *Sovereign*: generate via OpenSigner, identical mechanics to a Phase 1 agent wallet, labeled as a treasury wallet instead of an agent wallet.
- **New table `organization_wallet_access`**: `wallet_id, subject, granted_by_subject, granted_at`. This is the fine-grained layer the user asked for directly: holding the `treasury` role is necessary but not sufficient to act on a *specific* wallet — the wallet must also grant that operator access. `super_admin` bypasses the grant (as it bypasses every other capability check today).
- **Threshold approvals**: the schema already has `approval_tickets` (M-of-N signature collection, currently unused by any handler). Reuse it: any load/unload above a per-wallet configurable threshold requires N-of-M sign-off from operators with access to that wallet before the gateway will prepare the transaction, instead of inventing a new approval primitive.
- **RBAC**: no new roles. `Capability::ManageTreasury` and `Capability::DispatchSettlement` already exist in `rbac.rs` and are already granted to `Treasury` (and implicitly `SuperAdmin`) — they're simply unused by any current handler. This ADR's new endpoints are the first thing that actually exercises them.

## API surface (new/changed)

- `POST /api/v1/agents` — add `walletSource` field as described above.
- `POST /api/v1/organization/wallets` — register a treasury wallet (external proof or sovereign generation).
- `GET /api/v1/organization/wallets` — list, tenant-scoped.
- `POST /api/v1/organization/wallets/:id/access` — grant/revoke an operator's access to a specific wallet (`ManageTreasury` + wallet access itself, or `super_admin`).
- `POST /api/v1/agents/:address/load` — prepare a funding transfer (returns an unsigned/preparable tx for external sources; for sovereign sources, requires `DispatchSettlement` + wallet access + threshold approval if configured).
- `POST /api/v1/agents/:address/unload` — prepare the policy-gated sweep SpendRequest (same shape as existing checkout preparation).
- All of the above follow the existing pattern exactly: the gateway prepares an intent, the real signer (human wallet or OpenSigner) signs, the transaction is submitted, and **only a verified onchain receipt updates state** — no optimistic or fabricated balances, consistent with every other settlement path in this codebase.

## UI/UX design

**Settings → renamed "Organization" section** (was "Sovereign key vault," now a superset):
- **Treasury wallets** list: address (monospace), label, kind badge (External / Sovereign), real onchain balance (read via RPC, not stored/fabricated), access list summary, "Manage access" and "View activity" per row.
- **Add treasury wallet**: two-path modal — "Connect and prove a wallet" (reuses onboarding's proof flow verbatim) or "Generate a sovereign wallet" (calls OpenSigner, shows the resulting address immediately, no private key ever surfaced).
- **Manage access** (per wallet): list of operators with access, add/remove, each grant attributed to who granted it and when — this is the audit trail for "who can move this tenant's money."

**Fleet → Register an agent**: the existing free-text field becomes a choice — "Use an existing wallet" (current behavior, unchanged) or "Generate a sovereign wallet for this agent" (OpenSigner call, address auto-fills, read-only).

**Fleet → agent row**: two new actions, **Load** and **Unload**, enabled once the agent has a wallet on record.
- **Load modal**: choose source treasury wallet (only ones the operator has access to), amount, review real balance/allowance, sign (external) or submit-for-approval (sovereign + threshold), confirmation shows the real tx hash once the receipt is verified.
- **Unload modal**: choose destination treasury wallet, amount (capped at real onchain agent balance), same review/confirm pattern, executed as the policy-gated sweep described above — the UI is explicit that this is a policy-evaluated spend, not a bypass, so a `Blocked` outcome (kill switch, limit) is a normal, expected result the UI must render clearly rather than treat as an error.
- **Activity**: a real, chain-verified log of load/unload events per agent (reusing the same finalized-event rendering pattern Overview already has for telemetry).

Both modals and the treasury screen deliberately reuse existing primitives end-to-end (`TextField`, `Badge`, `Mono`, the EIP-712 signing flow from Billing.tsx, the receipt-polling helper already duplicated across Policy/Billing that should be extracted to one shared `waitForReceipt` during this work) rather than introducing new interaction patterns.

## Threat model summary

| Risk | Phase 1 mitigation |
|---|---|
| OpenSigner key compromise | Blast radius = that agent's current balance + whatever `PolicyEngine` limits allow before someone notices and pauses it. No "sign anything" capability exists to escalate the risk. Phase 2 (TBA + NFT-transfer rotation) is the real fix — flagged, not silently deferred. |
| Insider at AgentGuard drains a sovereign wallet | OpenSigner only signs EIP-712 payloads `PolicyEngine` will still evaluate on submission; sweep destinations must already be an approved merchant. No standing "admin transfer" capability is added. |
| A single operator moves treasury funds unilaterally | `organization_wallet_access` + `treasury`/`super_admin` role + optional `approval_tickets` threshold. |
| Fabricated/optimistic balances in the UI | Every load/unload follows the existing "prepare → sign → submit hash → gateway verifies real receipt → state updates" pattern; balances shown are real RPC reads, never client-computed running totals. |

## Open decisions (need your call before implementation starts)

1. **Confirm Phase 1 scope for now**, with Phase 2 (TBA deployment) tracked separately rather than blocking this work — TBA deployment is a real contract-deployment/audit effort, not a fast-follow.
2. **Threshold for approval_tickets gating** on loads/unloads — a fixed base-unit amount per org, configurable per org, or off by default until explicitly enabled?
3. **Gas for sovereign agent wallets** — require MON top-up alongside every Load in Phase 1, or prioritize wiring the existing (undeployed) paymaster RPC so agents never need native gas at all?
4. Should **external treasury wallets be allowed to be a Safe/multisig from day one**, or EOA-only for Phase 1 with multisig support noted as trivial (ownership-proof signature works identically via ERC-1271) but not explicitly tested until requested?
