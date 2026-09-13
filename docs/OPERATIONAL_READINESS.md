# AgentGuard Operational Readiness & Production Specification

> **Status: target operating model, not yet live.** No AgentGuard contract has been deployed to Monad testnet or mainnet yet (see `docs/GAP_ANALYSIS.md`). The SLA/SLO targets below are the design goal for when a real deployment exists, not measurements of a running system.

This document details the production deployment, infrastructure requirements, and operational SLAs for running AgentGuard on Monad Parallel EVM.

---

## 1. Gateway & Control Plane Architecture

The production environment consists of two primary services:
1. **AgentGuard x402 Payment Gateway (`agentguard-gateway`)**, implemented at
   `services/gateway` (see `services/gateway/README.md`):
   - High-throughput Rust microservice (built on Tokio, Axum, and Alloy-RS) issuing x402 challenges,
     verifying EIP-712 spend request signatures in sub-50 microseconds, pre-flight-simulating against `PolicyEngine.evaluate`,
     administering operator roles via Privy Server API, and relaying settlement to `AgentWalletGuard.executeGatedPayment`.
   - Resource requirements: 2 vCPU, 2GB RAM per replica, horizontally scalable behind a load balancer (~14MB minimal Alpine runtime).
   - Target latency: **< 1ms p99 for offchain signature verification** (compiled Rust cryptography, sub-50µs pure compute) —
     while the pre-flight `evaluate` policy simulation involves a Monad RPC round-trip, budgeted separately
     (target **< 50ms p99**, dependent on RPC provider latency and geographic proximity to Monad RPC nodes).
2. **AgentGuard Web Control Plane (`agentguard-web`)**:
   - Ultra-fast static container served by Alpine Nginx with brotli/gzip compression and strict CSP headers.
   - Direct connection to Monad Testnet RPC (`https://testnet-rpc.monad.xyz`) via Viem 2.x.

---

## 2. Monad RPC Connectivity & Network Reliability

- **Chain ID**: 10143 (Monad Testnet)
- **Block Time**: 400ms
- **Deterministic Finality**: 2 blocks (800ms)
- **RPC Resiliency**: Gateway instances must configure fallback RPC nodes with automated failover to prevent transaction dropouts during transient network partitions.

---

## 3. High-Priority Metrics & Alerting

| Metric | Target | Alert Threshold | Escalation Action |
| :--- | :--- | :--- | :--- |
| Gateway Latency (p99) | < 10ms | > 50ms for 2m | Scale gateway replicas |
| Monad Settlement Latency | < 800ms | > 2000ms | Check RPC node sync status |
| ReasonCode Spikes (Code 5) | Baseline | 50 denials / 1m | Notify agent operator of runaway loop |
| Kill Switch Execution Latency | < 800ms | > 1200ms | Escalate to on-call blockchain engineer |
