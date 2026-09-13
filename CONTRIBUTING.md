# Contributing to AgentGuard

Thanks for considering a contribution. This repo enforces the engineering
standards in [`AGENTS.md`](AGENTS.md) — read it first; it's the authoritative
source for architecture boundaries, TDD expectations, and the zero-mock
mandate. This file covers the mechanics of contributing.

## Before you start

Read [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md). It's a current, honest
accounting of what's real vs. aspirational in this codebase — check it before
assuming a documented claim (an SLA number, a "live" feature) reflects the
current state rather than the target state.

## Development setup

```bash
npm install
npm test                 # JS-level parity suite (contracts, frontend, middleware)

cd contracts
git submodule update --init --recursive   # vendors forge-std
forge build
forge test -vvv           # the authoritative contract test suite — real bytecode
```

`services/gateway` is a high-throughput Rust microservice (see
`services/gateway/README.md`); build and test it using Cargo:

```bash
cargo test --manifest-path services/gateway/Cargo.toml
cargo build --release --manifest-path services/gateway/Cargo.toml
```

## Workflow

1. **Tests first.** This repo follows Red-Green-Refactor. For a Solidity
   change, write the failing `forge test` case before touching `contracts/src`.
   For TypeScript, write the failing `node --test` case first.
2. **Keep bounded contexts separate.** Core risk/policy logic
   (`contracts/src/core`) must not import protocol-specific concerns (x402,
   AP2). Rail adapters translate protocol payloads into the domain's
   `SpendRequest` — see `AGENTS.md` §5 for the boundary map.
3. **Every denial carries a reason code.** No silent failures, onchain or
   offchain — this is a merge-blocking invariant (`AGENTS.md` §1).
4. **Run the quality gates before opening a PR:**
   ```bash
   make lint     # zero-mock check, UI interaction contract, typechecks
   make build    # packages, web, and gateway
   make test     # JS parity suite
   cd contracts && forge test -vvv   # real contract tests
   ```
5. **Commit in reviewable units.** Prefer several small, single-purpose
   commits over one large one — see the git history from the fixes in
   `docs/GAP_ANALYSIS.md` for the intended granularity (fix commit, test
   commit, doc commit, kept separate rather than squashed).

## Reporting a security issue

Do **not** open a public issue for a security vulnerability. Follow the
process in [`SECURITY.md`](SECURITY.md).

## Code of conduct

Participation in this project is governed by
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
