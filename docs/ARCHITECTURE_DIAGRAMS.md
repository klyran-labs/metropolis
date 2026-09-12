# AgentGuard Architecture Diagrams (C4)

Durable diagram artifacts, rendered from Mermaid so they stay in version control
as text and render natively on GitHub — replacing the ASCII-art boxes in
`README.md` / `docs/ARCHITECTURE.md` as the source of truth for structure.
Sequence/flow diagrams for individual operations already live in
`docs/SYSTEM_FLOWS.md`; this document covers the four levels the plan asked
for: system context, containers, components, and deployment.

## 1. System Context

Who and what AgentGuard talks to, and why.

```mermaid
flowchart TB
    Agent["Autonomous Agent<br/>(LLM / ReAct tool runner,<br/>holds signing key in HSM/KMS)"]
    Admin(["Risk Officer / Treasury Admin<br/>(human)"])
    Merchant["Merchant / API Provider<br/>(sells a paywalled resource)"]
    Monad[("Monad Parallel EVM<br/>Chain ID 10143")]

    subgraph AG["AgentGuard"]
        direction TB
        AGDesc["Programmable risk, spend-limit,<br/>and reputation control plane"]
    end

    Agent -- "1. requests paid resource" --> Merchant
    Merchant -- "2. HTTP 402 Payment Required" --> Agent
    Agent -- "3. EIP-712 signed SpendRequest<br/>via x402 gateway" --> AG
    Admin -- "configures policy limits,<br/>flips O(1) kill switch" --> AG
    AG -- "4. reads/writes policy, spend-window,<br/>and reputation state" --> Monad
    AG -- "5. settles payment<br/>(native MON or ERC-20)" --> Merchant

    style AG fill:#4c6ef5,color:#fff,stroke:#333,stroke-width:2px
```

## 2. Container Diagram

The four deployable units and where each piece of logic actually lives —
matches the real repository layout, not an idealized one.

```mermaid
flowchart TB
    Agent["Autonomous Agent"]
    Admin(["Risk Officer / Admin"])

    subgraph Offchain["Offchain — apps/, services/, packages/"]
        Web["agentguard-web<br/>(apps/web — React 19 + Vite,<br/>served by Nginx)"]
        Gateway["agentguard-gateway<br/>(services/gateway — Node.js HTTP service)"]
        Middleware["@agentguard/x402-middleware<br/>(packages/x402-middleware —<br/>challenge/verify/reject helpers, a library,<br/>imported by Gateway, not a service itself)"]
        Types["@agentguard/shared-types<br/>(packages/shared-types —<br/>canonical domain types, reason codes)"]
    end

    subgraph Onchain["Onchain — contracts/src (Monad, Chain 10143)"]
        PE["PolicyEngine.sol<br/>(disjoint per-agent PackedState,<br/>O(1) kill switch, reason codes)"]
        AWG["AgentWalletGuard.sol<br/>(EIP-712 verify, atomic DvP settlement,<br/>tstore reentrancy guard)"]
        RR["ReputationRegistry.sol<br/>(append-only outcomes,<br/>EWMA scoring)"]
    end

    Admin -- "policy authoring UI" --> Web
    Web -- "viem readContract<br/>(policy, state, reputation)" --> PE
    Web -- "viem readContract" --> RR
    Admin -- "setPolicy / setKillSwitch<br/>(signed by admin wallet)" --> PE

    Agent -- "GET resource, then signed<br/>Payment-Signature header" --> Gateway
    Gateway --> Middleware
    Gateway -- "evaluate() — free view call,<br/>pre-flight simulation" --> PE
    Gateway -- "executeGatedPayment()<br/>(relayer-submitted tx)" --> AWG

    AWG -- "evaluateAndSpend()<br/>(authorized caller only)" --> PE
    AWG -- "recordOutcome()<br/>(authorized reporter only)" --> RR

    Middleware -.->|imports| Types
    Web -.->|imports| Types
    Gateway -.->|imports| Types

    style Onchain fill:#1a1a2e,color:#fff
    style Offchain fill:#f1f3f5,color:#1a1a1a
```

## 3. Component Diagram — Onchain Core

Internal call graph of the three contracts plus the shared reentrancy guard,
including the authorization edges added in
[`docs/GAP_ANALYSIS.md`](GAP_ANALYSIS.md) finding 1.3 (`PolicyEngine` no longer
trusts any caller for `evaluateAndSpend`).

```mermaid
flowchart LR
    subgraph PolicyEngine["PolicyEngine.sol"]
        Eval["evaluate()<br/>(view, anyone may call —<br/>free simulation)"]
        EvalSpend["evaluateAndSpend()<br/>(state-changing —<br/>gated by authorizedCallers)"]
        SetPolicy["setPolicy() / setKillSwitch()<br/>(agent or agentAdmin only)"]
        AuthCaller["authorizedCallers mapping<br/>+ setAuthorizedCaller()<br/>(owner only)"]
    end

    subgraph AgentWalletGuard["AgentWalletGuard.sol"]
        Exec["executeGatedPayment()"]
        Recover["_recoverSigner()<br/>(EIP-712 ecrecover)"]
        SafeXfer["_safeTransferFrom()<br/>(tolerates non-standard<br/>ERC-20 return data)"]
    end

    subgraph ReputationRegistry["ReputationRegistry.sol"]
        Record["recordOutcome()<br/>(authorizedReporters only)"]
        Reporters["authorizedReporters mapping<br/>+ setReporter() (owner only)"]
    end

    TRG["TransientReentrancyGuard.sol<br/>(tstore/tload, abstract — inherited,<br/>not called cross-contract)"]

    Exec --> Recover
    Exec -->|"1. verify signature, then"| EvalSpend
    Exec -->|"2. on allow, settle funds via"| SafeXfer
    Exec -->|"3. then report outcome via"| Record

    EvalSpend -.->|"checked against"| AuthCaller
    Record -.->|"checked against"| Reporters

    AgentWalletGuard -.->|inherits nonReentrant from| TRG
    PolicyEngine -.->|inherits nonReentrant from| TRG

    style PolicyEngine fill:#2b8a3e,color:#fff
    style AgentWalletGuard fill:#1864ab,color:#fff
    style ReputationRegistry fill:#9c36b5,color:#fff
```

## 4. Deployment Diagram

Production topology as configured in `docker/docker-compose.yml` and
`deploy/kubernetes/*.yaml`.

```mermaid
flowchart TB
    Internet(["Internet"])

    subgraph K8s["Kubernetes namespace: agentguard (deploy/kubernetes/, deploy/terraform/)"]
        Ingress["Ingress / LoadBalancer"]

        subgraph WebPods["agentguard-web Deployment"]
            WebPod["Nginx Alpine container<br/>serving apps/web static build<br/>(brotli/gzip, strict CSP)"]
        end

        subgraph GwPods["agentguard-gateway Deployment"]
            GwPod["Node.js container<br/>services/gateway<br/>(2 vCPU / 2GB per replica, HPA)"]
        end
    end

    RPC[("Monad RPC<br/>testnet-rpc.monad.xyz<br/>+ fallback nodes")]
    Chain[("Monad Parallel EVM<br/>PolicyEngine / AgentWalletGuard /<br/>ReputationRegistry, Chain 10143")]

    Internet --> Ingress
    Ingress -->|"/ (port 3110/80)"| WebPod
    Ingress -->|"/gateway (port 8080)"| GwPod

    WebPod -- "read-only viem calls" --> RPC
    GwPod -- "evaluate() view calls +<br/>executeGatedPayment() writes<br/>(relayer key from secret store)" --> RPC
    RPC --> Chain

    style K8s fill:#212529,color:#fff
```

---

**Local/single-host alternative:** `docker/docker-compose.yml` runs the same
two containers (`agentguard-web` on `:3110`, `agentguard-gateway` on `:8080`)
without Kubernetes, for local development and small deployments — see
`make docker-up`.
