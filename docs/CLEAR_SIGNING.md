# ComputeX Clear Signing

ComputeX keeps EIP-712 as the authorization and replay-protection protocol. ERC-7730 is an additive presentation layer that lets compatible wallets render the same typed order with human-readable labels.

## Canonical descriptor

- Descriptor: `descriptors/erc7730/eip712-ComputeXOrder.json`
- Test fixture: `descriptors/erc7730/eip712-ComputeXOrder.tests.json`
- Deployment binding: `deployments/monad-testnet/eip712.json`
- Validation: `npm run validate:erc7730`
- Official schema validation: `python3 scripts/validate-erc7730-schema.py`

The descriptor is restrictively bound to Monad Testnet chain `10143`, the exact settlement deployment, the `ComputeX_CLOB` domain, and the exact `Order` encodeType string. A descriptor never authorizes an order; the wallet signature and onchain EIP-712 verification remain authoritative.

## Wallet behavior

1. A compatible wallet may use the ERC-7730 descriptor to display the order clearly.
2. A wallet without ERC-7730 support may display ordinary EIP-712 fields.
3. The application must warn users when the wallet is blind-signing or cannot show the bound contract and domain.

ComputeX must not describe its own browser confirmation screen as hardware-wallet clear signing.

## Change control

Any change to the EIP-712 domain, order fields, deployed contract, or descriptor requires:

- New deployment metadata
- Updated descriptor and fixture
- Cross-language signature-vector tests
- Two-person review
- Descriptor linting
- Contract and SDK compatibility review

The descriptor contains user-facing metadata and is security-sensitive. Registry or CDN changes must be provenance-checked, reviewed, and revocable.

## Registry publication

The descriptor is prepared in the registry-compatible `eip712-*.json` format. Publication requires a maintainer-authenticated pull request to the official clear-signing registry, followed by registry review and wallet/device formatter testing. The repository cannot claim registry availability until that external review is accepted.
