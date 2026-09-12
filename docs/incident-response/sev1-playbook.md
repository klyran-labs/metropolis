# SEV-1 Critical Incident Response Playbook

## 1. Severity Classification
- **SEV-1 (Critical)**: Active loss of funds, smart contract exploit attempt, matching engine halt > 5 minutes, or consensus failure on Monad.
- **Incident Commander (IC)**: Principal Architect / Lead On-Call SRE.
- **Communication Channel**: Dedicated Slack/Discord `#incident-bridge-sev1` and status page.

---

## 2. Response Timeline & Standard Operating Procedure

```
  [00:00] Detection & Alert Firing (PagerDuty / Slack)
     │
  [00:05] Incident Commander Declared, Bridge Opened
     │
  [00:10] Triage: Is capital at risk?
     ├── YES ──► Trigger Emergency Pause on ComputeCLOBSettlement & ParametricSLAVault
     └── NO  ──► Isolate Affected Nodes / Failover to Standby Replica
     │
  [00:20] Public Status Update Posted (Zero internal leaks, honest operational status)
     │
  [00:45] Root Cause Identified & Hotfix Staged
     │
  [01:00] Verification Suite Executed (100% tests pass)
     │
  [01:15] Controlled Unpause & Traffic Ramp
     │
  [24:00] Blameless Postmortem Published with Action Items
```

---

## 3. Communication Standards
- Never leak private keys, RPC secrets, or internal port numbers to public status channels.
- State factually: affected service, current status, user funds safety confirmation, and estimated time to next update.
