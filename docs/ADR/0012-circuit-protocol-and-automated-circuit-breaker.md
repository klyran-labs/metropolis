# ADR 0012: Circuit Protocol Rebrand & Financial Circuit Breaker Invariant Architecture

## Status
**Accepted; code implemented, live deployment validation pending**

## Context
In ADR 0001 through ADR 0011, the protocol was established under the project name `AgentGuard` focusing on spend control, disjoint storage slots, x402 payment negotiation, and enterprise rate cards.

However, an exhaustive ecosystem review and trademark audit revealed:
1. **Severe Name Collision**: At least five separate open-source and commercial products currently use "AgentGuard" across Web2, .NET middleware, prompt-injection libraries (`WhitzardAgent/AgentGuard`), and consumer card apps.
2. **Category Ambiguity**: "Agent management" is crowded with low-value prompt wrappers, bot registries, and orchestrators. In contrast, enterprise CFOs, institutional treasuries, and hedge funds require an **un-hackable financial circuit breaker** that halts unauthorized transactions in sub-second execution.
3. **Monad Parallel Alignment**: Monad's parallel EVM architecture (400ms blocks, 800ms deterministic finality) requires a brand and mental model that reflects high-voltage, sub-block execution safety.

## Decision

We officially rebrand and reposition the system as **Circuit Protocol** (`Circuit`):
> **"Circuit: The Zero-Trust Financial Firewall and Clearing Layer for Autonomous Machine Economies on Monad."**

### 1. The $O(1)$ Financial Circuit Breaker Invariant
We introduce an explicit, $O(1)$ onchain kill-switch and emergency freeze mechanism directly inside the core vault state:

```solidity
mapping(address => bool) public circuitBroken;
mapping(address => address) public agentAdmins;

function tripCircuitBreaker(address agent) external {
    require(msg.sender == agentAdmins[agent] || msg.sender == GOVERNANCE, "ERR_UNAUTHORIZED");
    circuitBroken[agent] = true;
    emit CircuitBreakerTripped(agent, msg.sender);
}

function resetCircuitBreaker(address agent) external {
    require(msg.sender == agentAdmins[agent] || msg.sender == GOVERNANCE, "ERR_UNAUTHORIZED");
    circuitBroken[agent] = false;
    emit CircuitBreakerReset(agent, msg.sender);
}
```

* **Short-Circuit Evaluation**: Any state-mutating transaction (`allocateEpochBucket`, `settleVoucherDelta`, `terminalClose`) asserts `require(!circuitBroken[agent], "ERR_CIRCUIT_BREAKER_ACTIVE")` before evaluating complex mathematical policies.
* **Blast-Radius Containment**: If an agent is prompt-injected, behaves erratically, or violates an offchain telemetry heuristic, the enterprise admin or an automated watcher trips the circuit breaker in **one single transaction (400ms)**, freezing all further capital movement instantly.

### 2. Dual-Role Enterprise Authority Hierarchy
We enforce cryptographic role separation:
* **Enterprise Controller (`agentAdmins`)**: Authenticated human operator or multisig (Privy/Turnkey) with exclusive authority to trip/reset circuit breakers, assign budgets, and register agents.
* **Autonomous Agent (`0xAgent`)**: Headless session key authorized only to sign EIP-712 spend vouchers. The agent cannot alter its own risk policies, register admins, or reset its circuit breaker.

## Consequences

### Positive
* **Market Differentiation**: Positions the protocol as an indispensable institutional risk primitive ("The Circuit Breaker for Autonomous AI") rather than a generic agent manager.
* **Instant Incident Response**: Enables automated SecOps systems to freeze rogue agents in under 400 milliseconds.
* **Zero Overhead**: Checking a boolean storage slot in parallel EVM execution incurs negligible gas and execution latency.

### Negative / Trade-offs
* Requires updating all user-facing documentation, CLI namespaces (`@circuit/cli`), and UI references from `AgentGuard` to `Circuit`.
