# AgentGuard End-to-End System Flows & State Machines

This document provides sequence diagrams and technical walkthroughs for the core operational workflows in AgentGuard.

---

## 1. Flow 1: Agent Key Provisioning, Policy Configuration & Fleet Registration

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Agent Developer (Privy Auth)
    participant UI as AgentGuard Web Console
    participant Vault as Client Vault (agentVault.ts)
    participant PE as PolicyEngine.sol (Monad)
    participant Agent as Autonomous Agent Runtime (.env)
    
    Dev->>UI: Connects via Privy (Role: agent_developer)
    Dev->>UI: Click "Register Agent"
    UI->>UI: generatePrivateKey() via Web Crypto (secp256k1)
    UI-->>Dev: Displays Private Key once + Exportable .env
    Dev->>Agent: Saves AGENT_PRIVATE_KEY into headless runtime
    UI->>Vault: Persist agent address in user-scoped vault
    Dev->>UI: Configure Spend Policy (maxPerTx, maxPerWindow, windowSeconds, maxVelocity)
    UI->>PE: setPolicy(agentAddress, policyStruct)
    Note over PE: SLOAD existing slot<br/>Pack into single 32-byte slot<br/>SSTORE packed state
    PE-->>UI: emit PolicySet(agentAddress, ...)
    UI-->>Dev: Confirmed in 400ms (Monad Block Finality)
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
    Note over Agent: Constructs SpendRequest<br/>Signs EIP-712 typed data with agent private key
    Agent->>GW: GET /resource + PAYMENT-SIGNATURE header
    GW->>Guard: executeGatedPayment(req, signature, token, callData)
    Guard->>Guard: Verify EIP-712 signer == req.agent
    Guard->>PE: evaluateAndSpend(req)
    alt Allowed by Policy
        PE-->>Guard: (allowed=true, reasonCode=ERR_NONE)
        Guard->>Merchant: Transfer payment (native MON or ERC-20)
        Guard-->>GW: PaymentExecuted event
        GW-->>Agent: HTTP 200 OK + Resource Content
    else Denied by Policy
        PE-->>Guard: (allowed=false, reasonCode=ERR_VELOCITY_EXCEEDED)
        Guard-->>GW: Revert with PaymentBlocked(agent, merchant, reasonCode)
        GW-->>Agent: HTTP 403 Forbidden + JSON reason details (ReasonCode: 4)
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
    Note over PE: Sets killSwitch bit in packed agent storage slot (1 SSTORE)
    Rogue->>PE: evaluate(spendRequest)
    Note over PE: O(1) Check: policy.killSwitch == true<br/>Immediately returns ReasonCode 1 (ERR_KILL_SWITCH)
    PE-->>Rogue: (allowed=false, reasonCode=ERR_KILL_SWITCH)
```

---

## 4. Flow 4: Tenant Isolation & Principle of Least Privilege (PoLP) Scope Resolution

```mermaid
sequenceDiagram
    autonumber
    actor User as Authenticated Operator
    participant UI as FleetOverview Component
    participant Vault as User-Scoped Agent Vault
    participant RPC as Monad Parallel RPC (Chain 10143)
    
    User->>UI: Accesses Fleet Overview
    UI->>RPC: Read onchain policies & spend states
    alt fleetScope == "my_agents" (Default PoLP View)
        UI->>Vault: getSavedAgents(userAddress)
        UI->>UI: Filter onchain agents by user ownership/vault
        alt Tenant has 0 registered agents
            UI-->>User: Render honest empty state ("No agents registered yet")
        else Tenant has registered agents
            UI-->>User: Display only tenant's provisioned agents
        end
    else fleetScope == "network" (Admin / Compliance Audit)
        Note over UI: Permitted only for super_admin / org_admin / security_auditor
        UI-->>User: Display full global network fleet
    end
```

---

## 5. Flow 5: EWMA Reputation Downgrade & Slashing Flow

```mermaid
sequenceDiagram
    autonumber
    participant Guard as AgentWalletGuard.sol
    participant Rep as ReputationRegistry.sol
    participant Sentinel as Anomaly Watcher / Operator
    
    alt Normal Successful Payment
        Guard->>Rep: recordOutcome(agent, outcome=SUCCESS)
        Note over Rep: Increments EWMA trust score towards max (10000 BPS)
    else Policy Breach / Rogue Pattern Detected
        Sentinel->>Rep: slash(agent, penaltyBps, "Velocity or budget breach")
        Note over Rep: Applies non-linear trust penalty<br/>Emits AgentSlashed(agent, newScore)
    end
```

---

## 6. Flow 6: OpenSigner Sealed Provisioning & Gated Signing Flow

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Connected Operator (0xUser)
    participant Modal as AgentOnboardingModal (Web UI)
    participant Signer as OpenSigner Enclave (Port 3001)
    participant Vault as AES-256-GCM Vault (/data/wallets.json)
    participant Agent as Autonomous LLM Agent
    participant PE as PolicyEngine.sol (Monad 10143)
    participant AWG as AgentWalletGuard.sol (Monad 10143)

    rect rgb(240, 248, 255)
    Note over Admin,Vault: Phase 1: 1-Click Sealed Enclave Provisioning
    Admin->>Modal: Select "OpenSigner Enclave" & Click "Provision via Enclave"
    Modal->>Signer: POST /api/v1/wallets { label: "agent-alpha" }
    Signer->>Signer: Generate secp256k1 keypair & derive walletId
    Signer->>Vault: Seal encrypted private key with AES-256-GCM + scrypt
    Signer-->>Modal: Return { walletId, address, status: "active" } (Zero plaintext key)
    Modal->>PE: setPolicy(address, maxPerTx, maxPerWindow, velocityLimit)
    Modal-->>Admin: Render agent card with OpenSigner Enclave badge & copyable Agent ID
    end

    rect rgb(255, 248, 240)
    Note over Agent,AWG: Phase 2: Autonomous Gated Signing & Execution
    Agent->>Agent: Construct EIP-712 SpendRequest (target, amount, nonce, deadline)
    Agent->>Signer: POST /api/v1/sign-spend-request { walletId, agent, spendRequest }
    Signer->>Vault: Unseal key in-memory & verify walletId owns agent
    Signer->>Signer: Sign EIP-712 SpendRequest hash for Monad (Chain 10143)
    Signer-->>Agent: Return { signature: "0x..." } (ECDSA r, s, v)
    Agent->>AWG: executeGatedPayment(spendRequest, signature)
    AWG->>PE: evaluateAndSpend(agent, amount, recipient)
    PE-->>AWG: ReasonCode.ERR_NONE (0)
    AWG-->>Agent: Payment settled atomically on Monad Parallel EVM
    end
```

---

## 7. Flow 7: Atomic 1-Tx EIP-2612 Permit & ERC-7579 Modular Hook Execution

```mermaid
sequenceDiagram
    autonumber
    actor Agent as Autonomous Agent / Smart Account
    participant AWG as AgentWalletGuard.sol / HookModule.sol
    participant Token as ERC-20 Token (USDC / Permit)
    participant PE as PolicyEngine.sol
    participant RR as ReputationRegistry.sol
    participant Merchant as Merchant Account

    rect rgb(240, 255, 240)
    Note over Agent,Merchant: 1-Tx Atomic Permit & Gated Settlement
    Agent->>Agent: Generate EIP-712 SpendRequest + EIP-2612 Permit Signature
    Agent->>AWG: executeGatedPaymentWithPermit(req, sig, token, permitDeadline, v, r, s, extraData)
    AWG->>AWG: Verify Signer (ecrecover for EOA or ERC-1271 for Smart Account)
    AWG->>Token: permit(agent, AWG, amount, deadline, v, r, s)
    AWG->>PE: evaluateAndSpend(req)
    alt Allowed by PolicyEngine
        PE-->>AWG: Decision (allowed = true, ERR_NONE)
        AWG->>Token: transferFrom(agent, merchant, amount)
        AWG->>RR: recordOutcome(agent, merchant, SETTLED, amount)
        AWG-->>Agent: PaymentExecuted event (Atomic 1-Tx)
    else Policy Trip / Kill Switch
        PE-->>AWG: Decision (allowed = false, ReasonCode)
        AWG-->>Agent: Revert PolicyEvaluationFailed(reasonCode)
    end
    end
```

