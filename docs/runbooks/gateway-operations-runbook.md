# Gateway Operations Runbook

This runbook covers the Rust gateway, PostgreSQL 18 authorization store, and Monad event ingestion boundary.

## Startup requirements

The gateway must receive real deployment-specific values for every contract address, the Monad RPC endpoint, PostgreSQL 18, Privy Server credentials, Privy JWKS configuration, x402 pricing metadata, and the event start block. It exits during startup if any required value is missing, malformed, or set to the zero address.

The gateway runs `services/gateway/migrations` before binding its HTTP listener. Readiness is `503` until both PostgreSQL and Monad RPC health checks succeed.
All request correlation IDs and durable operation identifiers are UUID v7. PostgreSQL UUID constraints reject UUID versions other than v7.

## Health checks

```bash
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/ready
```

`/health` is liveness only. `/ready` is the operational check and must be used by orchestration. The response does not expose contract addresses, credentials, or raw dependency errors.

## Identity and authorization

Human requests use a verified Privy JWT. Verification requires the configured issuer, audience, RSA JWKS key, expiry, and not-before checks. Privy metadata is only an optional organization routing hint; PostgreSQL is authoritative for active membership, role, enterprise address, and MFA. Machine requests use a scoped `ag_live_sec_...` credential; only its SHA-256 hash is stored.

Every protected request must resolve to an active PostgreSQL operator or API-key record. The gateway applies the six-role RBAC matrix, tenant-owned PBAC policies, and tenant ABAC controls before the handler executes. A missing identity record, policy-store error, unknown tenant, or unavailable client IP fails closed.

Role changes are committed to PostgreSQL. Privy metadata is not mutated by role administration and is never an authorization dependency.

## Telemetry evidence

The event worker polls the configured Monad RPC for events emitted by the deployed `PolicyEngine` and `AgentWalletGuard`. It stores chain ID, block number/hash, transaction hash, log index, event name, payload, tenant scope, and finality status in PostgreSQL.

Events are deduplicated by `(chain_id, transaction_hash, log_index)`. The worker stores a checkpoint and rewinds a bounded range when the checkpoint block hash changes. Only finalized events are published to `/api/v1/telemetry/stream`, and the SSE stream filters by the authenticated organization.

### Live UI updates and browser telemetry

* The same stream carries change notifications (`approvals_changed`, `transfers_changed`, `wallets_changed`, `agents_changed`) published after successful mutating requests (approvals, transfers, wallets, agents). They contain only the kind; the web app invalidates the matching queries and refetches through authorized endpoints, so no tenant data travels on the stream. While the stream is connected the app polls only as a 60-second safety net; when it drops, normal polling resumes automatically.
* Reverse proxies must not buffer or time out `/api/v1/telemetry/stream` (`proxy_buffering off`, long `proxy_read_timeout`).
* `POST /api/v1/telemetry/web-vitals` and `/csp-report` are unauthenticated by necessity (browsers send CSP reports without credentials). They are bounded by an 8 KiB body limit, a per-client token bucket (30 burst, 60/minute, 10,000 tracked clients), a metric-name whitelist, control-character stripping and URL reduction to path/origin. Search logs by target `web_vitals`, `web_errors` or `csp`; a spike of `csp` records after a deploy usually means a new third-party origin that must be reviewed before it is allowed.

If RPC ingestion or PostgreSQL is unavailable, the service remains alive but readiness fails and no fabricated telemetry is emitted.

## x402 policy path

`/v1/inference` returns a configured HTTP 402 challenge when no x402 authorization is present. A retry must include a valid EIP-712 signature using the deployed `AgentWalletGuard` address and canonical `SpendRequest` fields, including a full-width `uint256` nonce.

The gateway verifies the signature, validates the merchant, and calls the deployed `PolicyEngine.evaluate` method. Rejections return the canonical Solidity reason code. A successful response reports only read-only policy approval; it does not claim settlement or provider inference without a real receipt.

## Verification

```bash
cargo fmt --manifest-path services/gateway/Cargo.toml -- --check
cargo check --manifest-path services/gateway/Cargo.toml
cargo test --manifest-path services/gateway/Cargo.toml
```

CircuitVault operations are not enabled. Do not add CircuitVault addresses or event assumptions until its source, ABI, deployment address, and bytecode verification artifact are available.
