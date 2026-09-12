# AgentGuard Onchain Risk & Settlement Layer

Production smart contracts for the **AgentGuard** programmable risk and spend control protocol on Monad (Chain ID `10143`), compiled with Solidity `0.8.26+` (pinned via `foundry.toml` to `0.8.36`) utilizing Cancun `via-ir` and transient storage (`tstore`/`tload`).

---

## Contracts Architecture

- **`src/core/PolicyEngine.sol`**:
  - Single 32-byte slot packing (`PackedState`), reducing gas to $1 \text{ SLOAD}$ and $1 \text{ SSTORE}$.
  - Disjoint per-agent state partitioning eliminating Monad parallel EVM worker abort loops under optimistic concurrency control (OCC).
  - Instant $O(1)$ short-circuit kill switch without executing math loops.
  - Granular limits: `maxPerTx`, `maxPerWindow`, `windowSeconds`, `maxVelocity`, and merchant whitelists.
  - Standardized machine-readable reason codes (0 to 9).
- **`src/core/ReputationRegistry.sol`**:
  - Incremental Exponentially Weighted Moving Average (EWMA) scoring on a 0 to 1,000,000 parts-per-million scale (see ADR-0004).
  - Non-linear slashing penalties for fraudulent attempts or policy breaches.
  - Onchain trust evaluation queryable by downstream protocols via `isTrusted(agent, minScoreBps)`.
- **`src/core/AgentWalletGuard.sol`**:
  - Non-custodial gated payment execution.
  - EIP-712 structured spend request signature verification.
  - Nonce replay protection and deadline enforcement.
  - Native MON and ERC-20 token clearing.
- **`src/libraries/TransientReentrancyGuard.sol`**:
  - Cancun `tstore`/`tload` low-gas reentrancy lock, eliminating slot collisions across parallel worker threads.

---

## Verification

```bash
# Real Foundry unit, fuzz (5000 runs), and invariant (500 runs x depth 128) tests
# against actual compiled bytecode. Requires forge (https://getfoundry.sh) and
# forge-std vendored as a submodule:
git submodule update --init --recursive   # or: forge install foundry-rs/forge-std --no-commit
forge build
forge test -vvv

# JS-level workspace tests (PolicyEngineSimulator parity checks, x402/EIP-712
# round-trips) — these do NOT compile or execute the Solidity contracts; forge
# test above is the authoritative check for on-chain behavior.
npm test
```
