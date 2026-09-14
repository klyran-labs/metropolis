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
