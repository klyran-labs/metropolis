import React, { useState } from 'react';
import { type Address, isAddress, keccak256, parseEther, toHex } from 'viem';
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { type FleetAgent, type PolicyDecision, type SpendRequest } from '@agentguard/shared-types';
import { createPolicyRejectionResponse } from '@agentguard/x402-middleware';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { KillSwitchConfirmDialog } from '../common/KillSwitchConfirmDialog';

interface RogueAgentSimulatorProps {
  agent: FleetAgent;
  onExecuteSimulation: (req: SpendRequest) => Promise<PolicyDecision>;
  onToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
}

/** A live, read-only policy evaluation surface. It never invents counterparties or outcomes. */
export const RogueAgentSimulator: React.FC<RogueAgentSimulatorProps> = ({ agent, onExecuteSimulation, onToggleKillSwitch }) => {
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<PolicyDecision | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [killSwitchConfirmOpen, setKillSwitchConfirmOpen] = useState(false);

  const evaluate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null); setDecision(null); setPayload(null);
    if (!isAddress(merchant)) return setError('Enter the merchant wallet address to evaluate.');
    if (!amount || Number(amount) <= 0) return setError('Enter a positive amount in MON.');
    if (!category.trim()) return setError('Enter a policy category.');
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const request: SpendRequest = { agent: agent.address, merchant: merchant as Address, amount: parseEther(amount), category: keccak256(toHex(category.trim())), timestamp, deadline: timestamp + 300n, nonce: agent.state.nonce + 1n };
    setRunning(true);
    try {
      const result = await onExecuteSimulation(request);
      setDecision(result);
      if (result.reasonCode !== 0) setPayload(createPolicyRejectionResponse(result.reasonCode, agent.address));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Policy evaluation failed.'); }
    finally { setRunning(false); }
  };

  const handleConfirmKillSwitch = async () => {
    try {
      await onToggleKillSwitch(agent.address, agent.policy.killSwitch);
    } finally {
      setKillSwitchConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card padding="md">
        <div className="flex flex-col gap-3 border-b border-card-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Policy evaluation</p>
            <h2 className="mt-1 text-base font-bold text-fg">Evaluate a real payment intent</h2>
            <p className="mt-1 max-w-2xl text-xs text-fg-muted">Calls PolicyEngine on Monad Testnet without submitting funds or mutating spend state.</p>
          </div>
          <Button
            variant="outline-danger"
            size="sm"
            leftIcon={<ShieldAlert className="h-4 w-4" />}
            onClick={() => setKillSwitchConfirmOpen(true)}
          >
            {agent.policy.killSwitch ? 'Release kill switch' : 'Activate kill switch'}
          </Button>
        </div>
        <form onSubmit={evaluate} className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="text-xs font-semibold text-fg">Merchant address
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="0x..." className="mt-2 w-full rounded-xl border border-card-border bg-card px-3 py-2.5 font-mono text-xs outline-none focus:border-primary" />
          </label>
          <label className="text-xs font-semibold text-fg">Amount (MON)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-2 w-full rounded-xl border border-card-border bg-card px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </label>
          <label className="text-xs font-semibold text-fg">Category
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. inference" className="mt-2 w-full rounded-xl border border-card-border bg-card px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </label>
          <div className="md:col-span-3 flex items-center justify-between gap-3">
            <p className="text-xs text-fg-muted">Agent nonce: <span className="font-mono">{agent.state.nonce.toString()}</span></p>
            <Button type="submit" variant="primary" loading={running} loadingLabel="Evaluating…">Evaluate onchain</Button>
          </div>
        </form>
        {error && <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-danger-subtle p-3 text-xs text-danger"><AlertTriangle className="h-4 w-4" />{error}</p>}
      </Card>
      <Card padding="md">
        <h3 className="text-sm font-bold text-fg">Onchain decision</h3>
        {!decision ? (
          <p className="mt-4 rounded-xl border border-dashed border-card-border p-8 text-center text-xs text-fg-muted">Submit a payment intent to see its authoritative reason code.</p>
        ) : (
          <div className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${decision.decision === 'ALLOW' ? 'border-success/30 bg-success-subtle' : 'border-danger/30 bg-danger-subtle'}`}>
            {decision.decision === 'ALLOW' ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-danger" />}
            <div>
              <p className="text-sm font-bold text-fg">{decision.decision === 'ALLOW' ? 'Allowed' : 'Denied'}</p>
              <p className="mt-1 text-xs text-fg-muted">Reason code {String(decision.reasonCode)}: {decision.reasonMessage}</p>
            </div>
          </div>
        )}
        {payload !== null && <pre className="mt-4 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-emerald-400">{String(JSON.stringify(payload, null, 2))}</pre>}
      </Card>

      <KillSwitchConfirmDialog
        isOpen={killSwitchConfirmOpen}
        agentName={agent.name}
        activating={!agent.policy.killSwitch}
        onConfirm={handleConfirmKillSwitch}
        onCancel={() => setKillSwitchConfirmOpen(false)}
      />
    </div>
  );
};
