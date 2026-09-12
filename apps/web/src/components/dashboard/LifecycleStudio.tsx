import React from 'react';
import { type Address, formatEther } from 'viem';
import { ExternalLink, LockKeyhole, ShieldCheck, Zap } from 'lucide-react';
import type { FleetAgent, SpendPolicy } from '@agentguard/shared-types';
import { MONAD_EXPLORER_URL, CONTRACT_ADDRESSES } from '../../config/contracts';

interface LifecycleStudioProps {
  agent: FleetAgent;
  onSavePolicy: (agentAddress: Address, policy: SpendPolicy) => Promise<void>;
  onToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
  onRecordAudit?: (record: unknown) => void;
}

/** Operational lifecycle summary. Evidence is rendered only from live chain state. */
export const LifecycleStudio: React.FC<LifecycleStudioProps> = ({ agent, onToggleKillSwitch }) => (
  <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Agent lifecycle</p><h2 className="mt-1 text-base font-bold text-slate-900 dark:text-white">{agent.name}</h2><p className="mt-1 break-all font-mono text-xs text-slate-500">{agent.address}</p></div>
        <button type="button" onClick={() => void onToggleKillSwitch(agent.address, agent.policy.killSwitch)} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300">{agent.policy.killSwitch ? 'Release kill switch' : 'Activate kill switch'}</button>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><ShieldCheck className="h-5 w-5 text-emerald-600" /><p className="mt-3 text-xs font-bold text-slate-500">Policy status</p><p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{agent.policy.killSwitch ? 'Blocked by kill switch' : 'Active onchain'}</p></div>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><Zap className="h-5 w-5 text-amber-500" /><p className="mt-3 text-xs font-bold text-slate-500">Spend state</p><p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{formatEther(agent.state.spentInWindow)} MON in window</p><p className="mt-1 text-xs text-slate-500">{agent.state.txCountInWindow} transactions · nonce {agent.state.nonce.toString()}</p></div>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><LockKeyhole className="h-5 w-5 text-blue-600" /><p className="mt-3 text-xs font-bold text-slate-500">Control plane</p><a href={`${MONAD_EXPLORER_URL}/address/${CONTRACT_ADDRESSES.policyEngine}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 dark:text-blue-400">View PolicyEngine <ExternalLink className="h-3 w-3" /></a></div>
      </div>
    </section>
    <section className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"><p className="font-semibold">Audit evidence is chain-derived</p><p className="mt-1 text-xs text-slate-500">Transaction hashes, payment outcomes, and reputation changes appear after indexed contract events are connected. This view intentionally does not generate preview signatures or synthetic settlement records.</p></section>
  </div>
);
