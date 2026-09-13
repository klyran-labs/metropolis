# AgentGuard High-Throughput Rust Payment & Policy Gateway

High-throughput, sub-millisecond autonomous agent gateway written in **Rust** using **Tokio**, **Axum**, and **Alloy-RS**. Implements cryptographic x402 payment negotiation, Monad Parallel EVM policy evaluation (`IPolicyEngine`), Cancun transient reentrancy compatibility, and institutional Privy custom metadata role administration.

---

## 1. Architecture & Core Capabilities

1. **Sub-Millisecond Payment Verification**:
   - Computes EIP-712 typed data hashes and verifies agent signatures in sub-50 microseconds.
   - Evaluates onchain spend invariants against Monad parallel EVM disjoint storage partitions.
   - Strictly conforms to Invariant #4: Every rejection returns a machine-readable reason code with actionable remediation.

2. **Privy Role & Permission Provisioning API**:
   - `GET /api/v1/users/:did/role`: Query operator roles and custom metadata.
   - `POST /api/v1/users/:did/role`: Atomically update operator roles on remote Privy via Server API.
   - Super Admin Guard: Only callers in `INITIAL_SUPER_ADMIN_DIDS`, verified JWT with `super_admin` claim, or valid `X-Admin-Secret` can mutate operator permissions.

3. **Production Containerization**:
   - Multi-stage Alpine container (`docker/Dockerfile.gateway`) with a minimal footprint (~14MB runtime).
   - Dynamic health checks via `wget --spider http://127.0.0.1:8080/health`.

---

## 2. API Reference

### Health & Status
- `GET /health` / `GET /ready` / `GET /api/v1/health`
  Returns service status, configured chain ID, contract addresses, and Unix timestamp.

### x402 Payment Protocol
- `POST /v1/inference` / `GET /v1/inference`
  - **No Authorization**: Returns `HTTP 402 Payment Required` with `WWW-Authenticate: x402` and challenge payload.
  - **Valid x402 Authorization**: Cryptographically verifies signature, checks deadline, simulates `PolicyEngine.evaluate(req)` on Monad, and settles payment.
  - **Policy Rejection**: Returns `HTTP 403 Forbidden` with standardized `ReasonCode` (1 to 10).

### Privy Role Management
- `GET /api/v1/users/:did/role`
  - Headers: `Authorization: Bearer <jwt>`, `privy-id-token: <jwt>`, or `x-admin-secret: <secret>`.
- `POST /api/v1/users/:did/role`
  - Headers: Requires Super Admin authorization.
  - Body:
    ```json
    {
      "role": "treasury_manager",
      "permissions": {
        "canReallocateBudget": true
      }
    }
    ```

---

## 3. Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `MONAD_CHAIN_ID` | `10143` | Monad Network Chain ID |
| `MONAD_RPC_URL` | `https://testnet-rpc.monad.xyz` | Monad JSON-RPC endpoint |
| `POLICY_ENGINE_ADDRESS` | `0x5fb...` | Deployed `PolicyEngine` contract |
| `AGENT_WALLET_GUARD_ADDRESS`| `0x9fe...` | Deployed `AgentWalletGuard` contract |
| `USDC_TOKEN_ADDRESS` | `0xf81...` | Settlement token address |
| `GATEWAY_MERCHANT_ADDRESS` | `0x3c4...` | Target merchant payee address |
| `PRIVY_APP_ID` | `cmton65ao004l0cl11tgmwiah` | Privy App ID |
| `PRIVY_APP_SECRET` | *(Optional)* | Privy Server API Secret |
| `INITIAL_SUPER_ADMIN_DIDS` | *(Optional)* | Comma-separated list of bootstrap Super Admin DIDs |

---

## 4. Local Build & Tests

```bash
# Run unit & cryptographic invariant tests
cargo test

# Build optimized release binary
cargo build --release

# Run locally
./target/release/agentguard-gateway
```
