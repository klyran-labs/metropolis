# @agentguard/web

The official **AgentGuard** Enterprise Web Control Plane for Agentic Payments on Monad Parallel EVM. Built with React 19, Vite 8, TailwindCSS v4, React Router v7, and Viem 2.x.

---

## Agent Risk Control Architecture

AgentGuard provides real-time control, monitoring, and safety rails for autonomous AI agents executing onchain payments:

### 1. 🛡️ Fleet Overview & Principle of Least Privilege (PoLP)
- **Tenant Scope Isolation**: Users default to the **`My Agents`** view showing only agents registered by or assigned to their account, eliminating cross-tenant data leakage.
- **Network Fleet View**: Privileged administrative and compliance view available to authorized enterprise roles (`super_admin`, `org_admin`, `security_auditor`).
- **Real-Time Telemetry**: Active spend policies, rolling window utilization, and velocity tracking.
- **Instant $O(1)$ Kill Switch**: Freeze compromised or malfunctioning agents onchain in a single transaction with sub-second Monad finality.
- **Honest Enterprise Empty States**: When an operator has 0 agents, renders clean onboarding guidance with zero synthetic or mock placeholders.

### 2. 🔑 Self-Serve Agent Provisioning & Key Vault
- **Triple-Mode Onboarding**:
  - **Self-Hosted OpenSigner Enclave**: 1-click sealed key generation communicating with the isolated OpenSigner microservice (`http://localhost:3001/api/v1/wallets`). Private keys are encrypted at rest with AES-256-GCM + `scrypt` and sealed on disk; raw keys are never leaked to the browser.
  - **Client-Side Key Generation (Web Crypto)**: Generates cryptographically secure secp256k1 keypairs locally in the browser via Web Crypto (`crypto.getRandomValues`). Provides a one-time copyable `.env` snippet (`AGENT_PRIVATE_KEY`) for autonomous headless agent runtimes.
  - **Bring-Your-Own (BYO) Agent Address**: Register existing external signer addresses (AWS KMS, Turnkey, MPC).
- **User-Scoped Vault (`agentVault.ts`)**: Persists tenant-scoped agent addresses and metadata in browser storage isolated by the connected operator's address.

### 3. 👥 Enterprise Role-Based Access Control (RBAC)
Governed by `RbacContext.tsx` with 6 granular enterprise personas:
- **`agent_developer`** *(Default Authenticated Role)*: Can provision new agents, author policies for owned agents, and toggle emergency kill switches.
- **`org_admin`**: Full organization control, fleet management, and policy authoring.
- **`super_admin`**: Global system governance and contract administration.
- **`security_auditor`**: Fleet-wide risk telemetry and immutable audit log review.
- **`finance_operator`**: Treasury balance monitoring and spend reconciliation.
- **`viewer`**: Restricted read-only view.

### 4. 📋 Policy Studio
- Visual policy authoring interface for configuring per-transaction maximums, rolling window caps, window duration, velocity limits, and merchant whitelists.
- Instant single-transaction updates packed into Monad's disjoint storage slots via `PolicyEngine.sol`.

### 5. 🧪 Rogue Agent Simulator
- Interactive testbench simulating realistic agent attack and failure scenarios:
  1. **Authorized Payment**: Normal operation under all risk limits (`ERR_NONE = 0`).
  2. **Compromised Burst Attack**: Rapid-fire payment requests tripping velocity rate limiting (`ERR_VELOCITY_EXCEEDED = 4`).
  3. **Treasury Drain Attempt**: Excessive single payment exceeding per-tx ceiling (`ERR_MAX_PER_TX = 2`).
- Real-time verification of machine-readable error codes and onchain rejection logs.

### 6. 📜 Audit Ledger
- Cryptographic event audit trail capturing every spend evaluation, gated payment execution, and blocked transaction.
- Verifiable proof links to Monad Testnet block explorer (`https://testnet.monadexplorer.com`).

---

## Development & Verification

```bash
# Start local development server (Port 3110)
npm run dev

# Run production build
npm run build

# Run frontend tests
node --test apps/web/test/frontend.test.mjs
```

---

## Zero-Mock Verification Standards

In compliance with repository `AGENTS.md` policy:
- No hardcoded fallback addresses (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).
- No synthetic balances or fake random math (`Math.random`).
- All empty states render honest zero balances (`0.0000 MON`) with actionable call-to-actions.

