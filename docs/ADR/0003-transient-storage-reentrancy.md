# ADR 0003: Cancun Transient Storage (tstore / tload) Reentrancy Guard

## Status
Accepted

## Context
Standard EVM reentrancy guards write a non-zero value to persistent contract storage on entry and reset it on exit. This consumes up to 5,000 gas and writes to storage that persists across transactions.

## Decision
We implement `TransientReentrancyGuard.sol` utilizing Cancun's `tstore` and `tload` opcodes (EIP-1153):
1. On function entry: `assembly { tstore(SLOT, 1) }`
2. On function exit: `assembly { tstore(SLOT, 0) }`
3. If `tload(SLOT) == 1`, revert with `ReentrancyGuardReentrantCall()`.

## Consequences
- Gas overhead drops from ~5,000 gas to ~100 gas.
- Transient storage is automatically discarded at the end of the transaction frame, ensuring clean isolation.
