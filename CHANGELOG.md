# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-09-12

Implementation review against the original plan, and remediation of what it
found. Full detail in `docs/GAP_ANALYSIS.md`.

### Fixed

- **Compile-breaking bug**: `contracts/script/DeployAgentGuard.s.sol` called
  `AgentWalletGuard`'s constructor with 3 arguments; the constructor takes 2.
  Deploy script corrected.
- **Security**: `PolicyEngine.evaluateAndSpend` had no caller authorization —
  any address could consume any agent's spend/velocity budget directly,
  bypassing `AgentWalletGuard`'s EIP-712 signature check entirely (a
  griefing/DoS vector). Added an `authorizedCallers` allowlist
  (owner-controlled), gating the state-changing entrypoint to the agent
  itself, its admin, or an authorized contract (the deployed
  `AgentWalletGuard`). `evaluate` (the free view simulation) remains open.
- **Hardening**: `AgentWalletGuard`'s ERC-20 settlement now tolerates tokens
  that return no data on a successful `transferFrom` (e.g. USDT-shaped
  tokens) instead of reverting, via a SafeERC20-style low-level call check.
- Solidity pragma unified to `^0.8.26` across every contract and the deploy
  script (previously `^0.8.26`/`^0.8.28`/`0.8.36` mixed across files).
- `docs/ADR/0004`, `contracts/README.md`, and `IReputationRegistry.sol`'s
  `scoreBps` comment corrected to document the real 0–1,000,000
  parts-per-million reputation scale (they previously described a 0–10,000
  basis-points scale that doesn't match `ReputationRegistry.sol`'s actual math).
- `apps/web/src/utils/financial.ts`'s unused `formatBps` helper was scaled
  for true basis points (÷100) and would silently misformat a reputation
  score (which needs ÷10,000) if ever reached for; documented the trap
  in place rather than leaving it as a latent footgun.

### Added

- Real Foundry test suite (`contracts/test/*.t.sol`, `contracts/test/invariant/`):
  unit tests, 5,000-run fuzz tests, and a 500×128 stateful invariant test
  (`invariant_TotalSpendNeverExceedsWindowLimit`) against actual compiled
  bytecode — previously the only "contract tests" were a JS re-implementation
  of the contracts tested against itself (`contracts/test/agentguard-contracts.test.mjs`,
  which still exists as a fast parity check, now clearly labeled as such).
- `services/gateway`: a real x402/AP2 payment gateway (issues challenges,
  verifies EIP-712 signatures, pre-flight-simulates via `PolicyEngine.evaluate`,
  relays settlement to `AgentWalletGuard`), replacing `docker/Dockerfile.gateway`'s
  previous runtime, which was a one-line stub that always returned HTTP 402
  and never touched policy, signatures, or Monad. 5 integration tests, run
  and verified in this environment (`node --test services/gateway/test/gateway.test.mjs`).
- `docs/ARCHITECTURE_DIAGRAMS.md`: rendered C4 system-context, container,
  component, and deployment diagrams (Mermaid), replacing ASCII-art-only
  diagrams as the structural source of truth.
- `docs/GAP_ANALYSIS.md`: the review this changelog summarizes.
- CI: new `contracts-foundry` job (real `forge build` / `forge test` +
  informational Slither pass) — previously CI only ran the JS parity suite,
  never compiling the Solidity contracts.
- Repository scaffolding: `LICENSE` (MIT, matching the existing README badge,
  which had no backing file), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `.github/CODEOWNERS`, issue/PR templates.

### Changed

- `SECURITY.md`, `docs/OPERATIONAL_READINESS.md`, `docs/BUSINESS_PLAN.md`
  now carry an explicit status banner: these describe the target program/SLA/
  business plan, not a currently-live system — no AgentGuard contract has
  been deployed to any network yet (every address in `deployments/` and
  `deploy/environments/` is a placeholder).
- `docs/OPERATIONAL_READINESS.md`'s gateway latency target split into
  offchain signature verification (<5ms p99, realistic) vs. the
  RPC-round-trip-bound policy pre-flight simulation (<50ms p99), since the
  gateway is now real and actually makes that RPC call.

### Known gaps (not addressed in this pass — tracked in `docs/GAP_ANALYSIS.md`)

- `BudgetPool`/Org/Team shared-budget hierarchy from the original plan is
  still unimplemented; `ERR_BUDGET_DEPLETED` remains declared but unreachable.
- No ERC-4337 smart accounts (EOA + EIP-712 relay remains the model).
- The Foundry test suite added here could not be executed in the environment
  it was written in (no network access to install `forge`/`solc` anywhere
  this session could reach, including the developer machine this was built
  against) — run `forge test -vvv` yourself before trusting it.
- Nothing is deployed to Monad testnet or mainnet yet.
