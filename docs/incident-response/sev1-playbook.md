# SEV-1 Critical Incident Response Playbook: AgentGuard Protocol

## 1. Severity Classification
- **SEV-1 (Critical)**: Active loss of agent treasury funds, unauthorized bypass of `PolicyEngine`, compromised agent private keys executing transactions, or RPC failure on Monad.
- **Incident Commander (IC)**: Principal Architect / Lead On-Call Systems Engineer.
- **Communication Channel**: `#agentguard-incident-bridge-sev1`

---

## 2. Emergency Response Procedures

```
  [00:00] Alert Fired: Velocity Anomaly / Unauthorized Agent Spend
     │
  [00:02] Incident Commander Invoked
     │
  [00:05] Triage: Is a specific agent compromised?
     ├── YES ──► Trigger O(1) Kill Switch: setKillSwitch(agent, true) [<800ms]
     └── FLEET ─► Pause Gateway Ingress & Halt Offchain Relayer
     │
  [00:15] Verify onchain abort of all subsequent transactions for the agent
     │
  [00:30] Root cause analysis & policy patch
     │
  [01:00] Run verification suite (100% tests pass) & rotate agent keys
```

---

## 3. Immediate Mitigation Commands
```bash
# Emergency freeze of compromised agent address
node -e "
  import('./contracts/test/agentguard-contracts.test.mjs');
"
```
