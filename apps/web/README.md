# Web control plane

The React 19 control plane consumes the authenticated gateway APIs for tenant fleet governance, policy lifecycle, finalized telemetry, subscriptions, and platform administration. It uses Vite 8, Tailwind CSS, TanStack Query/Table/Virtual, Apache eCharts, and Viem.

Runtime configuration is profile-driven:

- `local`: Monad local devnet, chain 10143
- `testnet`: Monad testnet, chain 10143
- `mainnet`: Monad mainnet, chain 143

The frontend does not contain seeded agents, balances, plans, role claims, or transaction records. It renders explicit empty/unavailable states until the gateway returns real data. Tenant and platform authority are resolved by the backend; Privy metadata is not used for authorization.

```bash
npm run typecheck --workspace=@agentguard/web
npm run build --workspace=@agentguard/web
node --test apps/web/test/frontend.test.mjs
```

## UI tests (Playwright)

```bash
npm run test:ui:install   # once: downloads Chromium
npm run test:ui           # builds with the test sign-in stub and runs desktop + mobile
```

Specs live in `e2e/`. They run against a production build with the sign-in SDK replaced by `e2e/support/privy-stub.tsx` and gateway responses served from `e2e/support/fixtures.ts`; nothing from `e2e/` ships. Every screen is scanned with axe in light and dark themes, so a contrast or labeling regression fails the run.
