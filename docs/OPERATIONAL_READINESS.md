# ComputeX Operational Readiness & Physical Runtime Specification

This document details the production hardware, operating system, and container deployment requirements to maintain sub-microsecond matching latency and deterministic WAL persistence under peak load.

---

## 1. Physical Memory Locking (`mlock`)

### Objective & Architecture
The ComputeX Core Execution Engine writes incoming limit orders and fills directly to an append-only memory-mapped Write-Ahead Log (`memmap2`). Under heavy system RAM contention or background I/O spikes, default Linux kernel virtual memory subsystems may swap or page-out unreferenced `mmap` pages to disk swap space, introducing millisecond-scale page-fault latency spikes ($1000\times$ degradation).

### Implementation
- **Source Module**: `crates/computex-engine/src/wal.rs`
- **System Call**: `libc::mlock(self.mmap.as_ptr() as *const libc::c_void, self.capacity)`
- **Activation**: Enabled automatically when `COMPUTEX_ENABLE_MLOCK=true` or `COMPUTEX_ENABLE_MLOCK=1`.
- **Clean Teardown**: Upon engine termination or crash interception, `Drop` invokes `libc::munlock` after final WAL `msync`.

### Container & Host Configuration
To execute `mlock`, the runtime environment requires elevated capabilities and unlimited locked memory limits:

```yaml
# docker-compose.yml snippet
computex-engine:
  cap_add:
    - SYS_NICE
    - IPC_LOCK
  ulimits:
    memlock:
      soft: -1
      hard: -1
```

On bare-metal Linux hosts, configure `/etc/security/limits.conf`:
```text
computex   soft   memlock   unlimited
computex   hard   memlock   unlimited
```

---

## 2. Dedicated Physical CPU Core Affinity

### Objective & Architecture
Operating system schedulers frequently migrate active threads across different physical CPU cores. Such context switches invalidate L1/L2 instruction and data caches, introduce TLB shootdowns, and degrade the matching loop latency from 373ns to several microseconds.

### Implementation
- **Source Module**: `crates/computex-engine/src/affinity.rs`
- **System Call**: `libc::sched_setaffinity` with `libc::cpu_set_t`
- **Activation**: Controlled via the `COMPUTEX_CPU_CORE` environment variable (e.g., `COMPUTEX_CPU_CORE=0`).
- **Cross-Platform Safety**: On macOS and development platforms, non-Linux execution logs a diagnostic note without failing startup.

### Container & Host Configuration
Pin the container and matching process to an isolated physical core:

```yaml
# docker-compose.yml snippet
computex-engine:
  cpuset: "0" # Restricts container execution exclusively to physical core 0
  environment:
    - COMPUTEX_CPU_CORE=0
```

On bare-metal Linux hosts using `systemd` or `taskset`:
```bash
taskset -c 0 /usr/local/bin/computex-engine
```

For ultra-low latency setups, configure Linux kernel boot parameters:
```text
isolcpus=0 nohz_full=0 rcu_nocbs=0
```

---

## 3. Empirical Performance Profile

| Metric | Target SLA | Measured Benchmark Result |
| :--- | :--- | :--- |
| **In-Memory Matching Latency** | $< 3\mu\text{s}$ | **373 ns (0.373 µs)** |
| **Order Book Matching Throughput** | $> 1,000,000\text{ ops/sec}$ | **2,678,673 ops/sec (~2.68M ops/sec)** |
| **Zero-Copy WAL Append Throughput** | $> 10,000,000\text{ writes/sec}$ | **27,032,206 writes/sec (1.65 GB/sec)** |
| **Disaster Recovery WAL Replay** | $< 50\text{ms}$ | **596 µs (0.596 ms)** |
| **Monad Intra-Block Settlement** | $400\text{ms}$ finality | Enforced on Chain ID `10143` |

---

## 4. Network Socket Tuning & Slow Consumer Isolation

### TCP Socket Optimization (`TCP_NODELAY`)
- In high-frequency order placement, Nagle's algorithm accumulates small packets into larger buffers, adding up to 40ms of transmission delay.
- The matching engine explicitly enforces `stream.set_nodelay(true)` on every accepted TCP connection in `crates/computex-engine/src/server.rs`, guaranteeing immediate packet dispatch.

### Slow Consumer Isolation (`broadcast::RecvError::Lagged`)
- Under peak burst traffic, remote clients on cellular or high-latency connections may fail to drain their WebSocket buffers fast enough.
- ComputeX handles `broadcast::RecvError::Lagged(skipped)` without dropping client connections. The consumer skips directly to the newest L2 depth snapshot or trade without blocking the in-memory engine or dropping the session.

---

## 5. Telemetry REST API & Multi-Tier Gateway Architecture

### End-to-End Zero-Mock Routing
- **`computex-oracle` HTTP Service**: Exposes a zero-allocation REST API on port `9002` serving `/v1/telemetry/latest/:id` and health checks.
- **Nginx Gateway (`nginx.conf`)**: Proxies authenticated `/api/v1/` traffic to the API gateway. Telemetry is workspace-authorized there and the oracle remains private to the service network.

---

## 6. Linux Kernel `sysctl` High-Frequency Tuning

For bare-metal production hosts running high-concurrency order gateways:

```bash
# /etc/sysctl.d/99-computex.conf

# Increase maximum incoming connection backlog
net.core.somaxconn = 65535

# Increase socket read/write buffer boundaries
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# Increase memory map count for large WAL allocations
vm.max_map_count = 262144

# Reduce swap aggression to zero for deterministic memory performance
vm.swappiness = 0
```
