# Runbook: Self-Hosted OpenSigner Operations

## Overview
This runbook covers health checks, operations, key backup, master key rotation, and troubleshooting for the **AgentGuard Self-Hosted OpenSigner signing service** (`services/opensigner`). It is a sealed software vault, not a hardware-attestation provider.

---

## 1. Health & Readiness Probes
The OpenSigner service exposes liveness and readiness probes. Browser operators use the authenticated gateway route; direct service access is reserved for operations:

```bash
# Liveness probe
curl -f http://localhost:3001/health
# Returns: {"status":"healthy","service":"agentguard-opensigner","version":"1.0.0","chainId":10143,"walletsCount":N,"timestamp":...}

# Readiness probe
curl -f http://localhost:3001/ready
# Returns: {"status":"ready","service":"agentguard-opensigner","vaultLoaded":true,"walletsCount":N}
```

---

## 2. API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Container liveness and wallet count probe |
| `/ready` | `GET` | Vault readiness probe |
| `/api/v1/wallets` | `GET` | List provisioned agent addresses (zero private keys) |
| `/api/v1/wallets/:id` | `GET` | Get metadata for a specific wallet ID or address |
| `/api/v1/wallets` | `POST` | Generate and seal a new agent keypair in the vault |
| `/api/v1/sign-spend-request` | `POST` | Sign an EIP-712 SpendRequest for Monad (Chain 10143) |
| `/api/v1/execute-treasury-load` | `POST` | Submit the configured settlement-token transfer to a registered AgentGuard agent |
| `/api/v1/execute-gated-payment` | `POST` | Submit a policy-gated payment through the configured AgentWalletGuard |

There is deliberately no generic typed-data or arbitrary-transfer endpoint. Hardware attestation routes return `503 ATTESTATION_UNAVAILABLE` until a real provider-backed verifier is installed.

### Example: Provisioning a Sealed Agent Keypair
```bash
curl -X POST http://localhost:3001/api/v1/wallets \
  -H "Authorization: Bearer $OPENSIGNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "controlled-agent"}'
# Response:
# {
#   "success": true,
#   "wallet": {
#     "walletId": "wallet_8f3b2a1c...",
#     "address": "<sealed-wallet-address>",
#     "createdAt": 1741500000000,
#     "label": "deepseek_inference_bot"
#   }
# }
```

### Example: Requesting an EIP-712 Signature
```bash
curl -X POST http://localhost:3001/api/v1/sign-spend-request \
  -H "Authorization: Bearer $OPENSIGNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletIdOrAddress": "<sealed-wallet-address>",
    "verifyingContract": "<verified-agent-wallet-guard-address>",
    "chainId": <configured-chain-id>,
    "request": {
      "agent": "<sealed-wallet-address>",
      "merchant": "<configured-merchant-address>",
      "amount": "<base-unit-amount>",
      "category": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "timestamp": 1741500000,
      "deadline": 1741503600,
      "nonce": 1
    }
  }'
# Response:
# {
#   "success": true,
#   "signature": "0x...",
#   "signer": "<sealed-wallet-address>",
#   "domain": { ... },
#   "request": { ... }
# }
```

---

## 3. Vault Backup & Disaster Recovery

The sealed keys are stored on the Docker volume mounted at `/data/opensigner.vault.json`.

### Backup:
```bash
docker run --rm \
  --volumes-from agentguard-opensigner \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/opensigner-vault-backup-$(date +%Y%m%d).tar.gz /data
```

### Restore:
```bash
docker run --rm \
  --volumes-from agentguard-opensigner \
  -v $(pwd)/backups:/backup \
  alpine sh -c "cd / && tar xzf /backup/opensigner-vault-backup-YYYYMMDD.tar.gz"
```

---

## 4. Troubleshooting
1. **Container fails health check**: Ensure port `3001` is not occupied by another process and check container logs:
   ```bash
   docker compose logs agentguard-opensigner
   ```
2. **"Agent address mismatch" error**: The requested `walletIdOrAddress` does not match the `request.agent` parameter in the payload. Ensure the autonomous agent submits requests corresponding to its assigned wallet.
3. **Corrupted vault or decryption failure**: If `OPENSIGNER_MASTER_KEY` was changed without re-encrypting the vault, OpenSigner will fail to load. Restore the previous master key or restore from an encrypted backup.
