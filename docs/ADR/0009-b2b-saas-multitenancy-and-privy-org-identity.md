# ADR 0009: B2B SaaS Multi-Tenancy, Single-Org Identity & Privy Organization Governance

## Status
Accepted (Target: Hackathon Phase 2 Integration)

## Context
AgentGuard operates as an institutional agentic risk, spend control, and execution guardrail platform. In enterprise deployments, organizations run fleets of autonomous agents across internal departments and external client boundaries.

Two architectural models were evaluated for enterprise identity:
1. **Consumer / Multi-Org Switcher Model**: Users belong to multiple organizations and must toggle active workspaces via an organization switcher dropdown.
2. **Dedicated B2B SaaS Model**: Each authenticated user belongs to **exactly one organization** tied to their enterprise domain, SSO, or corporate Privy invite (`orgId: "acme_ai"`).

Furthermore, autonomous agents execute in headless cloud environments (Docker, Kubernetes, AWS Lambda) where human browser authentication via Privy or MetaMask is impossible. The system must support both **Human Operators** (Privy email/SSO) and **Machine Identities** (Headless Service Accounts).

## Decision

We adopt a **Single-Organization B2B SaaS Multi-Tenant Architecture** with Privy for identity verification and PostgreSQL 18 as the authoritative tenant authorization store:

1. **Single-Organization Identity Binding**:
   - Every user is bound to a single corporate tenant. The header displays the enterprise organization badge (`🏢 Acme AI Systems • Enterprise Tier`) without the cognitive load of a switcher.
   - All fleet agents, budget pools, team members, rate cards, and audit ledgers automatically resolve within this isolated tenant boundary.
2. **Privy Identity and Optional Routing Metadata**:
   - The gateway verifies the Privy JWT subject, issuer, audience, signature, expiry, and not-before claims.
   - An optional `orgId` metadata value may help route a lookup, but it is not an authorization claim:
     ```json
     {
       "sub": "did:privy:cmton65ao004l0cl11tgmwiah",
       "email": "sarah@acme.ai",
       "custom_metadata": {
         "orgId": "org_acme_corp_8f2a",
         "orgName": "Acme AI Systems",
         "tier": "enterprise"
       }
     }
     ```
   - PostgreSQL resolves and authorizes the active organization membership, role, MFA state, enterprise address, and operator status. Missing or ambiguous membership fails closed.
3. **Tenant-Scoped Authorization Proxy (`services/gateway`)**:
   - The master Privy App Secret remains strictly on the server-side within the Gateway.
   - Tenant administrators manage roles through the authenticated gateway endpoint; PostgreSQL is committed first and is the sole authorization source.
   - The gateway may mirror the committed role to Privy metadata, but mirror failure cannot roll back or weaken the PostgreSQL authorization decision. Any cross-tenant mutation is rejected with HTTP 403 Forbidden.
4. **Machine-to-Machine Service Accounts**:
   - Autonomous bots authenticate using headless Bearer API Keys (`ag_live_sec_...`) mapped to an onchain Monad agent address (`0xAgent`).
   - Service accounts are bound to specific `BudgetPool` slots and cannot access the human administrative console.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Enterprise Authentication & Scoping Flow                        │
└────────────────────────────────────────────────────────────────────────────────────────┘

    [ Human Operator (Browser) ]                 [ Autonomous Cloud Bot (Headless) ]
                 │                                                │
                 │ 1. Privy SSO / Email Login                     │ 1. Bearer ag_live_sec_...
                 ▼                                                ▼
     [ Signed Privy JWT Claim ]                      [ EIP-712 Intent or API Secret ]
     { sub: "did:privy:...", org_hint: "org_acme" }               │
                 │                                                │
                 └───────────────────────┬────────────────────────┘
                                         ▼
                 ┌───────────────────────────────────────────────┐
                 │       AgentGuard Gateway (Rust / Axum)        │
                 │  - Resolves tenant boundary from PostgreSQL    │
                 │  - Evaluates Monad PolicyEngine (<1ms)        │
                 │  - Commits authoritative role state           │
                 └───────────────────────┬───────────────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         ▼                               ▼
            [ Privy Cloud Metadata ]       [ Monad Parallel EVM (10143) ]
            (Optional routing/mirror)      (Disjoint storage per agent)
```

## Consequences

### Positive
- **Zero Cross-Tenant Leakage**: All queries, state mutations, and audit records are hard-partitioned by `orgId`.
- **Frictionless Enterprise UX**: Eliminates workspace switcher clutter; employees log in and immediately enter their corporate fleet.
- **Strict Least Privilege**: Human operators have RBAC roles (`treasury`, `sec_ops`, `agent_developer`), while bots have headless service accounts restricted strictly to execution.

### Negative / Trade-offs
- Users wishing to collaborate across multiple independent companies must maintain separate login emails/identities.
- Privy metadata is limited to an optional organization routing hint and is never an authorization dependency.

### Architectural Alignment (ADR-0012 & ADR-0013)
* The enterprise single-org identity model established here directly maps to `agentAdmins` and `treasuryBalances` in **ADR 0012** and **ADR 0013** (`CircuitVault.sol`).
* Enterprise tenant admins control the $O(1)$ `tripCircuitBreaker` authority and unbonding cooldown parameters for their fleet.
