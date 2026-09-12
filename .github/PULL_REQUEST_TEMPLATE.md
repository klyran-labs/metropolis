## Summary

<!-- What does this change, and why? -->

## Which quality gates did you run?

- [ ] `make lint` (zero-mock check, UI interaction contract, typechecks)
- [ ] `make build`
- [ ] `make test` (JS-level parity suite)
- [ ] `cd contracts && forge test -vvv` (real contract tests — required for any
      change under `contracts/src`)
- [ ] `npx tsc -p services/gateway/tsconfig.json && node --test services/gateway/test/gateway.test.mjs`
      (required for any change under `services/gateway`)

## Does this touch a merge-blocking invariant?

<!-- See AGENTS.md §1/§6. If this changes PolicyEngine, AgentWalletGuard, or
ReputationRegistry behavior, call out explicitly which invariant(s) are
affected and how the new/updated tests cover them. -->

## Docs

- [ ] Updated `docs/GAP_ANALYSIS.md` if this fixes or introduces a known gap
- [ ] Updated the relevant ADR if this changes a documented architectural decision
- [ ] Updated `docs/ARCHITECTURE_DIAGRAMS.md` if this changes container/component structure
