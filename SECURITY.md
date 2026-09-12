# AgentGuard Security Policy & Bug Bounty Program

> **Status: target program, not yet live.** No AgentGuard contract has been deployed to any network yet — every address in `deployments/` and `deploy/environments/` is a placeholder (see `docs/GAP_ANALYSIS.md`). The bounty tiers below describe the intended program once contracts are audited and deployed; treat this document as a specification, not a live commitment, until this notice is removed.

AgentGuard adheres to institutional fintech security standards to protect agentic payments, treasury funds, and autonomous agent safety across **Monad's Parallel EVM (Chain ID 10143)** and the offchain x402 payment gateway.

---

## 1. Reporting a Vulnerability

If you discover an architectural vulnerability, cryptographic weakness, or smart contract bug, please submit your findings to:

- **Security Team**: `security@agentguard.network`
- **PGP Fingerprint**: `4A8B 91E2 3C7D 5F01 89A2 B4C6 D8E0 F2A4 1B3C 5D7E`
- **Security Advisory Channel**: `@agentguard_security`

**DO NOT** file public GitHub issues for sensitive security vulnerabilities. Please allow 48 hours for our team to triage and confirm the report.

---

## 2. Bug Bounty Rewards (Immunefi Tier-1 Matrix)

Bounties are paid in **USDC** or **MON** based on impact and likelihood:

| Severity Tier | Protocol Impact | Maximum Bounty |
| :--- | :--- | :--- |
| **Critical** | Direct drain of agent treasury funds, unauthorized bypass of PolicyEngine, or EIP-712 signature forgery | **$500,000 USD** |
| **High** | Circumvention of O(1) kill switch, bypass of velocity rate limits (ReasonCode 5) | **$100,000 USD** |
| **Medium** | Transient storage (`tstore`) reentrancy lock evasion, EWMA reputation score manipulation | **$25,000 USD** |
| **Low** | Non-exploitable reason code inconsistency, gas optimization opportunities | **$5,000 USD** |

---

## 3. Fortress-Grade Invariants & Scope

All reports must demonstrate a verifiable violation of protocol invariants:

1. **Policy Enforcement Invariant**:
   $$\text{SpendEvaluated}(\text{req}) \implies (\text{amount} \le \text{maxPerTx}) \land (\text{spentInWindow} + \text{amount} \le \text{maxPerWindow}) \land (\text{txCount} < \text{maxVelocity})$$
   No agent payment may execute onchain if any policy parameter is breached.
2. **Instant Kill Switch Invariant**:
   $$\text{killSwitchActive}(\text{agent}) \implies \text{evaluate}(\text{req}).\text{reasonCode} \equiv \text{KILL\_SWITCH\_ACTIVE} \quad (O(1) \text{ abort})$$
   A frozen agent must never execute any payment calldata.
3. **Disjoint Per-Agent State Slot Invariant**:
   $$\forall a_1 \ne a_2, \quad \text{slot}(a_1) \cap \text{slot}(a_2) = \emptyset$$
   State transitions for agent $a_1$ must never touch the storage slots of agent $a_2$, guaranteeing zero optimistic concurrency control (OCC) aborts across Monad parallel worker threads.
4. **Transient Storage Isolation**:
   `tstore`/`tload` reentrancy guards must clear transient slots within the same call frame.

---

## 4. Safe Harbor Policy
Researchers who adhere to responsible disclosure policies, avoid user fund impairment, and report vulnerabilities through approved channels are granted full safe harbor protection from legal action.
