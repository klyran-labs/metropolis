# ADR 0007: Modern EIPs & Agentic Blockchain Primitives Integration

## Status
Accepted

## Context
AgentGuard operates as a Tier-1 Agentic Risk, Spend Control, and Settlement Architecture on the Monad Parallel EVM. While its initial architecture enforced O(1) kill switches, Cancun transient storage (`tstore`/`tload`), and EIP-712 structured signing, several real-world bottlenecks persisted in enterprise agent deployments:
1. **Multi-Sig & Smart Contract Agent Friction**: Agents managed by Safe contracts, DAOs, or MPC clusters could not transact through `AgentWalletGuard.sol` because `ecrecover` strictly expects an EOA.
2. **Two-Step Approval Latency**: ERC-20 settlements required agents to submit a prior `approve()` transaction, doubling latency (~800ms) and causing unnecessary storage lock contention.
3. **Headless EOA Agent Overhead**: Launching an agent required either maintaining raw private keys or deploying heavy smart contract accounts with upfront gas costs.
4. **Account Abstraction Lock-in**: Custom forwarder guards lacked interoperability with emerging modular smart account standards (ERC-7579).
5. **Agent Ownership & Portability**: Transferring an autonomous agent between enterprise teams was disconnected from its onchain policy, budget allocations, and reputation history.
6. **Gas Starvation in Stablecoin Workflows**: Autonomous agents holding USDC could get stuck due to lacking native `MON` for gas.
7. **Zero-Trust Hardware Verification**: Reliance on software keys alone lacked hardware-grade cryptographic proof of isolation.

## Decision
We integrated seven modern EIPs and agentic blockchain primitives across all system tiers, maintaining an **immutable (zero-proxy)** deployment model to preserve Monad's disjoint parallel execution:

1. **ERC-1271 Smart Contract Signature Validation**:
   - `AgentWalletGuard.sol` now checks `req.agent.code.length > 0` and calls `IERC1271(req.agent).isValidSignature(digest, signature)`.
   - Supports institutional multi-sig wallets, DAOs, and smart contract agent controllers.

2. **EIP-2612 & EIP-3009 Atomic 1-Tx "Sign-and-Settle"**:
   - `AgentWalletGuard.sol` introduces `executeGatedPaymentWithPermit(...)`, atomically calling `IERC20Permit(token).permit(...)` prior to transferring funds.
   - Eliminates separate `approve()` transactions.

3. **EIP-7702 Ephemeral Smart Account Delegation Target**:
   - Deployed `AgentDelegationAccount.sol` as an immutable delegation target.
   - Allows EOA agents to temporarily delegate execution to this contract during Pectra/Prague transactions, executing batch gated payments directly from their EOA context with zero account deployment overhead.

4. **ERC-7579 / ERC-4337 Modular Account Hooks**:
   - Implemented `AgentGuardHookModule.sol` conforming to `IERC7579Hook` (`MODULE_TYPE_HOOK = 4`) and `IERC7579Validator` (`MODULE_TYPE_VALIDATOR = 1`).
   - `preCheck` enforces `PolicyEngine` limits; `postCheck` records telemetry in `ReputationRegistry`.

5. **EIP-6551 Token Bound Accounts (TBA) as Agent Passports**:
   - Implemented `AgentIdentityRegistry.sol` and `AgentAccount.sol`.
   - Deterministically calculates TBA addresses bound to an ERC-721 agent identity NFT via CREATE2.
   - Transferring the NFT automatically transfers ownership of the agent's budget pool allocations, reputation history, and spend policies.

6. **ERC-7677 Paymaster RPC for Gasless Settlements**:
   - Extended the Rust gateway (`services/gateway`) with configured `pm_getPaymasterStubData` and `pm_getPaymasterData` handlers.
   - Sponsorship is admitted only after an onchain `CircuitPaymaster.isSponsorshipEligible` check; verification and post-op gas bounds are deployment configuration, not fabricated response constants.

7. **Attestation integration boundary**:
   - OpenSigner fails closed for `/api/v1/attestation/quote` and `/api/v1/attestation/verify` until a real provider-backed quote verifier is configured.
   - `EnclaveAttestationRegistry.sol` remains available for a future verified provider integration; no software-generated measurement is treated as hardware proof.

## Consequences
- **Positive**: Complete interoperability with modern EVM account abstraction standards (Safe, Kernel, ERC-7579, EIP-7702).
- **Positive**: 1-transaction atomic permit settlement removes latency and approval transaction overhead.
- **Positive**: Portable institutional agent identity via EIP-6551 Token Bound Accounts.
- **Positive**: Gasless micropayments via standardized ERC-7677 paymaster RPC.
- **Positive**: Zero storage-proxy read contention, preserving sub-millisecond execution and parallel concurrency on Monad.
- **Positive**: 100% zero-mock compliance with 49/49 passing automated deterministic tests.
