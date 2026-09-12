# ComputeX Security Policy & Bug Bounty Program

ComputeX adheres to institutional fintech security standards to protect compute buyers, infrastructure providers, and protocol state across **Monad's Parallel EVM (Chain ID 10143)** and the high-frequency offchain CLOB engine.

---

## 1. Reporting a Vulnerability

If you discover an architectural vulnerability, cryptographic weakness, or smart contract bug, please submit your findings to:

- **Security Team**: `security@computex.network`
- **PGP Fingerprint**: `4A8B 91E2 3C7D 5F01 89A2 B4C6 D8E0 F2A4 1B3C 5D7E`
- **Security Advisory Channel**: `@computex_security`

**DO NOT** file public GitHub issues for sensitive security vulnerabilities. Please allow 48 hours for our team to triage and confirm the report.

---

## 2. Bug Bounty Rewards (Immunefi Tier-1 Matrix)

Bounties are paid in **USDC** or **MON** based on impact and likelihood:

| Severity Tier | Protocol Impact | Maximum Bounty |
| :--- | :--- | :--- |
| **Critical** | Direct theft of DvP escrow funds, illegitimate voucher minting, or EIP-712 forgery | **$500,000 USD** |
| **High** | 3-of-5 threshold oracle manipulation, bypass of SLA slashing invariants | **$100,000 USD** |
| **Medium** | Transient storage (`tstore`) state corruption, orderbook cancellation front-running | **$25,000 USD** |
| **Low** | Minor telemetry inaccuracy, non-exploitable gas inefficiencies | **$5,000 USD** |

---

## 3. Fortress-Grade Invariants & Scope

All reports must demonstrate a verifiable violation of protocol invariants:

1. **Delivery-versus-Payment (DvP) Solvency**:
   $$\text{BuyerEscrowDeduction} = \text{SellerProceeds} + \text{ProtocolTreasuryFee}$$
   No compute voucher can be minted without 100% verified collateral in escrow.
2. **Monotonic Batch Sequence Invariant**:
   $$\text{require}(\text{batchSequenceId} == \text{currentBatchSequenceId} + 1)$$
   Prevents batch reordering, replay, and parallel EVM front-running.
3. **Threshold Oracle Cryptographic Quorum**:
   Collateral slashing in `ParametricSLAVault.sol` requires strictly $\ge 3$ distinct, valid ECDSA signatures from authorized probes within a 15-block Monad window.
4. **Transient Storage Isolation**:
   `tstore`/`tload` reentrancy guards must clear transient slots within the same call frame.

---

## 4. Safe Harbor Policy
Researchers who adhere to responsible disclosure policies, avoid user fund impairment, and report vulnerabilities through approved channels are granted full safe harbor protection from legal action.

## 5. Production Dependency Exceptions

The production audit gate currently records two narrowly scoped high-severity transitive findings: Axios pulled through the optional Base wallet connector, and `ws` pulled through nested WalletConnect packages bundled by Privy. The application does not import those connector modules directly; they remain isolated to the wallet SDK dependency graph.

These exceptions are temporary and are enforced by `scripts/verify-production-audit.mjs`. The gate continues to fail on all critical findings and any new or differently located high-severity finding. The exceptions expire on **2026-10-08** and must be removed after the Privy/Base dependency chain ships patched versions. Until then, production release owners must record the audit output and vendor-upgrade review in the release evidence.
