# AgentGuard Gateway

The gateway is the authoritative Rust/Axum enforcement boundary for the configured product. It verifies human Privy identities and scoped machine credentials, evaluates tenant RBAC/PBAC/ABAC controls, evaluates the deployed Monad `PolicyEngine`, indexes finalized contract events into PostgreSQL 18, and exposes tenant-filtered SSE telemetry.

The current settlement boundary is `PolicyEngine` and `AgentWalletGuard`. CircuitVault-specific settlement is intentionally unavailable until an authoritative contract source, ABI, deployment address, and verified bytecode manifest are supplied.

## Runtime guarantees

- Privy JWTs are verified with cached RSA JWKS, issuer, audience, expiry, and not-before validation; Privy metadata is never trusted for tenant, role, enterprise address, or MFA authorization.
- Machine credentials are stored only as SHA-256 hashes and are scoped to an organization and agent.
- Every backend-generated identifier and PostgreSQL UUID identifier uses UUID v7 for time-ordered tracing and durable index locality; PostgreSQL rejects non-v7 values.
- Every protected request carries a tenant context resolved from active PostgreSQL membership. Cross-tenant reads, writes, and telemetry delivery are rejected.
- RBAC uses exactly `super_admin`, `sec_ops`, `treasury`, `fleet_devops`, `agent_developer`, and `auditor`.
- PBAC deny rules, approval requirements, and ABAC network/MFA/environment/schedule controls run before handlers access state.
- Onchain reason codes exactly match `contracts/src/interfaces/IPolicyEngine.sol`.
- Chain events are deduplicated by chain, transaction hash, and log index; only finalized events are broadcast as evidence.
- Startup runs PostgreSQL migrations and readiness is unhealthy unless both PostgreSQL and Monad RPC are reachable.

## Endpoints

| Endpoint | Method | Access | Purpose |
|---|---:|---|---|
| `/health` | GET | Public | Liveness only |
| `/ready` | GET | Public | PostgreSQL and Monad dependency readiness |
| `/v1/inference` | GET/POST | x402 EIP-712 | Read-only onchain policy evaluation |
| `/api/v1/telemetry/stream` | GET | Tenant-authenticated | Tenant-filtered finalized event stream |
| `/api/v1/agents` | GET/POST | Tenant-authenticated | Tenant fleet registration and reads |
| `/api/v1/plans` | GET | Tenant-authenticated | Real subscription plan catalog |
| `/api/v1/subscription` | GET | Tenant-authenticated | Current tenant subscription |
| `/api/v1/wallet-transfers/pending` | GET | settlement-authorized | Org-wide transfers awaiting signatures, newest first, cursor-paginated (`limit` 1-100, `cursor`), with SQL totals (`total`, `approvableCount`) and per-operator `canApprove` / `alreadySigned` |
| `/api/v1/subscription/checkout` | POST | Treasury-authorized | Create an onchain payment intent |
| `/api/v1/billing/payments/:payment_id/submit` | POST | Treasury-authorized | Confirm a real guard transaction receipt |
| `/api/v1/platform/plans` | GET/POST | Platform-authorized | Plan catalog administration |
| `/api/v1/platform/tenants` | GET/POST | Platform-authorized | Tenant directory and creation |
| `/api/v1/users/:subject/role` | GET | Tenant-authenticated | Read an in-scope operator role |
| `/api/v1/users/:subject/role` | POST | `super_admin` | Update PostgreSQL role state |
| `/api/v1/tenant/operators` | GET | `super_admin` | List the current tenant membership directory |
| `/api/v1/signing/vault` | GET/POST | tenant policy authority | List or provision tenant-owned sealed signing addresses through OpenSigner |
| `/api/v1/platform/subscriptions` | GET | platform billing capability | List subscription lifecycle state across tenants |
| `/api/v1/platform/billing/ledger` | GET | platform billing capability | List confirmed accounting entries |
| `/api/v1/platform/operators` | GET/POST | platform super admin | Inspect or update platform operator access |

The inference endpoint reports policy approval only. It does not claim that a settlement or upstream inference occurred without a real transaction and provider receipt.

## Required configuration

The gateway fails closed when any required value is missing or invalid.

| Variable | Purpose |
|---|---|
| `AGENTGUARD_PROFILE` | `local`, `testnet`, or `mainnet` |
| `MONAD_CHAIN_ID` | `10143` for local/testnet or `143` for mainnet |
| `DEPLOYMENT_MANIFEST_PATH` | Authoritative profile deployment manifest |
| `MONAD_RPC_URL` | Monad JSON-RPC endpoint |
| `POLICY_ENGINE_ADDRESS` | Deployed PolicyEngine address |
| `REPUTATION_REGISTRY_ADDRESS` | Deployed ReputationRegistry address |
| `AGENT_WALLET_GUARD_ADDRESS` | Deployed AgentWalletGuard address |
| `USDC_TOKEN_ADDRESS` | Deployed settlement token address |
| `GATEWAY_MERCHANT_ADDRESS` | Configured x402 payee |
| `OPENSIGNER_URL` | Internal sovereign signing service endpoint |
| `OPENSIGNER_API_TOKEN` | Gateway-to-vault authentication secret |
| `DATABASE_URL` | PostgreSQL 18 connection string |
| `PRIVY_APP_ID` | Privy application identifier |
| `PRIVY_ISSUER` | Expected Privy JWT issuer |
| `PRIVY_JWKS_URL` | Privy RSA signing-key endpoint |
| `INFERENCE_PRICE_BASE_UNITS` | Configured x402 challenge amount |
| `INFERENCE_SERVICE_ID` | Configured x402 service identifier |
| `INFERENCE_CATEGORY` | Configured x402 category |
| `EVENT_START_BLOCK` | First block included in event backfill |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins permitted by the gateway |

Optional values include `PORT`, `MONAD_FINALITY_BLOCKS`, `EVENT_POLL_INTERVAL_MS`, `PRIVY_JWKS_CACHE_SECONDS`, and `TRUST_PROXY_HEADERS`.

## Development and verification

```bash
cargo fmt --manifest-path services/gateway/Cargo.toml -- --check
cargo check --manifest-path services/gateway/Cargo.toml
cargo test --manifest-path services/gateway/Cargo.toml
```

The local, testnet, and mainnet compose stacks use PostgreSQL 18. Local addresses must come from the local deployment flow; testnet and mainnet remain unavailable until their verified manifests are provisioned. None of the profiles provide synthetic addresses, development private keys, default roles, or fabricated chain data.
