# ComputeX Architecture & System Design Blueprint

## 1. Executive Summary & Core Principles

ComputeX is a high-performance, non-custodial Decentralized Physical Infrastructure Network (DePIN) and Central Limit Order Book (CLOB) marketplace for high-density CPU and GPU compute, settled natively on the **Monad Parallel EVM** (Chain ID `10143`, 400ms block time, 800ms deterministic finality).

The architecture is built on five non-negotiable engineering principles:

1. **Strict Zero-Mock Mandate**: All balances, order depths, machine allocations, and telemetry readings derive from live onchain smart contracts, physical hardware sensors (`libc::getloadavg`, NVML), or the microsecond Rust matching engine.
2. **Deterministic Delivery-versus-Payment (DvP)**: Compute capacity vouchers (ERC-1155) and native escrow payments clear atomically on Monad within a single block. Sellers receive payouts only as capacity is verified and streamed.
3. **Sub-Microsecond Execution Physics**: The order matching engine operates strictly in-memory in Rust with sub-3μs latency, cacheline-aligned order books, a single-producer single-consumer (SPSC) ring buffer, and an asynchronous `memmap2` Write-Ahead Log (WAL).
4. **Parametric SLA Staking & 3-of-5 Multi-Oracle Quorum**: Providers bond native MON collateral to guarantee 99.50% uptime and <50ms network latency. SLA breaches trigger automated, mathematically enforced slashing without human governance intervention.
5. **Strict Role Exclusivity (Buyer vs. Seller Separation)**: A user interacts with the platform as either a Compute Buyer (Tenant) or a Node Operator (Seller), never both simultaneously in the same interface context.

> [!NOTE]
> For the comprehensive commercial strategy, competitor benchmark matrices (Vast.ai, RunPod, Akash, CoreWeave), 3-horizon GTM, and 3-year financial forecasts, see **[Business Plan & Commercial Roadmap](BUSINESS_PLAN.md)**.

> [!IMPORTANT]
> The execution plan for production hardening, enterprise controls, UI/UX redesign, terminology, and role-based navigation is maintained in **[Production Readiness & Global Product Plan](PRODUCTION_READINESS_PLAN.md)**. The plan is authoritative for release sequencing; this document remains the system-design reference.

---

## 2. Bounded Context Topography

The platform is partitioned into four decoupled Domain-Driven Design (DDD) bounded contexts:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ComputeX Enterprise Topography                                    │
│                                                                                                         │
│  ┌─────────────────────────────────┐   WebSocket (Port 9101)   ┌─────────────────────────────────────┐  │
│  │   Cloud Management Console      │◄─────────────────────────►│    Rust CLOB Matching Engine        │  │
│  │   • React 19 + Tailwind CSS     │   EIP-712 Signed Orders   │    • Sub-3μs In-Memory Orderbook    │  │
│  │   • GCP/AWS Navigation Matrix   │                           │    • Lockless SPSC Ring Buffer      │  │
│  │   • 60 FPS HTML5 Canvas Depth   │                           │    • Asynchronous memmap2 WAL       │  │
│  │   • Privy Auth (Chain 10143)    │                           │    • Avellaneda-Stoikov Market Maker│  │
│  └────────────────┬────────────────┘                           └──────────────────┬──────────────────┘  │
│                   │                                                               │                     │
│                   │ Viem 2.x RPC                                                  │ SettleBatch()       │
│                   ▼                                                               ▼                     │
│  ┌─────────────────────────────────┐   Slashing Calldata       ┌─────────────────────────────────────┐  │
│  │   Monad Parallel EVM Contracts  │◄──────────────────────────│   Telemetry & SLA Oracle Quorum     │  │
│  │   • ComputeCLOBSettlement.sol   │                           │   • 3-of-5 Threshold Consensus      │  │
│  │   • ComputeToken.sol (ERC-1155) │                           │   • DuckDB In-Process OLAP Engine   │  │
│  │   • ParametricSLAVault.sol      │                           │   • TCP Handshake & SYN Probes      │  │
│  └────────────────▲────────────────┘                           └──────────────────▲──────────────────┘  │
│                   │                                                               │                     │
│                   │ Onchain Mint Verification & Escrow Lock                       │ Telemetry Samples   │
│                   └───────────────────────────────┬───────────────────────────────┘                     │
│                                                   │                                                     │
│                                                   ▼                                                     │
│                                    ┌─────────────────────────────┐                                      │
│                                    │ Physical Provider Gateway   │                                      │
│                                    │ • computex-daemon (systemd) │                                      │
│                                    │ • Docker / cgroups Isolator │                                      │
│                                    │ • WireGuard Mesh (wg0)      │                                      │
│                                    │ • Cloud Drivers (RunPod API)│                                      │
│                                    └─────────────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Subsystem Technical Specifications

### A. Monad Parallel EVM DvP Settlement Layer
- **Target Network**: Monad Testnet (Chain ID `10143`).
- **Core Smart Contracts**:
  - `ComputeCLOBSettlement.sol`: Manages non-custodial multi-asset escrow (`escrowBalances` for native MON and `tokenEscrows` for ERC-20 USDC), enforces monotonic `batchSequenceId` to eliminate mempool front-running, verifies EIP-712 maker/taker signatures, executes partial fills, and settles trades atomically via `settleBatch` and `settleBatchWithToken`.
  - `ComputeToken.sol`: ERC-1155 cryptographic capacity voucher contract. Minted upon trade clearing, representing the exact number of seconds a tenant is authorized to execute workloads on a specific hardware node.
  - `ParametricSLAVault.sol`: Custodies provider bonded MON collateral, tracks dynamic reputation scores, and executes automated slashing upon receipt of a verified 3-of-5 threshold multi-signature attestation.
  - `TransientReentrancyGuard.sol`: Utilizes EVM transient storage (`tstore` / `tload` opcodes) for zero-gas-overhead reentrancy protection during high-frequency batch settlement.
- **Dual-Asset Financial Division**:
  - **Rental Unit of Account (USDC)**: Quoted strictly in USD. SettleBatchWithToken routes 6-decimal micro-USDC (`$ USD / 3600`) directly from buyer escrow to seller earnings, completely eliminating crypto price volatility risk for data center power bills and AI engineering budgets.
  - **Network Fuel & Security Anchor (MON)**: 18-decimal native MON powers ~400ms parallel settlement gas fees and acts as the economic "skin-in-the-game" bonded by providers in `ParametricSLAVault.sol`.

### B. Rust CLOB Matching Engine (`computex-engine`)
- **Transport**: WebSockets listening on `0.0.0.0:9101`.
- **Latency Profile**: Sub-3 microseconds execution hot path.
- **Internal Data Structures**:
  - Double-ended contiguous price levels with FIFO priority.
  - SPSC lockless ring buffer for sub-microsecond IPC between network ingestion threads and the matching core.
  - `memmap2` Write-Ahead Log (WAL) with memory locking (`mlock`) to prevent page swaps.
- **Replication**: Active-Passive high-availability state replication with automatic failover in <50ms.
- **Solvency Canary**: Continuous background invariant auditor asserting:
  $$\sum \text{LockedMakerMargins} + \sum \text{LockedTakerMargins} \le \text{EscrowContractBalance}$$

### C. Telemetry & SLA Oracle Quorum (`computex-oracle`)
- **Port**: Listening on `0.0.0.0:9002`.
- **Sampling Mechanism**: Probes physical hardware nodes every 400ms:
  - Network Ping: `std::net::TcpStream::connect_timeout` evaluating real round-trip TCP handshakes (<50ms SLA).
  - CPU & GPU Load: `libc::getloadavg` evaluating true 1m/5m/15m system load.
  - Memory: `/proc/meminfo` querying real physical memory allocation.
- **Consensus**: 3-of-5 threshold multi-signature quorum over EIP-712 `SlashAttestation` payloads.
- **OLAP Storage**: Embedded DuckDB engine storing compressed, zero-copy Parquet telemetry records for auditing.

### D. Provider Host Daemon & Integration Gateway
- **Bare-Metal Daemon (`computex-daemon`)**: Lightweight Rust binary running as a Linux `systemd` service on provider machines.
  - Hardware Discovery: Inspects PCIe topology and NVML drivers (`nvidia-smi`).
  - Container Orchestration: Spawns isolated Docker / containerd instances with NVIDIA Container Toolkit passthrough (`--gpus all`) and restricted cgroups v2.
  - Networking: Spawns an isolated WireGuard overlay network interface (`wg0`) inside subnet `10.143.0.0/16`.
  - Ephemeral User Creation: Creates temporary tenant users (`tenant_<addr>`) and injects buyer SSH keys directly into `~/.ssh/authorized_keys`.
- **Cloud Datacenter API Adapters**: Concrete drivers for external compute aggregators:
  - `RunPodDriver`: GraphQL on-demand pod launch with injected SSH keys.
  - `LambdaLabsDriver`: REST API launch for H100 SXM5 instances.
  - `EquinixMetalDriver`: Automated PXE bare-metal provisioning.

---

## 4. Mathematical Invariants & Economics

### A. Delivery-versus-Payment (DvP) Solvency Invariant
For every matched order of rate $R$ (wei per second) and duration $T$ (seconds):
$$\text{GrossValue} = R \times T$$
$$\text{ProtocolFee} = \text{GrossValue} \times \frac{\text{protocolFeeBps}}{10,000} \quad (\text{Default: } 15 \text{ bps or } 0.15\%)$$
$$\text{SellerPayout} = \text{GrossValue} - \text{ProtocolFee}$$

**Solvency Invariant**:
$$\text{BuyerEscrow}_{\text{after}} = \text{BuyerEscrow}_{\text{before}} - \text{GrossValue} \ge 0$$

### B. Parametric Slashing Payout Curve
When an SLA breach is proven via 3-of-5 oracle consensus, the provider's bonded stake $S$ is liquidated:
$$\text{BuyerCompensation} = 0.80 \times S$$
$$\text{KeeperLiquidationBounty} = 0.10 \times S$$
$$\text{ProtocolBurnReserve} = 0.10 \times S$$

### C. Continuous Streaming Burn Rate & Escrow Runway
For active streaming leases, escrow is burned dynamically:
$$\text{BurnRate}_{\text{wei/sec}} = \sum_{i \in \text{Leases}} \frac{\text{HourlyRate}_i}{3600}$$
$$\text{RunwaySeconds} = \frac{\text{AvailableEscrowBalance}_{\text{wei}}}{\text{BurnRate}_{\text{wei/sec}}}$$

- **Warning Threshold**: Dispatched when $\text{RunwaySeconds} < 10,800\text{s}$ (3 hours).
- **Grace Period**: If escrow reaches zero, a 30-minute freeze window is granted before container termination.

### D. Monotonic Batch Sequencing
To neutralize parallel mempool race conditions and front-running on Monad:
$$\text{batchSequenceId}_{k+1} = \text{batchSequenceId}_k + 1$$
Any transaction with an out-of-order sequence ID reverts instantly.

---

## 5. Tax, Invoicing & Cross-Border Regulatory Architecture

Compute capacity leases in decentralized networks constitute **Electronically Supplied Services (ESS)** / Infrastructure-as-a-Service (IaaS). The platform provides an enterprise tax compliance framework:

### A. Jurisdictional Tax Classification
* **United States (State Sales & Use Tax)**: Varies by state economic nexus (e.g., Texas taxes data processing services at 80% taxable base; California exempts raw infrastructure compute; New York taxes software/SaaS).
* **European Union (EU VAT & MOSS/OSS)**: Classified as digitally supplied telecom/compute services.
  * **B2B (Cross-Border Reverse Charge)**: When a business buyer provides an authorized EU VAT ID (via VIES validation), 0% tax is collected at settlement. The enterprise buyer self-assesses VAT in their local jurisdiction.
  * **B2C (Retail Consumers)**: VAT is collected based on customer IP / residence country (standard rates between 17% and 27%) and remitted through the EU Import One Stop Shop (IOSS / OSS).
* **APAC / India (GST & OIDAR)**: Subject to 18% Goods and Services Tax under Online Information Database Access and Retrieval (OIDAR) rules for non-registered B2C buyers.

### B. Onchain Tax Split & Withholding Model
When tax collection is active for a taxable retail jurisdiction, the matching engine calculates the tax liability offchain and includes it in the DvP settlement tuple:
$$\text{TotalCharge} = \text{ComputeCost} + \text{ProtocolFee} + \text{ApplicableTax}$$
* The `ComputeCost - ProtocolFee` is credited to the seller.
* The `ApplicableTax` is transferred to a dedicated `TaxWithholdingVault` contract or swept directly to fiat tax escrow accounts.

### C. Node Operator / Seller Information Reporting (IRS 1099-DA & EU DAC8)
* **IRS Form 1099-DA (Digital Asset Broker Reporting)**: Node operators earning MON rewards for compute capacity exceeding gross reportable thresholds (\$600/year) have access to automated tax ledgers.
* **DAC8 Directive (EU)**: Direct reporting of crypto-asset transaction proceeds for EU-resident hardware providers.
* **Cryptographic Tax Invoices & CSV Exports**: Every onchain settlement batch produces an EIP-712 cryptographic invoice containing:
  1. Transaction Hash & Monad Block Timestamp
  2. Buyer & Seller Wallet Addresses / Verified Legal Tax IDs
  3. Fair Market Value (FMV) in USD/EUR at the exact 400ms block clearance time
  4. Deducted Protocol Fees and Allocated Capacity Seconds

---

## 6. Acceptable Use Policy (AUP), Abuse Sentinel & Provider Safe Harbors

Because decentralized physical nodes host third-party tenant workloads, ComputeX enforces a multi-layered security and legal defense architecture against spam, DDoS, botnets, and illicit compute operations:

### A. Cryptographic Terms of Service & AUP Binding
* Before an account can submit orders on the CLOB or register a node, the tenant must cryptographically sign the **Acceptable Use Policy (AUP)** via EIP-712 or Privy authentication.
* The signed attestation binds:
  $$\text{AUPDigest} = \text{keccak256}(\text{AUP\_VERSION}, \text{TenantAddress}, \text{BlockTimestamp}, \text{ClientIP})$$
* **Prohibited Workloads**:
  1. High-volume outbound denial-of-service (DDoS) reflection attacks or SYN floods.
  2. Outbound spam generation (TCP Port 25 SMTP relaying).
  3. Malware distribution, ransomware C2 servers, or illegal content hosting.
  4. Unauthorized cryptocurrency mining (Stratum protocol violation).

### B. Host Daemon Egress Firewall & Network Sandboxing
The host daemon (`computex-daemon`) configures Linux kernel `nftables` / eBPF rules upon spawning any tenant container:
* **Default Port Egress Blocking**:
  - `TCP 25, 465, 23`: Completely blocked to prevent SMTP spam and unencrypted Telnet vulnerabilities.
  - `UDP 53, 123, 1900, 389`: Blocked to prevent amplification reflection attacks.
  - `TCP 3333, 4444, 5555, 14444`: Blocked to prevent unauthorized Stratum cryptojacking pools.
* **SYN Rate Limiting**: Outbound connection attempts are capped via token bucket (default 1,000 SYN/sec) to prevent horizontal port scanning.

### C. Automated Abuse Sentinel & Emergency Killswitch (<500ms)
* **Abuse Ingest Feeds**: Physical nodes ingest real-time threat intelligence feeds (Spamhaus DROP, AbuseIPDB, and local eBPF NetFlow anomaly alerts).
* **Emergency Deprovisioning Sequence**:
  1. An abuse alert produces an `AbuseSentinelIncident` record with packet capture evidence hash.
  2. The host daemon immediately issues `SIGKILL` to the container:
     $$\text{docker kill } \text{pod\_<id>} \quad \implies \quad \text{wg set wg0 peer } \text{remove}$$
  3. WireGuard mesh routing is severed, and NVMe ephemeral storage is discarded.
  4. The incident is logged onchain, the tenant's remaining unspent escrow is frozen, and their address is blacklisted.

### D. Provider Safe Harbor & Passive Carrier Protection
* Node operators operate strictly as **Passive Technical Conduits / Infrastructure Carriers** under:
  - **United States**: DMCA 17 U.S.C. § 512 (Safe Harbor) and Communications Decency Act 47 U.S.C. § 230.
  - **European Union**: Digital Services Act (EU DSA Articles 4–6, Mere Conduit exemption).
* The tenant's signed EIP-712 AUP agreement grants explicit indemnification, establishing tenant sole legal liability and protecting physical hardware hosts from liability for tenant actions.

---

## 7. Tiered Persistence & User Identity Architecture

ComputeX replaces monolithic relational database bottlenecks with an institutional 4-tier storage and identity topology:

```
                            TIERED STORAGE & IDENTITY TOPOLOGY
                            
  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │ 1. Cryptographic Identity & Auth (Privy HSM Enclave)                                  │
  │ • User DID: did:privy:cmton...                                                        │
  │ • Verified Email Factor (via 6-digit Headless OTP)                                    │
  │ • Embedded Non-Custodial MPC Key (Monad Parallel EVM derived via Shamir shares)       │
  │ • ES256 Token Validation against PRIVY_VERIFICATION_KEY (12-Factor .env.example)      │
  └──────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │
                                             ▼
  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │ 2. Financial Ledger & Asset Ownership (Monad Parallel EVM)                           │
  │ • Escrow Balances: ComputeCLOBSettlement.sol mapping(address => uint256)              │
  │ • Capacity Vouchers: ComputeToken.sol (ERC-1155) mapping(tokenId => mapping(address)) │
  │ • Staked Collateral & Reputation: ParametricSLAVault.sol                              │
  └──────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │
                                             ▼
  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │ 3. Microsecond Trading Hot Path (Zero-Allocation Memory + memmap2 WAL)               │
  │ • In-Memory Order Book: BTreeMap price ladders + intrusive doubly-linked queues       │
  │ • Append-Only WAL: memmap2 with libc::mlock to eliminate kernel page fault jitter     │
  │ • Instant Recovery: wal.replay() restores resting orders in < 2ms                     │
  └──────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │
                                             ▼
  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │ 4. Telemetry, SLA Probes & Analytics (DuckDB 1.1 OLAP + Parquet)                      │
  │ • Vectorized Time-Series: In-process DuckDB analyzing GPU VRAM, load, and ping        │
  │ • Real-Time EWMA: Exponentially Weighted Moving Averages trigger parametric slashing  │
  │ • Cold Compliance Archival: ZSTD-compressed Apache Parquet exports                    │
  └───────────────────────────────────────────────────────────────────────────────────────┘
```

### A. Non-Custodial Identity vs. Web2 User Tables
* In ComputeX, user passwords and private keys are **never stored in a database**.
* The user's decentralized identity (`did:privy:...`) is issued by Privy's HSM enclave.
* The Rust backend (`computex-core/src/auth.rs`) verifies the Privy JWT token using the dynamic environment key `PRIVY_VERIFICATION_KEY` and binds the authenticated session to the user's verified Monad wallet address.
* Any order submitted over WebSocket must satisfy:
  $$\text{order.maker} == \text{session.wallet\_address}$$
  Neutralizing all identity spoofing or balance impersonation vectors.

### B. Dynamic 12-Factor Configuration
All platform environment variables (RPC endpoints, contract addresses, ports, and Privy public keys) are managed via standard `.env.example` configurations, prohibiting any hardcoded keys in release binaries.

---

## 8. The 5 Gold-Standard Capability Pillars & Microservices Architecture

ComputeX elevates DePIN clearing to institutional standards through five core capability pillars:

```
                  THE 5 GOLD-STANDARD CAPABILITY PILLARS
                  
  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐
  │ Pillar 1: Zero-Trust Ingress    │   │ Pillar 2: Low-Latency Wire      │
  │ • Subnet 10.143.0.0/16 Point-Pt │   │ • Binary Frame (0x4358 + CRC32) │
  │ • Ephemeral Ed25519 SSH Keys    │   │ • FIX 4.4 / 5.0-SP2 Gateway     │
  │ • In-Browser Web Terminal       │   │ • Sub-3μs Zero-Allocation Parse │
  └────────────────┬────────────────┘   └────────────────┬────────────────┘
                   │                                     │
                   ▼                                     ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │ Pillar 3: Multi-Asset Monad DvP Settlement Engine                     │
  │ • Native MON + ERC-20 (USDC, USDT) Dual Clearing                      │
  │ • Non-Custodial tokenEscrows(token, user) Isolated Accounting         │
  │ • Atomic Delivery vs Payment with Monotonic batchSequenceId           │
  └──────────────────────────────────┬────────────────────────────────────┘
                                     │
                   ┌─────────────────┴─────────────────┐
                   ▼                                   ▼
  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐
  │ Pillar 4: Solvency & Chaos DST  │   │ Pillar 5: Institutional Tooling │
  │ • Formal Conservation Invariant │   │ • @computex/cli Unified Tool    │
  │ • Simulated Bit-Flips & Drops   │   │ • Kubernetes Device Plugin      │
  │ • Deterministic Order Fuzzing   │   │ • Automated DaemonSet Generator │
  └─────────────────────────────────┘   └─────────────────────────────────┘
```

### A. Pillar 1: Zero-Trust WireGuard Ingress & Embedded Web Terminal
- **Ingress Controller** (`services/provisioning-controller/src/IngressController.ts`):
  - Deterministic peer IP assignment on the isolated `10.143.0.0/16` network.
  - Ephemeral Ed25519 OpenSSH keypair generation with automatic TTL expiration.
  - Authenticated session tokens for in-browser shell access.
- **Credential Delivery & Ingress** (`apps/web/src/components/buyer/CredentialDelivery.tsx`):
  - Zero-mock cryptographic credential delivery UI providing authentic OpenSSH Ed25519 commands, session expiry countdowns, live RTT ping indicators, and Point-to-Point WireGuard `.conf` profile exports without mock command loops.

### B. Pillar 2: Binary Framing & Institutional FIX Protocol
- **High-Performance Binary Wire** (`crates/computex-protocol/src/binary.rs`):
  - 30-byte fixed header: magic `0x4358` (`CX`), protocol version `0x01`, message type, sequence number, timestamp, payload length, and CRC32 IEEE 802.3 checksum.
- **Institutional FIX Gateway** (`crates/computex-protocol/src/fix.rs`):
  - Tag-value parser supporting FIX 4.4 and 5.0-SP2 message sets (`SubmitOrder`, `OrderAccepted`, `TradeExecuted`, `CancelOrder`).

### C. Pillar 3: Multi-Asset Escrow & DvP Settlement on Monad Parallel EVM
- **Solidity Contract** (`contracts/src/core/ComputeCLOBSettlement.sol`):
  - `tokenEscrows(address token, address user)` mapping for non-custodial multi-currency management.
  - `depositToken()`, `withdrawToken()`, and `settleBatchWithToken()` ensuring atomicity between token transfers and ERC-1155 capacity voucher minting.

### D. Pillar 4: Formal Solvency Invariants & Deterministic Simulation Testing (DST)
- **Solvency Invariants**:
  $$\sum \text{tokenEscrows}(t, u) + \text{protocolFees}(t) \equiv \text{token.balanceOf}(\text{SettlementContract})$$
- **Fee Conservation**:
  $$\text{sellerPayout} + \text{protocolFee} \equiv \text{grossNotional}$$
- **Chaos Harness** (`crates/computex-engine/tests/dst_chaos_tests.rs`):
  - Randomized order scheduling, simulated packet drops, and wire fuzzing.

### E. Pillar 5: Production `@computex/cli` & Kubernetes Device Plugin
- **CLI Package** (`packages/computex-cli`):
  - `computex status`: Node telemetry, quorum health, block height.
  - `computex catalog`: Machine type matrix and pricing.
  - `computex order`: EIP-712 order builder and submitter.
  - `computex ssh`: Ephemeral key credentials and SSH command generation.
  - `computex wireguard`: Client VPN profile generator.
  - `computex k8s-manifest`: Automated Kubernetes GPU DaemonSet manifest generator.
