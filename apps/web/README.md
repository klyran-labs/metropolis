# @agentguard/web

The official **AgentGuard** Enterprise Web Control Plane for Agentic Payments on Monad Parallel EVM. Built with React 19, Vite 8, TailwindCSS v4, React Router v7, and Viem 2.x.

---

## Agent Risk Control Architecture

AgentGuard provides real-time control, monitoring, and safety rails for autonomous AI agents executing onchain payments:

### 1. 🛡️ Fleet Overview & Telemetry
- Real-time agent monitoring table displaying active spend policies, current window utilization, and velocity tracking.
- Instant $O(1)$ onchain kill switch buttons to immediately freeze compromised or malfunctioning agents.
- Live Monad block status and sub-second finality monitoring.

### 2. 📋 Policy Studio
- Visual policy authoring interface for configuring per-transaction maximums, rolling window caps, window duration, velocity limits, and merchant whitelists.
- Instant single-transaction updates to Monad's `PolicyEngine` contract.

### 3. 🧪 Rogue Agent Simulator
- Interactive testbench simulating realistic agent attack and failure scenarios:
  1. **Authorized Payment**: Normal operation under all risk limits.
  2. **Compromised Burst Attack**: Rapid-fire payment requests tripping velocity rate limiting (ReasonCode 5).
  3. **Treasury Drain Attempt**: Excessive single payment exceeding per-tx ceiling (ReasonCode 3).
- Real-time verification of machine-readable error codes and onchain rejection logs.

### 4. 📜 Audit Ledger
- Cryptographic event audit trail capturing every spend evaluation, gated payment execution, and blocked transaction.
- Verifiable proof links to Monad Testnet block explorer (`https://testnet.monadexplorer.com`).

---

## Development & Verification

```bash
# Start local development server (Port 3110)
npm run dev

# Run production build
npm run build

# Run frontend tests
node --test apps/web/test/frontend.test.mjs
```

---

## Zero-Mock Verification Standards

In compliance with repository `AGENTS.md` policy:
- No hardcoded fallback addresses (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).
- No synthetic balances or fake random math (`Math.random`).
- All empty states render honest zero balances (`0.0000 MON`) with actionable call-to-actions.
