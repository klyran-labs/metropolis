# Runbook: x402 / AP2 Payment Gateway Operations

## Overview
This runbook covers health checks, operations, build/test workflows, and troubleshooting for the AgentGuard High-Throughput x402 / AP2 Payment Gateway (`services/gateway`), built in **Rust** using **Tokio**, **Axum**, and **Alloy-RS**.

---

## 1. Gateway Health & Readiness Checks
The gateway exposes lightweight liveness and readiness probes on port 8080:

```bash
# Liveness probe
curl -f http://localhost:8080/health
# Returns: {"status":"healthy","chain_id":10143,"timestamp":...}

# Readiness probe
curl -f http://localhost:8080/ready
# Returns: {"status":"ready","chain_id":10143}
```

---

## 2. API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Liveness health check |
| `/ready` | `GET` | Readiness probe (RPC connectivity) |
| `/v1/inference` | `GET`, `POST` | x402 Payment-gated inference endpoint |
| `/api/v1/users/:did/role` | `GET` | Query operator RBAC role from Privy |
| `/api/v1/users/:did/role` | `POST` | Update operator RBAC role (Super Admin only) |

---

## 3. Environment Configuration
Required environment variables for the gateway container (`docker/Dockerfile.gateway`):
- `PORT`: HTTP listen port (default `8080`)
- `MONAD_CHAIN_ID`: Target chain ID (`10143`)
- `MONAD_RPC_URL`: JSON-RPC endpoint (`https://testnet-rpc.monad.xyz`)
- `POLICY_ENGINE_ADDRESS`: Deployed `PolicyEngine` contract address
- `AGENT_WALLET_GUARD_ADDRESS`: Deployed `AgentWalletGuard` contract address
- `USDC_TOKEN_ADDRESS`: Settlement token address
- `GATEWAY_MERCHANT_ADDRESS`: Target merchant payee address
- `PRIVY_APP_ID`: Privy App ID (`cmton65ao004l0cl11tgmwiah`)
- `PRIVY_APP_SECRET`: Privy Server API Secret (for admin role provisioning)
- `INITIAL_SUPER_ADMIN_DIDS`: Comma-separated list of bootstrap Super Admin DIDs

---

## 4. Local Build & Test Commands

```bash
# Run unit & cryptographic verification tests
cargo test --manifest-path services/gateway/Cargo.toml

# Build optimized release binary (~14MB Alpine footprint)
cargo build --release --manifest-path services/gateway/Cargo.toml

# Run binary directly
./services/gateway/target/release/agentguard-gateway
```

---

## 5. Troubleshooting & Diagnostics

- **HTTP 402 Loop (Continuous Challenge)**:
  Ensure the autonomous agent client captures the `PAYMENT-REQUIRED` response headers (`WWW-Authenticate: x402`, challenge payload), signs the structured EIP-712 `SpendRequest`, and attaches the `PAYMENT-SIGNATURE: x402 ...` header on retry.
- **HTTP 403 Forbidden with ReasonCode**:
  Inspect the `x-agentguard-reason-code` header or response JSON body:
  - `ERR_KILL_SWITCH (1)`: Agent kill switch is active. Check operator console to reactivate.
  - `ERR_MAX_PER_TX (2)`: Transaction amount exceeds per-tx limit. Split payment into smaller chunks.
  - `ERR_MAX_PER_WINDOW (3)`: Rolling window spend ceiling reached. Await window expiration.
  - `ERR_VELOCITY_EXCEEDED (4)`: Transaction velocity exceeded. Throttle request rate.
  - `ERR_MERCHANT_NOT_ALLOWED (5)`: Payee address not whitelisted in PolicyEngine.
  - `ERR_SIGNATURE_INVALID (9)`: EIP-712 signature verification failed. Verify agent private key.

