# ADR 0010: FinOps Dual-Denomination & Enterprise Pricing Model Architecture

## Status
**Implemented** (Supersedes Hackathon Phase 2 & 3 target — fully deployed)

## Context
Autonomous agents interacting with foundation model APIs (Anthropic, OpenAI, DeepSeek) encounter a fundamental structural mismatch:
* **The Billing Provider Reality**: Anthropic and OpenAI bill post-facto via monthly invoices or prepaid pool debits based on aggregate token usage, often modulated by complex enterprise discount agreements, volume tier brackets, and committed-use reservations (CUDs / PTUs).
* **The Autonomous Agent Risk**: Autonomous loops, recursion errors, or prompt injections can fire thousands of requests in seconds. If unconstrained, an agent can exhaust an enterprise prepaid balance or run up a massive corporate credit card bill before the human operator is aware.

A naive single-currency solution fails because:
1. **Raw Token-Only Limits** fail to protect against input/output asymmetry (Claude 3.7 output tokens cost $15/1M vs $3/1M in; 1 output token = 5 input tokens) and model price disparities (Claude 3 Opus costs 25x more than Claude 3.5 Haiku).
2. **Raw Dollar-Only Limits** fail when enterprise customers have contracted discounts (e.g. 25% off list price) or pre-paid CUD/PTU capacity where the marginal token cost is $0.

## Decision

We implement a **Dual-Denominated FinOps Guardrail Engine** capable of operating across both **Token-Invariant** and **Financial Liability** dimensions, supporting all three primary enterprise contract models:

### 1. Dual-Denomination Evaluation Logic
* **Token Quota (`tokenCap`)**: Tracks compute volume independently of fiat or crypto currency (`usage.input_tokens + usage.output_tokens <= tokenCap`). Guarantees compute fairness in multi-agent environments.
* **Financial Cap (`maxSpend`)**: Converts token usage into real fiat/MON liability using official provider pricing matrices:
  $$\text{Cost} = (\text{input\_tokens} \times P_{\text{in}}) + (\text{output\_tokens} \times P_{\text{out}}) + (\text{cache\_creation} \times 1.25 \times P_{\text{in}}) + (\text{cache\_read} \times 0.10 \times P_{\text{in}})$$
* **Non-Token API Support**: Accommodates tool calls that charge per-operation rather than per-token (e.g. Firecrawl web scraping at $0.002/page; Serper search at $0.001/query).

### 2. The 3 Enterprise Pricing Contract Models

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        3 Enterprise Pricing Execution Models                           │
├───────────────────────────────┬────────────────────────────────────────────────────────┤
│ Contract Model                │ Execution Architecture in AgentGuard Gateway           │
├───────────────────────────────┼────────────────────────────────────────────────────────┤
│ **1. Flat Custom Discount**   │ FinOps admin enters negotiated discount percentage     │
│    (Rate Card Override)       │ (e.g. 25% off) in Workspace Settings. Rate is applied: │
│                               │ `UnitCost = ListPrice * (1.0 - discountPercent)`.      │
├───────────────────────────────┼────────────────────────────────────────────────────────┤
│ **2. Tiered Volume Ladders**  │ Gateway tracks `totalOrgTokensThisMonth`.              │
│    (Graduated Brackets)       │ Automatically steps down to Tier 2 (e.g. -15%) at      │
│                               │ 100M tokens and Tier 3 (e.g. -30%) at 500M tokens.     │
├───────────────────────────────┼────────────────────────────────────────────────────────┤
│ **3. Committed-Use / PTUs**   │ Marginal token cost inside the commit is $0 (sunk).    │
│    (Capacity Quota Mode)      │ AgentGuard shifts from financial metering to           │
│                               │ **Capacity Quota Allocation** per agent, acting as an  │
│                               │ **Overage Firewall** against expensive on-demand spill.│
└───────────────────────────────┴────────────────────────────────────────────────────────┘
```

### 3. Two-Phase Pipeline: Pre-Flight Safety Hold vs. Post-Flight Reconciliation
* **Phase 1: Pre-Flight Safety Hold**:
  - Evaluates $O(1)$ kill-switch and velocity caps on Monad in sub-millisecond execution.
  - Inspects incoming request payload length to verify the worst-case prompt cost cannot exceed the agent's remaining allowance.
* **Phase 2: Post-Flight Authoritative Reconciliation**:
  - The Gateway intercepts Anthropic/OpenAI's official `usage` block from the response JSON or SSE stream (`message_delta`).
  - Applies contracted enterprise discount and auto-detects native vendor discounts (e.g., Anthropic Batch API 50% discount when targeting `/v1/messages/batches`).
  - Atomically records the verified spend to the Monad disjoint storage slot.

## Consequences

### Positive
- **100% Invoice Parity**: Reconciled spend records match the customer's actual credit card invoice to the exact decimal place.
- **Runaway Loop Immunity**: Rogue bots are cut off pre-flight before incurring tokens or dollars.
- **Enterprise Contract Flexibility**: Supports standard list prices, custom rate cards, progressive volume discounts, and provisioned throughput reservations.

### Negative / Trade-offs
- Volume tier step-downs require synchronized monthly token tracking across distributed gateway instances.

### Architectural Alignment (ADR-0012 & ADR-0013)
* Dual-denomination quotas and rate-card reconciliation convert directly into `EpochBucket` allocations in `CircuitVault.sol` (**ADR 0013**).
* If an agent exceeds contracted token ladders or rate card bounds, the pre-flight safety hold triggers the $O(1)$ circuit breaker specified in **ADR 0012**.
