# AgentGuard Clear Signing (ERC-7730)

AgentGuard uses EIP-712 as the authorization and replay-protection protocol for agentic spend requests. ERC-7730 is an additive presentation layer that allows compatible wallets and hardware signers to render typed spend authorizations with clear, human-readable labels.

## Canonical Descriptor

- Descriptor: `descriptors/erc7730/eip712-AgentGuardSpendRequest.json`
- Test fixture: `descriptors/erc7730/eip712-AgentGuardSpendRequest.tests.json`
- Deployment binding: `deployments/monad-testnet/eip712.json`
- Validation script: `node scripts/validate-erc7730.mjs`
- Official schema validation: `python3 scripts/validate-erc7730-schema.py`

The descriptor is restrictively bound to Monad Testnet chain `10143`, the `AgentWalletGuard` deployment, the `AgentGuard_PolicyEngine` domain, and the canonical `SpendRequest` schema:
`SpendRequest(address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint256 nonce)`

## Wallet Clear Signing Behavior

1. **Hardware & Secure Enclave Wallets**: Display the intended agent, recipient merchant, amount in MON/USDC, category hash, deadline, and nonce.
2. **Replay Protection**: The nonce and deadline guarantee that a spend signature cannot be replayed or delayed by a compromised gateway.
3. **Deterministic Audit**: The clear-signed fields match 1-to-1 with onchain `evaluate()` and `executeGatedPayment()` parameters on Monad.
