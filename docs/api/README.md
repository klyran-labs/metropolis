# UI response contract

`ui-contract.json` is the published shape of the gateway responses the web console depends on
(`GET /agents`, `/organization/wallets`, `/agents/{agent}/wallet-transfers`, `/telemetry/events`,
`/wallet-transfers/pending`, `POST /wallet-transfers/{id}/approve`; paths relative to `/api/v1`).

It is **generated** from the gateway's own response types (`services/gateway/src/ui_contract.rs`), which
also serialize the real responses, so it cannot drift from the code. A gateway test fails when the file
is stale:

```bash
UPDATE_UI_CONTRACT=1 cargo test --manifest-path services/gateway/Cargo.toml --test ui_contract
```

The web UI test suite (`apps/web/e2e/contract.spec.ts`) validates every fixture it serves against these
schemas, so a UI test can no longer pass against a response the gateway does not produce.

To bring another endpoint under the contract: add a `#[derive(Serialize, JsonSchema)]` DTO, return it from
the handler, add it to `ui_contract()`, regenerate, and add a sample to `contractSamples` in
`apps/web/e2e/support/fixtures.ts`.
