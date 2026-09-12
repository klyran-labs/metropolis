# Runbook: x402 / AP2 Payment Gateway Operations

## Overview
This runbook covers health checks, deployment, and troubleshooting for the AgentGuard x402 / AP2 HTTP 402 payment gateway.

---

## 1. Gateway Health Check
The gateway exposes a lightweight liveness and readiness probe on port 8080:
```bash
curl -f http://localhost:8080/health
# Returns: {"status":"healthy","chainId":10143,"timestamp":...}
```

---

## 2. Environment Configuration
Required environment variables for gateway container:
- `PORT`: HTTP listen port (default 8080)
- `MONAD_RPC_URL`: RPC endpoint (e.g. `https://testnet-rpc.monad.xyz`)
- `MONAD_CHAIN_ID`: 10143
- `POLICY_ENGINE_ADDRESS`: Deployed `PolicyEngine` contract address
- `REPUTATION_REGISTRY_ADDRESS`: Deployed `ReputationRegistry` contract address
- `AGENT_WALLET_GUARD_ADDRESS`: Deployed `AgentWalletGuard` contract address

---

## 3. Troubleshooting
- **HTTP 402 loops**: Ensure the agent client properly receives and parses the `PAYMENT-REQUIRED` challenge and includes the `PAYMENT-SIGNATURE` header on retry.
- **HTTP 403 Forbidden with ReasonCode**: Check the returned JSON body for the onchain reason code. Reason code 5 indicates velocity limit reached; reason code 2 indicates kill switch active.
