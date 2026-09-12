# AgentGuard End-to-End System Flows & State Machines

This document provides sequence diagrams and technical walkthroughs for the core operational workflows in AgentGuard.

---

## 1. Flow 1: Policy Configuration & Fleet Provisioning

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Risk Officer / Treasury Admin
    participant UI as AgentGuard Web Console
    participant PE as PolicyEngine.sol (Monad)
    
    Admin->>UI: Define Agent Policy (maxPerTx, maxPerWindow, windowSeconds, maxVelocity)
    UI->>PE: setPolicy(agent, policyStruct)
    Note over PE: SLOAD existing slot<br/>Pack into single 32-byte slot<br/>SSTORE packed state
    PE-->>UI: emit PolicySet(agent, ...)
    UI-->>Admin: Confirmed in 400ms (Monad Block Finality)
```

---

## 2. Flow 2: Gated Payment with x402 / AP2 Negotiation

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Autonomous Agent
    participant GW as x402 Payment Gateway
    participant Guard as AgentWalletGuard.sol
    participant PE as PolicyEngine.sol
    participant Merchant as Merchant Account
    
    Agent->>GW: GET /resource (without payment)
    GW-->>Agent: HTTP 402 PAYMENT-REQUIRED (Challenge parameters)
    Note over Agent: Constructs SpendRequest<br/>Signs EIP-712 typed data
    Agent->>GW: GET /resource + PAYMENT-SIGNATURE header
    GW->>Guard: executeGatedPayment(req, signature, token, callData)
    Guard->>Guard: Verify EIP-712 signer == req.agent
    Guard->>PE: evaluateAndSpend(req)
    alt Allowed by Policy
        PE-->>Guard: (allowed=true, reasonCode=0)
        Guard->>Merchant: Transfer payment (native MON or ERC-20)
        Guard-->>GW: PaymentExecuted event
        GW-->>Agent: HTTP 200 OK + Resource Content
    else Denied by Policy
        PE-->>Guard: (allowed=false, reasonCode=EXCEEDS_VELOCITY)
        Guard-->>GW: Revert with PaymentBlocked(agent, merchant, reasonCode)
        GW-->>Agent: HTTP 403 Forbidden + JSON reason details
    end
```

---

## 3. Flow 3: O(1) Instant Kill Switch Trigger

```mermaid
sequenceDiagram
    autonumber
    actor Sentinel as Automated Anomaly Sentinel / Admin
    participant PE as PolicyEngine.sol
    participant Rogue as Rogue / Compromised Agent
    
    Sentinel->>PE: setKillSwitch(agent, true)
    Note over PE: Sets killSwitch flag in agent storage slot
    Rogue->>PE: evaluate(spendRequest)
    Note over PE: O(1) Check: policy.killSwitch == true<br/>Immediately returns ReasonCode 2 (KILL_SWITCH_ACTIVE)
    PE-->>Rogue: (allowed=false, reasonCode=2)
```
