# AgentGuard Service Level Objectives (SLOs) & Reliability Targets

## 1. Overview & Google-Style SRE Disciplines

AgentGuard adopts rigorous Site Reliability Engineering (SRE) practices:
1. **Risk Isolation**: Policy evaluation failures must fail closed to protect agent treasury funds.
2. **Deterministic Settlement**: Sub-second payment clearing on Monad Parallel EVM (400ms blocks).

---

## 2. Core Platform SLO Targets

| Objective | Metric Indicator (SLI) | Target SLO | Measurement Window | Error Budget |
| :--- | :--- | :--- | :--- | :--- |
| **Gateway Availability** | Successful HTTP responses / Total Requests | **99.95%** | Rolling 30 Days | 0.05% (~21.9 min) |
| **x402 Verification Latency** | Time from HTTP 402 challenge to signature verification | **p99 < 5 ms** | Rolling 24 Hours | 1% > 5ms |
| **Onchain Evaluation Latency** | Monad `evaluateAndSpend` execution | **p99 ≤ 800 ms** (2 blocks) | Rolling 24 Hours | 1% > 800ms |
| **Emergency Kill Switch RTO** | Time to freeze compromised agent onchain | **< 800 ms** (1 block) | Incidents | 0 tolerance |
| **Zero Concurrency Aborts** | Abort rate from conflicting storage keys across agents | **0.00%** | Monad Execution | 0% tolerance |

---

## 3. Observability & Telemetry Signals

1. **Metrics**:
   - `agentguard_policy_evaluations_total`: Total evaluations segmented by `reasonCode`.
   - `agentguard_payments_executed_total`: Volume of authorized agent payments cleared.
   - `agentguard_kill_switch_triggers_total`: Count of emergency agent freeze operations.
2. **Health Endpoints**:
   - `GET /health`: Liveness and readiness probe for the x402 gateway.
