# @agentguard/x402-middleware

Canonical x402 HTTP 402 & AP2 Payment Protocol Adaptation Layer for **AgentGuard: Agentic Risk & Spend Control Layer for Monad Metropolis**.

---

## Capabilities

- **`createX402Challenge`**: Generates RFC-compliant HTTP 402 Payment Required negotiation challenges with standard `WWW-Authenticate: x402` and `X-402-Payment-Required` headers.
- **`encodeX402Authorization` & `parseX402Authorization`**: Bidirectional serialization for base64 JSON `Authorization: x402 <token>` headers preserving BigInt precision and checksummed Ethereum addresses.
- **`verifySpendRequestSignature`**: Sub-50 microsecond cryptographic EIP-712 signature verification on Monad Testnet (`10143`).
- **`createPolicyRejectionResponse`**: Translates onchain machine-readable `ReasonCode` values into diagnostic HTTP 403 Forbidden responses with actionable remediation advice.

---

## Build & Test

```bash
# Build TypeScript declarations and ESM bundle
npm run build --workspace=@agentguard/x402-middleware

# Run test suite
npm test --workspace=@agentguard/x402-middleware
```
