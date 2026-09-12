# ComputeX End-to-End System Flows & State Machines

This document provides exhaustive sequence diagrams, state machines, and technical walkthroughs for all seven primary operational workflows in ComputeX.

---

## Table of Contents
1. [Flow 1: Authentication & Role Exclusivity](#flow-1-authentication--role-exclusivity)
2. [Flow 2: Spot Order Placement & Microsecond Matching](#flow-2-spot-order-placement--microsecond-matching)
3. [Flow 3: Atomic Monad DvP Settlement & Voucher Minting](#flow-3-atomic-monad-dvp-settlement--voucher-minting)
4. [Flow 4: Physical Node Provisioning & Credential Handoff](#flow-4-physical-node-provisioning--credential-handoff)
5. [Flow 5: 3-of-5 SLA Oracle Probing & Parametric Slashing](#flow-5-3-of-5-sla-oracle-probing--parametric-slashing)
6. [Flow 6: Recurring Payments & Continuous Streaming Billing](#flow-6-recurring-payments--continuous-streaming-billing)
7. [Flow 7: Disaster Recovery & Crash Consistency](#flow-7-disaster-recovery--crash-consistency)

---

## Flow 1: Authentication & Role Exclusivity

ComputeX separates unauthenticated marketing visitors from authenticated enterprise operators, and strictly isolates the **Compute Buyer Console** from the **Node Operator / Seller Console**.

```mermaid
sequenceDiagram
    autonumber
    participant User as Enterprise User
    participant Privy as Live Privy SDK (App ID: cmton65...)
    participant Wallet as Web3 Injected Wallet (Viem 2.x)
    participant App as ComputeX App Shell (App.tsx)
    participant Context as MarketplaceContext

    User->>App: Visits https://computex.io/
    App->>App: Checks authentication state
    alt Unauthenticated
        App->>User: Renders Public Marketing Landing Page (Zero Debug Leaks)
        User->>Privy: Submits Email Address
        Privy->>User: Dispatches 6-digit OTP code to email
        User->>Privy: Submits OTP code
        Privy->>App: Emits authenticated session & embedded wallet
    else Web3 Wallet Connection
        User->>Wallet: Clicks "Connect Browser Wallet"
        Wallet->>App: eth_requestAccounts -> returns wallet address
    end

    App->>Context: Initializes user role (Buyer by default)
        Context->>Context: Resolves workspace persona from authenticated server membership
    alt Role == 'buyer'
        App->>User: Mounts Buyer Portal (Machine Matrix, Spot CLOB, Instances, Escrow)
    else Role == 'seller'
        App->>User: Mounts Seller Portal (Fleet Inventory, Asks, SLA Staking, Daemon)
    end
    Note over App,User: Buyer and Seller navigation controls are NEVER mixed in the same UI view.
```

---

## Flow 2: Spot Order Placement & Microsecond Matching

```mermaid
sequenceDiagram
    autonumber
    participant Buyer as Compute Buyer
    participant UI as Cloud Terminal (Terminal.tsx)
    participant Wallet as Web3 Wallet (eth_signTypedData_v4)
    participant WS as WebSocket Ingestion (Port 9101)
    participant Ring as Lockless SPSC Ring Buffer
    participant Matcher as Rust In-Memory Engine
    participant WAL as memmap2 Write-Ahead Log

    Buyer->>UI: Selects Machine Type (e.g. cGPU-H100-SXM5) & Rate (2.45 MON/hr)
    UI->>UI: Generates Ephemeral Secp256k1 ECDH Keypair
    UI->>UI: Encodes EIP-712 typed Order payload (pricePerSec, amountSec, ecdhPublicKey)
    UI->>Wallet: Requests signature (eth_signTypedData_v4)
    Wallet->>Buyer: Prompts signature confirmation
    Buyer->>Wallet: Signs order
    Wallet->>UI: Returns 65-byte ECDSA signature
    UI->>WS: Transmits Order JSON over WebSocket (Port 9101)
    WS->>WS: Recovers maker address via k256 & verifies nonces/expiry
    WS->>Ring: Enqueues order into SPSC lockless queue (<50ns)
    Ring->>Matcher: Dequeues order onto pinned CPU core
    Matcher->>WAL: Appends order entry to mmap Write-Ahead Log
    Matcher->>Matcher: Traverses price-time priority order book
    alt Match Found (Bid crosses resting Ask)
        Matcher->>WAL: Appends ExecutionMatch log
        Matcher->>WS: Broadcasts L2 Depth Delta & Settled Trade stream
        WS->>UI: Updates HTML5 Canvas Depth & Settled Trades table at 60 FPS
    else Resting Order
        Matcher->>Matcher: Inserts into contiguous price level FIFO queue
        Matcher->>WS: Broadcasts updated book depth
    end
```

---

## Flow 3: Atomic Monad DvP Settlement & Voucher Minting

```mermaid
sequenceDiagram
    autonumber
    participant Engine as Engine Settlement Keeper
    participant Monad as ComputeCLOBSettlement.sol
    participant Token as ComputeToken.sol (ERC-1155)
    participant Treasury as Protocol Treasury

    Engine->>Engine: Batches matched orders every 400ms Monad block
    Engine->>Monad: settleBatch(batchSequenceId, makers, takers, sigs, fillAmounts)
    Monad->>Monad: Asserts batchSequenceId == currentBatchSequenceId + 1 (Monotonic Guard)
    Monad->>Monad: Verifies EIP-712 maker and taker signatures
    Monad->>Monad: Validates nonces are not cancelled and orders not expired
    Monad->>Monad: Computes totalCost = pricePerSec * fillAmount

    Monad->>Monad: Asserts Buyer Escrow Balance >= totalCost (Solvency Invariant)
    Monad->>Monad: escrowBalances[buyer] -= totalCost
    Monad->>Monad: protocolFee = (totalCost * 15) / 10000 (0.15%)
    Monad->>Treasury: escrowBalances[treasury] += protocolFee
    Monad->>Monad: escrowBalances[seller] += (totalCost - protocolFee)

    Monad->>Token: mint(buyer, tokenId, fillAmount, "")
    Token->>Token: Mints ERC-1155 capacity voucher (seconds of execution)
    Monad->>Engine: Emits OrderSettled event
```

---

## Flow 4: Physical Node Provisioning & Credential Handoff

```mermaid
sequenceDiagram
    autonumber
    participant Monad as ComputeCLOBSettlement.sol
    participant Worker as Provisioning Orchestrator
    participant Daemon as Authenticated Host Agent
    participant Docker as Docker / cgroups Isolator
    participant WG as WireGuard Kernel (wg0)
    participant Oracle as 3-of-5 SLA Oracle (Port 9002)
    participant Tenant as Tenant (Buyer)

    Monad->>Worker: Settlement event makes order eligible for provisioning
    Worker->>Worker: Validates buyer, voucher, duration, provider, and organization binding
    Worker->>Daemon: Authenticated host provisioning request
    Daemon->>Daemon: Returns provider-issued namespace and WireGuard endpoint
    Worker->>Worker: Rejects missing or unverifiable host output
    Daemon->>Docker: Spawns isolated workload with GPU passthrough:
    Note over Daemon,Docker: docker run --gpus all -d --name tenant-pod -p 22022:22 computex/depin-base
    Daemon->>WG: Configures peer route from the allocated network namespace
    Daemon->>Daemon: Signs provider provisioning evidence
    Worker->>Worker: Publishes PREPARING then ACTIVE allocation lifecycle events
    Daemon->>Oracle: Submits provisioning evidence (provider-issued endpoint and instance ID)
    Oracle->>Daemon: Probes TCP port 22022 (<50ms handshake check)
    Oracle->>Monad: Submits Oracle Quorum Verification Attestation
    Worker->>Tenant: Access becomes available only after authenticated allocation confirmation
    Tenant->>Daemon: Connects through short-lived, allocation-scoped access
```

---

## Flow 5: 3-of-5 SLA Oracle Probing & Parametric Slashing

```mermaid
sequenceDiagram
    autonumber
    participant Node as Physical Provider Host
    participant Probes as 5 Independent Oracle Probes (Port 9002)
    participant Keeper as Slashing Keeper Bot
    participant Vault as ParametricSLAVault.sol
    participant Buyer as Aggrieved Buyer

    loop Every 400ms Monad Block
        Probes->>Node: TCP SYN Handshake & libc::getloadavg query
        Node-->>Probes: TCP ACK / Load Sample
    end

    alt Node Outage / Port Unreachable (>50ms ping or 0% uptime)
        Probes->>Probes: Detects SLA Breach (Uptime < 99.50% or Ping > 50ms)
        Probes->>Probes: Generates SlashAttestation struct
        Probes->>Probes: 3 of 5 independent oracles sign EIP-712 attestation
        Probes->>Keeper: Emits ThresholdProof (Attestation + 3 Signatures)
        Keeper->>Vault: executeParametricSlash(proof, signatures)
        Vault->>Vault: Recovers 3 oracle addresses from signatures
        Vault->>Vault: Validates quorum >= 3 and deadline not expired
        Vault->>Vault: Liquidates Provider Bonded MON Stake:
        Vault->>Buyer: 80% transferred directly to Buyer as damages
        Vault->>Keeper: 10% awarded to Keeper as liquidation bounty
        Vault->>Vault: 10% burned / reserved in protocol treasury
    end
```

---

## Flow 6: Recurring Payments & Continuous Streaming Billing

```mermaid
stateDiagram-v2
    [*] --> EscrowFunded: Buyer deposits MON into Escrow
    EscrowFunded --> StreamActive: Buyer initiates "⚡ RECURRING STREAM" Lease
    
    state StreamActive {
        [*] --> StreamingExecution
        StreamingExecution --> StreamingExecution: BurnRate (MON/sec) debited lazily
        StreamingExecution --> MarginWarning: Escrow Runway < 3 Hours
        MarginWarning --> StreamingExecution: Buyer Tops Up Escrow
    }
    
    MarginWarning --> GracePeriod: Escrow Balance Reaches 0.0000 MON
    
    state GracePeriod {
        [*] --> FrozenWorkload: Daemon pauses container (SIGSTOP)
        FrozenWorkload --> StreamActive: Top-up deposited within 30 min
        FrozenWorkload --> Terminated: 30-min window expires without top-up
    }
    
    StreamActive --> UserTerminated: Tenant clicks "STOP LEASE"
    UserTerminated --> [*]: Unused Escrow Refunded; Container Deprovisioned
    Terminated --> [*]: Container Destroyed; Storage Sanitized
```

---

## Flow 7: Disaster Recovery & Crash Consistency

```mermaid
sequenceDiagram
    autonumber
    participant Engine as computex-engine
    participant Disk as memmap2 WAL File (orderbook.wal)
    participant Backup as Passive Standby Engine

    Note over Engine,Disk: Normal Operation: Sub-3μs matching with mmap append
    Engine->>Disk: Writes binary Order & Match records
    Engine->>Backup: Asynchronous TCP state replication stream

    alt Process Crash / Power Outage
        Engine->>Engine: Process terminates abruptly
        Note over Backup: Standby detects heartbeat timeout in 45ms
        Backup->>Backup: Promotes to Active Primary
        Backup->>Disk: Opens orderbook.wal with memmap2
        Backup->>Backup: Replays binary records from last verified checkpoint
        Backup->>Backup: Reconstructs L2 Bids/Asks depth trees and nonce index
        Backup->>Backup: Asserts Solvency Canary invariant holds
        Backup->>Engine: Resumes WebSocket client connections on Port 9101
    end
```
