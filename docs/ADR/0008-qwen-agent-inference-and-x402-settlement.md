# ADR 0008: Alibaba Qwen 3.8 Max Autonomous Agent Inference & UI Risk Copilot Architecture

## Status
Accepted (Target: Hackathon Phase 2 Integration)

## Context
In the emerging autonomous agent economy, two distinct challenges prevent institutional adoption of AI agents:
1. **Unbounded Inference Liability (Backend)**: Autonomous agents consuming LLM APIs in recursive loops or under prompt injection attacks can drain cloud API budgets or onchain treasuries uncontrollably. Existing LLM APIs rely on static credit cards or centralized balances without onchain velocity controls or cryptographic gating.
2. **Operational Policy Complexity (Frontend)**: Human risk operators and developers struggle to configure complex mathematical parameters (sliding window seconds, velocity limits, disjoint packed storage slots, and hex whitelists) and decipher raw onchain error codes when transactions fail.

For the Monad Hackathon, Alibaba Cloud has sponsored the **"Best Builds with Qwen 3.8 Max"** bounty (5,000 USD credits) under the **Trust, Identity & AI Infrastructure** track, challenging builders to *"Push Qwen 3.8 Max into genuinely agentic territory on Monad."*

## Decision
We integrate **Alibaba Cloud's Qwen 3.8 Max** in a **dual-role architecture**:
1. **Backend Agentic Economy**: Qwen 3.8 Max acts as the autonomous intelligence engine whose inference calls are gated and settled on Monad via HTTP 402 (x402/AP2) micropayments.
2. **Frontend UI Risk Copilot**: Qwen 3.8 Max acts as an in-browser enterprise copilot that translates natural language prompts into immutable Monad policies and explains onchain policy denials in plain English.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                    Enterprise Web Control Plane (apps/web)                             │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                 AgentGuard AI Copilot (Powered by Qwen 3.8 Max)                │   │
│   │  • Natural Language Policy Generator ("Set 0.2 MON cap, 3 tx/hr for Twitter") │   │
│   │  • Onchain Denial Diagnostic Assistant ("Why did tx 0x1a2b fail at block 402?")│   │
│   └────────────────────────┬───────────────────────────────┬───────────────────────┘   │
└────────────────────────────┼───────────────────────────────┼───────────────────────────┘
                             │ Pre-fills PolicyStudio        │ Explains Onchain Events
                             ▼                               ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                 Settlement & Transport Adapters (packages/x402-middleware)             │
└────────────────────────────┬───────────────────────────────┬───────────────────────────┘
                             │                               │
                             ▼                               ▼
┌───────────────────────────────────────────┐    ┌───────────────────────────────────────┐
│     High-Throughput Rust Gateway          │    │    Monad Parallel EVM (Chain 10143)   │
│  - Paid inference endpoint (/v1/inference)│    │  - PolicyEngine.sol (disjoint slots)  │
│  - Returns HTTP 402 challenge             │    │  - Verifies EIP-712 spend intents     │
│  - Forwards settled prompts to Qwen       │    │  - Emits SpendEvaluated reason codes  │
└────────────────────┬──────────────────────┘    └───────────────────────────────────────┘
                     │
                     ▼
┌───────────────────────────────────────────┐
│      Alibaba Cloud Model Studio           │
│  - Qwen 3.8 Max LLM Inference             │
│  - Streams real-time AI completions       │
└───────────────────────────────────────────┘
```

### 1. Backend Agentic Economy Components
* **Model Endpoint Configuration (`services/gateway`)**:
  - Rust Axum gateway implements `/v1/chat/completions` and `/v1/inference` with OpenAI-compatible schemas.
  - Negotiates HTTP 402 challenges (`0.10 MON` per inference request).
* **Cryptographic Monad Settlement**:
  - The autonomous agent signs an EIP-712 `SpendRequest` via OpenSigner.
  - `PolicyEngine.sol` verifies spend velocity and window budget on Monad Testnet (`10143`).
  - Upon valid onchain clearance, the gateway forwards the prompt to Qwen 3.8 Max and streams output back to the agent.

### 2. Frontend UI Risk Copilot Components
* **Natural Language Policy Authoring ("Auto-Configuring Agents")**:
  - Operators enter plain English requirements: e.g., *"Configure an arbitrage trading bot with a 0.5 MON max per tx, 3.0 MON hourly budget, 5 tx velocity cap, whitelisting Uniswap and Pyth, with a circuit breaker tripping after 3 failures."*
  - Qwen 3.8 Max extracts structured parameters and populates `PolicyStudio.tsx` and `AgentOnboardingModal.tsx` automatically.
  - The operator reviews and executes `setPolicy()` on Monad with a single click.
* **Intelligent Onchain Risk & Denial Diagnostics**:
  - Decodes onchain `SpendEvaluated` events and maps machine-readable reason codes (`ERR_VELOCITY_EXCEEDED`, `ERR_MAX_PER_WINDOW`, `ERR_KILL_SWITCH`, `ERR_BUDGET_DEPLETED`) into clear remediation advice.
  - Answers user queries: *"Why was Agent 0x1041 blocked?"* -> *"Tripped velocity cap (attempted 4th transaction within a 3-tx 60-minute window). Window resets in 14 minutes."*

### 3. Autonomous Multi-Tier Circuit Breaker Architecture
* **The Problem**: In autonomous loops, a failing or hallucinating agent might repeatedly trigger policy denials, consuming gas or overwhelming downstream APIs.
* **The Solution**:
  - **State Machine**: `CLOSED` (Armored) $\to$ `OPEN` (Tripped / Quarantined) $\to$ `HALF_OPEN` (Trial Probe).
  - **Auto-Trip**: When an agent hits $N$ consecutive denials (default: 3), the circuit breaker automatically trips, calling `setKillSwitch(agent, true)` on Monad.
  - **O(1) Quarantine**: Denies all subsequent requests in sub-microsecond time with `ERR_KILL_SWITCH`.
  - **Recovery**: After a 15-minute cool-down or manual supervisor reset, the circuit breaker enters `HALF_OPEN`, allowing a single test transaction before restoring full traffic.

### 4. Qwen 3.8 Max Workload Blueprint in Enterprise Catalog
* Pre-configured institutional blueprint in `agentTemplates.ts`:
  - Name: `Alibaba Qwen 3.8 Max Autonomous Agent`
  - Category: `Inference & LLM`
  - Dual-Denomination: `3,000,000 Tokens/wk` + `0.10 MON / tx`, `1.50 MON / hr`, 10 tx/hr velocity
  - Circuit Breaker: Auto-trips after 3 consecutive rejections with 15-minute cool-down

### 5. Live AI-Native Autonomous Agent Playground ("Agent in Action")
* **Interactive AI-Native Workspace**: An integrated execution environment where operators and judges can give tasks to a live autonomous Qwen 3.8 Max agent (e.g., market research, compute procurement, or structured data extraction).
* **Live Reasoning & Micro-Settlement**:
  - Streams multi-step reasoning: Planning $\to$ Tool Execution $\to$ x402 Micropayment on Monad $\to$ Synthesis.
  - Visualizes real-time dual-denomination telemetry: Token velocity vs. MON micro-cent expenditure.
* **Adversarial Containment Showcase**:
  - Allows injecting runaway looping prompts or exceeding velocity caps.
  - Real-time visual transition of Circuit Breaker from `CLOSED` to `OPEN`, proving automated $O(1)$ isolation before financial damage.

## Consequences
- **Positive**: Directly qualifies AgentGuard for the **5,000 USD Alibaba Cloud Qwen 3.8 Max bounty** and the **AI / AI-Native Apps** track.
- **Positive**: Maximizes the hackathon's 20% **Design & Craft (DX)** score by offering a state-of-the-art natural language policy authoring workflow.
- **Positive**: Elevates AgentGuard from a backend admin dashboard into a flagship **AI-Native Application** where agents actively reason, transact, and are guarded in real time.
- **Positive**: Complete zero-mock compliance: real streaming AI inference coupled with real onchain Monad transactions.
- **Positive**: Dual-vector showcase: demonstrates Qwen as both an autonomous consumer in machine payments and an institutional assistant for risk operators.
- **Positive**: Fail-safe containment: circuit breaker guarantees runaway agent loops are halted before financial or operational damage occurs.

### Architectural Alignment (ADR-0012 & ADR-0013)
* The automated circuit-breaker pattern introduced here is formally canonized in **ADR 0012** as the core institutional primitive of **Circuit Protocol**.
* High-frequency inference settlement and streaming micro-payments are cleared via `CircuitVault.sol` using monotonic spend commitments and split-state dispute resolution, as specified in **ADR 0013**.
