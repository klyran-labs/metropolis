# ADR 0006: Self-Hosted OpenSigner Sovereign Enclave & EIP-712 Signer

## Status
Accepted

## Context
In autonomous AI agent environments, agents must continuously sign EIP-712 transactions and HTTP 402 micro-payments in automated machine loops. However, traditional key management introduces severe security trade-offs:
1. **Plaintext Keys on Disk (`.env`)**: Storing private keys directly in environment variables or configuration files leaves them vulnerable to host compromise, accidental commits, and prompt injection / tool-exfiltration attacks.
2. **Interactive Human Approval (MetaMask / Privy UI)**: Impractical for autonomous agents operating at 400ms block intervals, as bots cannot wait for human approval popups.
3. **Third-Party SaaS Custody**: Proprietary custodial APIs create external vendor lock-in, recurring operational fees, and compliance hurdles regarding private key sovereignty.

## Decision
We introduce **Self-Hosted OpenSigner** (`services/opensigner`) as a sovereign, containerized signing enclave within the AgentGuard architecture:

1. **Sealed Key Vault with AES-256-GCM Encryption**:
   - Agent private keys are generated using OS-level cryptographic entropy (`crypto.getRandomValues`) and immediately encrypted at rest using AES-256-GCM.
   - Master encryption key is derived via `scrypt` from `OPENSIGNER_MASTER_KEY` with unique cryptographic salts.
   - Encrypted records are stored atomically on a dedicated Docker volume mount (`/data/opensigner.vault.json`).

2. **Zero Plaintext Key Exposure**:
   - The OpenSigner REST API (`/api/v1/wallets`) returns only public metadata: `{ walletId, address, createdAt, label }`.
   - Raw private keys are **never returned** in API responses and **never written to disk in plain text**.
   - Keys are decrypted strictly in volatile process memory for the sub-millisecond duration of signing a specific EIP-712 payload.

3. **EIP-712 Typed Data Signer for Monad**:
   - Exposes `POST /api/v1/sign-spend-request` specifically formatted for `AgentWalletGuard.sol` on Monad Testnet (Chain ID `10143`).
   - Verifies on the server that the requested wallet actually owns the target agent address before generating the signature.
   - Returns `{ signature, signer, domain, request }` for immediate transport in `PAYMENT-SIGNATURE` headers.

4. **Web Control Plane Integration**:
   - In [`AgentOnboardingModal.tsx`](../../apps/web/src/components/dashboard/AgentOnboardingModal.tsx), developers have an instant 1-click **"OpenSigner Enclave"** option alongside Web Crypto and Bring-Your-Own-Address.
   - Probes container health on port `3001` and binds the sealed address directly into Monad's `PolicyEngine`.

5. **Docker Multi-Environment Orchestration**:
   - Containerized in `docker/Dockerfile.opensigner` (Node 22 Alpine, non-root user).
   - Orchestrated in `docker-compose.yml`, `docker-compose.testnet.yml`, and `docker-compose.prod.yml` on port `3001`.

## Consequences
- **Positive**: Complete sovereign key protection. Even if an autonomous bot's process is exploited via prompt injection, the attacker cannot steal the private key.
- **Positive**: Full autonomy. Autonomous bots sign EIP-712 payments programmatically via local HTTP without human popups.
- **Positive**: Zero external SaaS dependence. The signing enclave runs 100% locally and offline.
- **Positive**: Total architectural alignment with Monad's `AgentWalletGuard.sol` standard EIP-712 signature verification.
- **Trade-off**: Operators must securely manage and back up their `OPENSIGNER_MASTER_KEY` and `/data` volume.
