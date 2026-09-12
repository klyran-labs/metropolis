# AgentGuard Acceptable Use Policy & Risk Governance Framework

## 1. Scope & Purpose
This Acceptable Use Policy ("AUP") governs the deployment and operation of autonomous AI agents interacting with the AgentGuard programmable risk layer and x402 payment rails.

---

## 2. Prohibited Agent Activities
Agents operating on AgentGuard may NOT be configured to:
1. Conduct high-frequency sybil spend attacks or malicious recursive liquidity drain attempts.
2. Direct payments to OFAC-sanctioned addresses or illicit smart contracts.
3. Obfuscate merchant recipient identity or generate forged EIP-712 spend request digests.
4. Execute unauthorized cross-agent balance skimming or credential extraction.

---

## 3. Policy Enforcement & Automated Freezes
- The `PolicyEngine` automatically denies transactions exceeding velocity ceilings or unwhitelisted recipients with deterministic reason codes.
- Repeated anomalous spend attempts trigger automated or administrative invocation of `setKillSwitch(agent, true)`.
