# @agentguard/shared-types

Universal TypeScript domain interfaces, EIP-712 schemas, and value objects for **AgentGuard: Agentic Risk & Spend Control Layer for Monad Metropolis**.

---

## Domain Models

- `SpendPolicy`: Packed onchain spend policy (`maxPerTx`, `maxPerWindow`, `windowSeconds`, `maxVelocity`, `killSwitch`, `whitelistEnabled`).
- `SpendRequest`: EIP-712 spend request payload (`agent`, `merchant`, `amount`, `category`, `timestamp`, `deadline`, `nonce`).
- `PolicyDecision`: Evaluation decision with `allowed`, `allowedAmount`, `reasonCode`, and `evaluatedAtTimestamp`.
- `ReasonCode`: Machine-readable typed decision codes (0 to 9) including `ERR_NONE`, `ERR_KILL_SWITCH`, `ERR_MAX_PER_TX`, `ERR_MAX_PER_WINDOW`, `ERR_VELOCITY_EXCEEDED`, `ERR_MERCHANT_NOT_ALLOWED`, `ERR_BUDGET_DEPLETED`, `ERR_EXPIRED`, `ERR_NONCE_REUSED`, `ERR_SIGNATURE_INVALID`.
- `AgentSpendState`: Monad-optimized single-slot state representation.
- `ReputationSummary`: Dynamic reputation metrics (`rollingScoreBps`, `totalTransactions`, `settledCount`, `slashedCount`).
- `AGENTGUARD_EIP712_DOMAIN`: Canonical EIP-712 domain for Monad Testnet (Chain ID `10143`).
- `SPEND_REQUEST_TYPES`: EIP-712 typing for clear signing.

---

## Build

```bash
npm run build
```
