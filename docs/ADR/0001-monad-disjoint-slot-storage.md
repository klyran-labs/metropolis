# ADR 0001: Disjoint Per-Agent Storage Slot Packing on Monad Parallel EVM

## Status
Accepted

## Context
Monad executes transactions in parallel using Optimistic Concurrency Control (OCC). If two concurrent transactions read or write to the same storage slot, one transaction must abort and re-execute, introducing pipeline stalls and unpredictable tail latency. In high-frequency multi-agent environments, thousands of agent transactions execute concurrently.

## Decision
We partition contract storage strictly by agent address:
1. `mapping(address => PackedState)` stores all dynamic state for an agent within a single 32-byte slot.
2. Window spend (128 bits), window inception (32 bits), transaction counter (32 bits), and nonce (64 bits) pack into exactly 256 bits.
3. No global counters or shared sequence numbers are touched during user payment evaluations.

## Consequences
- Single $1 \text{ SLOAD}$ and $1 \text{ SSTORE}$ per evaluation.
- Concurrent transactions for different agents have disjoint storage keys (`keccak256(agent, slot_index)`), achieving near-linear execution scaling across Monad worker threads.
