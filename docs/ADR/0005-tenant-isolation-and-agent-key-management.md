# ADR 0005: Multi-Tenant Fleet Isolation and Autonomous Agent Key Lifecycle

## Status
Accepted

## Context
In early design iterations, AgentGuard lacked tenant isolation: any user opening the Fleet Overview could see all registered network agents, violating the Principle of Least Privilege (PoLP). In enterprise and multi-tenant environments, operators must only view, manage, and trip kill switches on agents belonging to their organization or assigned to their account.

Furthermore, there was architectural ambiguity regarding how autonomous agent wallets are provisioned and operated:
1. Whether agents share the operator's wallet or have dedicated addresses.
2. How autonomous agents sign payments in automated loops without prompting human operators for wallet approvals (e.g., MetaMask or Privy popups) for every transaction.
3. How agent private keys are generated and stored without custodial risk or server-side compromise.

## Decision

### 1. Principle of Least Privilege (PoLP) Fleet Isolation
We establish a dual-scope tenant visibility model:
- **`my_agents` (Default)**: Authenticated operators see exclusively the agents registered or vaulted by their account. Operators with zero agents see an honest, clean empty state with clear onboarding call-to-actions, preventing cross-tenant data leakage.
- **`network` (Administrative & Audit)**: Privileged view reserved for `super_admin`, `sec_ops`, and `auditor` roles to inspect network-wide telemetry, global velocity saturation, and macro policy compliance.
- **`agent_developer` Role**: Added as the default authenticated persona in `RbacContext`, empowering developers to register agents, configure spending policies on Monad, and toggle kill switches for their fleet.

### 2. Separation of Human Operator vs. Autonomous Agent Signer
We strictly decouple the human controller from the autonomous machine signer:
- **Human Controller (Privy)**: Authenticates via Web3 wallet, social login, or passkey. Used solely for governance, setting spending policies on `PolicyEngine.sol`, funding treasuries, and tripping the emergency kill switch.
- **Autonomous Agent (Dedicated secp256k1 Keypair)**: Possesses its own unique onchain address. The agent runtime (Python, TypeScript, Go microservice, or TEE enclave) signs EIP-712 `SpendRequest` payloads independently using its local private key when negotiating x402 HTTP 402 payment challenges.

### 3. Non-Custodial Client-Side Key Generation & User-Scoped Vault
In the web control plane (`apps/web`):
- Developers can provision an agent using dual-mode onboarding:
  1. **Generate Testnet Keypair**: Uses standard Web Crypto (`crypto.getRandomValues`) via Viem's `generatePrivateKey` to derive a fresh, random secp256k1 private key client-side. The key is displayed once with a ready-to-use `.env` template (`AGENT_PRIVATE_KEY=0x...`).
  2. **Bring-Your-Own (BYO) Address**: Connects existing agent addresses (smart contracts or externally managed EOAs).
- Agent addresses and metadata are persisted in a client-side vault (`agentVault.ts`) scoped strictly to the authenticated operator's address (`agentguard_vault_${userAddress}`). Private keys are never sent to a central backend.

### 4. Openfort / OpenSigner & Enterprise KMS Compatibility
For production deployments requiring hardware-backed or session-key guarantees:
- AgentGuard's EIP-712 signature verification in `AgentWalletGuard.sol` is transport-agnostic and supports:
  - Self-hosted OpenSigner sovereign enclave (`services/opensigner` — see [ADR 0006](0006-self-hosted-opensigner-enclave.md)).
  - Headless session keys generated via Openfort / Turnkey.
  - HSM-backed keys via AWS KMS / Google Cloud KMS.
  - Hardware-isolated TEE enclaves (e.g. AWS Nitro Enclaves).

## Consequences
- **Positive**: Strict PoLP adherence with zero cross-tenant data leakage.
- **Positive**: Clean enterprise onboarding experience with honest empty states and zero mock data.
- **Positive**: Non-custodial security model maintained end-to-end; human operators are not prompted for micro-transactions, and agent keys are kept strictly in autonomous runtimes.
- **Trade-off**: In the client-side Web Crypto mode, developers are solely responsible for securely transferring the exported private key into their production runtime environment; AgentGuard servers never store agent private keys.
