# ADR 0004: Exponentially Weighted Moving Average (EWMA) Reputation Mechanics

## Status
Accepted

## Context
Agentic payments require a deterministic, onchain measure of agent reliability. Binary credit ratings fail to adapt smoothly to burst activity or recent performance degradation.

## Decision
We deploy `ReputationRegistry.sol` using an Exponentially Weighted Moving Average (EWMA), applied with a different damping coefficient and target per outcome:
1. Agent reputation (`scoreBps` in code) is tracked on a **parts-per-million scale,
   $0 \le \text{score} \le 1{,}000{,}000$** — *not* basis points (0–10,000) despite
   the field's name. New agents start at the neutral baseline, 500,000 (50%).
   (The `scoreBps` name is a known naming inconsistency inherited from an earlier
   basis-points design; renaming it is tracked as follow-up work rather than done
   opportunistically here, since it would ripple through `shared-types` and the
   dashboard without a compiler available in this environment to verify the change.)
2. `SETTLED`: EWMA toward the maximum, $\alpha = 0.05$ — `score = 0.95*score + 0.05*1,000,000`.
3. `DISPUTED`: EWMA toward a low target, $\alpha = 0.10$ — `score = 0.90*score + 0.10*200,000`.
4. `TIMEOUT`: EWMA toward a below-neutral target, $\alpha = 0.05$ — `score = 0.95*score + 0.05*300,000`.
5. `SLASHED`: an instant flat 30% cut (`score = 0.70*score`), not an EWMA blend — the
   one non-linear, non-target-seeking penalty, by design, so a single confirmed
   slash always costs a fixed proportion regardless of current score.
6. Downstream contracts and merchants can gate access via `isTrusted(agent, minScoreBps)`.

## Consequences
- Fast response to misbehavior with smooth, earned recovery over time for
  disputes/timeouts, and an immediate proportional penalty for confirmed slashing.
- Fully deterministic integer math requiring zero floating-point operations.
- The `scoreBps`/basis-points naming does not match the 0–1,000,000 scale actually
  used; treat the name as legacy until it's renamed end-to-end.
