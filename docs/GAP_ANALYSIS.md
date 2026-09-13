# AgentGuard — Implementation Review vs. Plan (2026-09-12)

> **Status: findings 1.1–1.6 and the §2 items addressed the same day, in the commits immediately following this document's own commit** (`git log` from `feat: AgentGuard onchain core` through `chore: add Tier-1 repository scaffolding`). See [`CHANGELOG.md`](../CHANGELOG.md) for the fix-by-fix summary and [`docs/ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md) for the new diagrams. This document is kept as-written (not edited to erase the findings) because it's the honest record of what was wrong and why each fix was needed — read it as history, not as a current-state report. What's still genuinely open: BudgetPool/Org hierarchy, ERC-4337 accounts, an executed (not just authored) `forge test` run, and any actual deployment — none of that changed.

Reviewed: uploaded plan `agentic-spend-control-plan.md` against the working tree at
`/Users/rahul/development/github/AgentGuard` (AgentGuard workspace). Method: read every contract,
test file, CI config, and doc; attempted to compile the contracts (blocked — see
test file, CI config, and doc; attempted to compile the contracts (blocked — see
Finding 1); ran `npm test`; traced the deploy script against the actual constructors.

## Verdict

The plan's shape was followed well: DDD bounded contexts, the exact `ReasonCode`
enum, disjoint per-agent storage slots, O(1) kill switch, x402 flow, EWMA reputation
— all present in intent and in ~1,750 lines of Solidity/TS domain code plus a
3,200-line React dashboard. But the verification layer is theater, not proof: the
Solidity contracts have **never been compiled**, the "x402 payment gateway" the docs
describe as a live microservice **does not exist as code**, and there is one
concrete **compile-breaking bug** and one **fund-safety-adjacent DoS bug** sitting
underneath a 100%-green test suite. None of this work is committed — `git status`
shows +1,631/‑37,017 lines uncommitted, including deleting an entire prior product.
"Production ready" is not an accurate description of the current state; "a strong,
well-documented hackathon MVP with a false sense of test coverage" is.

---

## 1. Critical — blocks "production ready" outright

**1.1 The Solidity contracts have never been compiled.**
`contracts/test/agentguard-contracts.test.mjs` does not test `PolicyEngine.sol` —
it's a 600-line hand-rolled JS class (`PolicyEngineSimulator`) that *reimplements*
the policy logic and tests itself. `forge` and `solc` are not installed on this
machine or in this session (both blocked by the org's egress allowlist — I could not
compile the contracts myself to confirm the extent of the damage). There is no
`contracts/lib/` (no forge-std vendored), no `.t.sol` files, and CI
(`.github/workflows/ci.yml`) never runs `forge build` or `forge test` — only the JS
suite. The `foundry.toml` is configured correctly (5,000 fuzz runs, 500×128
invariant runs, Cancun, via-ir) but nothing ever invokes it. This is exactly the gap
the plan warned about in §4.1 — Foundry tests were supposed to come *first*, RED
before implementation — and it's the one piece that's actually missing.

**1.2 Proof the above is real, not theoretical:** `contracts/script/DeployAgentGuard.s.sol`
calls `new AgentWalletGuard(policyEngineAddr, reputationRegistryAddr, treasury)` —
3 args — but `AgentWalletGuard`'s actual constructor
(`contracts/src/core/AgentWalletGuard.sol:34`) takes 2:
`constructor(address _policyEngine, address _reputationRegistry)`. This will not
compile. Nobody has run `forge build` against this tree.

**1.3 `PolicyEngine.evaluateAndSpend` has no caller authorization** —
`contracts/src/core/PolicyEngine.sol`. Any address can call it directly for any
`req.agent`; the function trusts `req.agent` from calldata and never checks
`msg.sender`. EIP-712 signature verification lives only in `AgentWalletGuard`, a
*separate, optional* entrypoint — nothing stops a caller from skipping it and
calling `PolicyEngine` directly. Concretely: an attacker who knows an agent's
address can spam `evaluateAndSpend` with syntactically valid but arbitrary
`SpendRequest`s (any unused nonce, any merchant if `whitelistEnabled=false`) to
burn that agent's rolling-window budget and velocity counter with zero real
payment — denying the legitimate agent's traffic (`ERR_MAX_PER_WINDOW` /
`ERR_VELOCITY_EXCEEDED`). This is a griefing/DoS vector directly against the
product's core promise ("deterministic protection"). Fix: `PolicyEngine` should
only accept `evaluateAndSpend` calls from a registered `AgentWalletGuard` (mirror
the `authorizedReporters` allowlist pattern already used correctly in
`ReputationRegistry.sol`), or re-verify the signature inside `PolicyEngine` itself.

**1.4 The x402 payment gateway is not implemented — it's a stub.**
README, `docs/ARCHITECTURE.md`, and `docs/OPERATIONAL_READINESS.md` all describe
`agentguard-gateway` as a live Node.js microservice doing signature verification
and policy pre-flight at "<5ms p99." The actual `docker/Dockerfile.gateway` runtime
`CMD` is one inline line:
```
node -e "...http.createServer((req,res)=>{ if (req.url==='/health') {...} else { res.writeHead(402,...); res.end(...) } }).listen(8080)"
```
It always returns 402 for every route. It never imports `@agentguard/x402-middleware`
(which *does* have real logic — challenge generation, EIP-712 verification, reason
code translation), never calls the Monad RPC, never touches `PolicyEngine`. The
Dockerfile only builds `shared-types` and `x402-middleware` as libraries and then
discards them at runtime. There is no gateway server source file anywhere in the repo.

**1.5 Nothing is deployed.** Every contract address in
`deploy/environments/*/deployment-manifest.json` and `deployments/monad-testnet/*`
is a placeholder (`0x2222…`, `0x3333…`, `0x4444…`). The SLO doc, the $500k bug
bounty table in `SECURITY.md`, and the "Sub-second Finality" claims describe a live
system; none of it has touched Monad testnet.

**1.6 None of this is committed.** `git status` on the working tree: 328 files
changed, +1,631 −37,017, including the deletion of a prior, unrelated product
(`services/api-gateway`, `identity-policy`, `provisioning-controller`,
`reconciliation`, `settlement-keeper`, `apps/mobile`, `Cargo.toml`) and every
AgentGuard file (contracts, dashboard components, ADRs, runbooks) is untracked. A
stray `git checkout .` or `git clean -fd` right now would destroy the AgentGuard
rebuild and/or resurrect the deleted product. Recommend committing the clean deletion
and the new work as separate, reviewable commits before any further changes.

## 2. Should fix before calling it production-ready

- **Test suite is string-matching, not behavior-testing.** `apps/web/test/frontend.test.mjs`
  does `readFile(component.tsx) + assert.match(source, /some string/)` — it checks that
  certain words appear in source, not that the component renders or behaves correctly.
  No `@testing-library/react`, no jsdom. Combined with 1.1, the "100% test pass" claim
  in `walkthrough.md` is true only in the narrowest sense.
- **`BudgetPool`/Org/Team hierarchy from the plan (§2.2) is unimplemented.** `ERR_BUDGET_DEPLETED`
  is declared in the `ReasonCode` enum and documented everywhere but no code path ever
  returns it — there's no shared-budget concept at all, only per-agent policy.
- **Reputation scale mismatch:** `docs/ADR/0004-ewma-reputation-mechanics.md` says
  basis points (0–10,000); `ReputationRegistry.sol` actually uses parts-per-million
  (0–1,000,000, baseline 500,000). Pick one and fix the doc or the code.
- **Solidity pragma inconsistency:** `^0.8.26` (interfaces/core), `^0.8.28` (deploy
  script), `0.8.36` (`foundry.toml solc_version`). Pin one version repo-wide.
- **ERC-20 settlement uses raw `transferFrom` without SafeERC20** — fine for
  strictly-compliant tokens (USDC), but will silently misbehave against
  non-standard ERC-20s. Should use OpenZeppelin's `SafeERC20`.
- **No ERC-4337 smart accounts**, despite the plan (§3) and this being a documented
  differentiator ("programmable policy hooks at wallet level, gas sponsorship").
  Current model is EOA + EIP-712 relayed through a forwarder contract — a reasonable
  simplification, but it's a real, undocumented deviation from the plan, not a detail.
- **No LICENSE file**, despite the README badge claiming "MIT License."

## 3. What's actually good — keep it

- Domain modeling is clean: `PackedPolicy`/`PackedState` slot-packing, disjoint
  per-agent storage, O(1) kill switch short-circuit, and the transient-storage
  (`tstore`/`tload`) reentrancy guard are all correctly reasoned about and match
  the plan's Monad-specific concurrency argument almost exactly — this is the
  strongest part of the codebase.
- The `ReasonCode` enum is used consistently end-to-end: same 10 codes, same order,
  in the contract, `shared-types`, `x402-middleware`, the dashboard, and every doc.
  Invariant #4 from the plan (no silent denial) is genuinely honored throughout.
- 9 dashboard components, ~3,200 lines — a real, fairly complete control plane
  (Fleet Overview, Policy Studio, Rogue Agent Simulator, Audit Ledger), not a shell.
- ADRs, runbooks, SLO doc, threat-model directory, ERC-7730 clear-signing descriptor
  — the *documentation scaffolding* a Tier-1 repo needs is already present in
  structure; it mostly needs its claims brought in line with reality (see §1, §2)
  rather than being built from scratch.

## 4. What "Tier-1 GitHub repo + architecture diagrams" still needs

- Real architecture diagrams as durable artifacts, not ASCII boxes — a proper C4
  (context/container/component) set, ideally rendered (Mermaid, which GitHub
  renders natively, or SVG), covering: system context, the 3-contract onchain
  topology, the x402 sequence flow (partially done in `SYSTEM_FLOWS.md`), and a
  deployment/infra diagram (K8s + Docker topology).
- `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, PR/issue
  templates, `CHANGELOG.md` — none exist yet.
- CI: add a `forge build` + `forge test` job (once Foundry is installed somewhere
  with real egress — this sandbox and the linked machine both blocked it), plus a
  Solidity static analyzer (Slither) gate.

---

## Recommended sequencing

1. Fix 1.2 (constructor mismatch) and 1.3 (authorization gap) — small, high-value,
   unblocks everything else.
2. Stand up Foundry properly (vendor forge-std, write real `.t.sol` unit + the two
   invariant tests the plan specifies in §4.1) and get `forge build`/`forge test`
   green for real, on real bytecode.
3. Build a real `agentguard-gateway` service (Express/Fastify wired to
   `@agentguard/x402-middleware` + Monad RPC), replacing the stub.
4. Reconcile docs to reality (pragma versions, reputation scale, remove
   not-yet-true claims or mark them roadmap), add LICENSE + repo scaffolding,
   produce real architecture diagrams.
5. Commit the pending transition in reviewable chunks; only then consider testnet
   deployment and the operational claims in `SECURITY.md`/`OPERATIONAL_READINESS.md`
   live.
