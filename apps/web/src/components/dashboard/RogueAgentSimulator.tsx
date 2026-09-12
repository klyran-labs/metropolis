import React, { useState } from 'react';
import { type Address, isAddress, keccak256, parseEther, toHex } from 'viem';
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { type FleetAgent, type PolicyDecision, type SpendRequest, ReasonCode } from '@agentguard/shared-types';
import { createPolicyRejectionResponse } from '@agentguard/x402-middleware';

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

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-start sm:justify-between dark:border-slate-800">
          <div><p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Policy evaluation</p><h2 className="mt-1 text-base font-bold text-slate-900 dark:text-white">Evaluate a real payment intent</h2><p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">Calls PolicyEngine on Monad Testnet without submitting funds or mutating spend state.</p></div>
          <button type="button" onClick={() => void onToggleKillSwitch(agent.address, agent.policy.killSwitch)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300"><ShieldAlert className="h-4 w-4" />{agent.policy.killSwitch ? 'Release kill switch' : 'Activate kill switch'}</button>
        </div>
        <form onSubmit={evaluate} className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Merchant address<input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="0x..." className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Amount (MON)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Category<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. inference" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950" /></label>
          <div className="md:col-span-3 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Agent nonce: <span className="font-mono">{agent.state.nonce.toString()}</span></p><button disabled={running} type="submit" className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{running ? 'Evaluating…' : 'Evaluate onchain'}</button></div>
        </form>
        {error && <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"><AlertTriangle className="h-4 w-4" />{error}</p>}
      </section>
      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"><h3 className="text-sm font-bold text-slate-900 dark:text-white">Onchain decision</h3>{!decision ? <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500 dark:border-slate-800">Submit a payment intent to see its authoritative reason code.</p> : <div className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${decision.decision === 'ALLOW' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30'}`}>{decision.decision === 'ALLOW' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-rose-600" />}<div><p className="text-sm font-bold text-slate-900 dark:text-white">{decision.decision === 'ALLOW' ? 'Allowed' : 'Denied'}</p><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Reason code {String(decision.reasonCode)}: {decision.reasonMessage}</p></div></div>}{payload !== null && <pre className="mt-4 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-emerald-400">{String(JSON.stringify(payload, null, 2))}</pre>}</section>
    </div>
  );
};
