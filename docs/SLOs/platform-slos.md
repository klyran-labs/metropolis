# ComputeX Production Service Level Objectives (SLOs) & Error Budgets

## 1. Overview & Google-Style SRE Principles

ComputeX adopts Google Site Reliability Engineering (SRE) disciplines:
1. **Separation of Concerns**: Benchmark latency, user-visible network latency, and settlement finality are measured and alerted independently.
2. **Error Budget Policy**: Exceeding an error budget halts non-critical feature rollouts and redirects engineering capacity to reliability, resilience, and root-cause postmortems.

---

## 2. Core Platform SLO Targets

| Objective | Metric Indicator (SLI) | Target SLO | Measurement Window | Error Budget |
| :--- | :--- | :--- | :--- | :--- |
| **API Gateway Availability** | Successful HTTP 2xx/3xx / Total Requests | **99.95%** | Rolling 30 Days | 0.05% (21.9 min downtime) |
| **WebSocket Gateway Availability** | Stable connections maintaining heartbeat without drop | **99.95%** | Rolling 30 Days | 0.05% |
| **Order Admission Latency** | Time from TCP ingress to order validation & WAL enqueue | **p99 < 10 ms** | Rolling 24 Hours | 1% of orders > 10ms |
| **In-Memory Matching Latency** | Engine matching loop execution duration | **p99 < 3 µs** | Isolated Benchmark | 1% of matches > 3µs |
| **Settlement Submission Latency** | Offchain match to Monad batch transaction broadcast | **99% ≤ 2 blocks** (~800ms) | Rolling 24 Hours | 1% > 2 blocks |
| **Telemetry Probe Freshness** | Host daemon metric timestamp delta | **99% < 2.0 s** | Rolling 24 Hours | 1% > 2s |
| **Recovery Point Objective (RPO)** | Acknowledged orders lost upon sudden crash/power loss | **0 Orders** (Zero loss) | Crash Scenario | 0 tolerance |
| **Recovery Time Objective (RTO)** | Deterministic WAL recovery & engine cold restart | **< 60 seconds** | Disaster Recovery | 60 seconds |

---

## 3. Observability & Telemetry Signals

1. **Prometheus Metrics**:
   - `computex_engine_orders_submitted_total`: Counter tracking order submissions.
   - `computex_engine_matches_total`: Counter tracking matched trades.
   - `computex_engine_match_latency_nanoseconds`: Histogram of matching loop execution.
   - `computex_wal_writes_total`: Number of bytes synced to disk.
   - `computex_settlement_batch_duration_seconds`: Histogram of Monad block confirmation.
2. **Health Endpoints**:
   - `GET /health`: Liveness probe verifying matching thread and memory locks.
   - `GET /metrics`: Standard Prometheus text exposition on port `9003`.
3. **Structured Audit Logs**:
   - Every financial mutation (deposit, trade match, settlement batch, slash) emits a JSON audit payload logged to `/var/log/computex/audit.log` with sha256 correlation IDs.
