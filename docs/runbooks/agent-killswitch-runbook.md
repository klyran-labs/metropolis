# Runbook: Emergency Agent Kill Switch Operation

## Overview
This runbook defines the emergency procedure to freeze an autonomous AI agent when suspicious spend patterns, compromised private keys, or infinite loop transactions are detected.

---

## 1. Detection & Verification
1. Check the **Audit Ledger** in the AgentGuard Console or query `ReasonCode` frequency:
   - Spike in `ReasonCode.ERR_VELOCITY_EXCEEDED` (4).
   - Repeated `ReasonCode.ERR_MAX_PER_TX` (2) or `ReasonCode.ERR_MAX_PER_WINDOW` (3).
   - Transactions sent to unwhitelisted merchant addresses (`ReasonCode.ERR_MERCHANT_NOT_ALLOWED` (5)).
2. Confirm the agent address: `0x...`

---

## 2. Execution of Kill Switch
### Via AgentGuard Web Console
1. Navigate to **Fleet Overview**.
2. Locate the compromised agent row.
3. Click the red **Trigger Kill Switch** button.
4. Sign the transaction in your connected wallet.

### Via CLI / Viem Script
```javascript
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from './chain';
import { POLICY_ENGINE_ABI, CONTRACT_ADDRESSES } from './contracts';

const client = createWalletClient({
  account: privateKeyToAccount(process.env.ADMIN_PRIVATE_KEY),
  chain: monadTestnet,
  transport: http('https://testnet-rpc.monad.xyz'),
});

await client.writeContract({
  address: CONTRACT_ADDRESSES.policyEngine,
  abi: POLICY_ENGINE_ABI,
  functionName: 'setKillSwitch',
  args: [agentAddress, true],
});
```

---

## 3. Verification
Verify that subsequent `evaluate()` calls for the agent immediately return `ReasonCode.ERR_KILL_SWITCH` (1).
Recovery time: < 800ms (1 Monad block).
