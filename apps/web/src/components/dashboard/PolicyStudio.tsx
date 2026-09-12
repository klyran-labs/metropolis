import React, { useState, useEffect } from 'react';
import { type Address, parseEther, formatEther } from 'viem';
import { Sliders, Save, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import { type FleetAgent, type SpendPolicy } from '@agentguard/shared-types';
import { DisjointSlotVisualizer } from './DisjointSlotVisualizer';

interface PolicyStudioProps {
  agent: FleetAgent | null;
  onSavePolicy: (agentAddress: Address, policy: SpendPolicy) => Promise<void>;
}

export const PolicyStudio: React.FC<PolicyStudioProps> = ({ agent, onSavePolicy }) => {
  const [maxPerTxInput, setMaxPerTxInput] = useState('1.0');
  const [maxPerWindowInput, setMaxPerWindowInput] = useState('5.0');
  const [windowSecondsInput, setWindowSecondsInput] = useState('3600');
  const [maxVelocityInput, setMaxVelocityInput] = useState('10');
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (agent) {
      setMaxPerTxInput((Number(agent.policy.maxPerTx) / 1e18).toString());
      setMaxPerWindowInput((Number(agent.policy.maxPerWindow) / 1e18).toString());
      setWindowSecondsInput(agent.policy.windowSeconds.toString());
      setMaxVelocityInput(agent.policy.maxVelocity.toString());
      setWhitelistEnabled(agent.policy.whitelistEnabled);
      setKillSwitch(agent.policy.killSwitch);
      setSaveSuccess(false);
      setErrorMessage(null);
    }
  }, [agent]);

  if (!agent) {
    return (
      <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
        <Sliders className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
        <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">No Agent Selected</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Select an agent wallet from the Fleet Overview to inspect or calibrate its Monad onchain policy.
        </p>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    setSaveSuccess(false);

    try {
      const maxPerTxWei = parseEther(maxPerTxInput || '0');
      const maxPerWindowWei = parseEther(maxPerWindowInput || '0');
      const windowSeconds = parseInt(windowSecondsInput, 10);
      const maxVelocity = parseInt(maxVelocityInput, 10);

      if (windowSeconds <= 0) throw new Error('Sliding window duration must be greater than 0 seconds');
      if (maxVelocity <= 0) throw new Error('Maximum velocity must be greater than 0 transactions');

      const updatedPolicy: SpendPolicy = {
        agent: agent.address,
        maxPerTx: maxPerTxWei,
        maxPerWindow: maxPerWindowWei,
        windowSeconds,
        maxVelocity,
        whitelistEnabled,
        killSwitch,
      };

      await onSavePolicy(agent.address, updatedPolicy);
      setSaveSuccess(true);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to update policy on Monad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-4 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Policy Studio: {agent.name}
          </h2>
          <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
            {agent.address}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {agent.policy.killSwitch && (
            <span className="flex items-center space-x-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
              <ShieldAlert className="h-3 w-3" />
              <span>KILL SWITCH ACTIVE</span>
            </span>
          )}
        </div>
      </div>

      <form onSubmit={handleSave} className="mt-6 space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Max Per Transaction */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Max Spend Per Transaction (MON)
            </label>
            <p className="mb-2 text-[11px] text-slate-500">
              Hard limit for individual payment executions. Invariant: `req.amount &lt;= maxPerTx`.
            </p>
            <div className="relative rounded-xl shadow-xs">
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxPerTxInput}
                onChange={(e) => setMaxPerTxInput(e.target.value)}
                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                required
              />
              <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-xs font-semibold text-slate-400">
                MON
              </span>
            </div>
          </div>

          {/* Max Per Window */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Max Spend Per Sliding Window (MON)
            </label>
            <p className="mb-2 text-[11px] text-slate-500">
              Cumulative budget across the rolling window. Invariant: `spent + req.amount &lt;= maxPerWindow`.
            </p>
            <div className="relative rounded-xl shadow-xs">
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxPerWindowInput}
                onChange={(e) => setMaxPerWindowInput(e.target.value)}
                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                required
              />
              <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-xs font-semibold text-slate-400">
                MON
              </span>
            </div>
          </div>

          {/* Window Duration */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Sliding Window Duration (Seconds)
            </label>
            <p className="mb-2 text-[11px] text-slate-500">
              Timespan before accumulated spend and velocity counters reset (e.g. 3600 = 1 hour).
            </p>
            <input
              type="number"
              min="1"
              value={windowSecondsInput}
              onChange={(e) => setWindowSecondsInput(e.target.value)}
              className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              required
            />
          </div>

          {/* Max Velocity */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Max Transaction Velocity
            </label>
            <p className="mb-2 text-[11px] text-slate-500">
              Maximum allowable transaction count per window to prevent runaway loops or bot compromise.
            </p>
            <input
              type="number"
              min="1"
              value={maxVelocityInput}
              onChange={(e) => setMaxVelocityInput(e.target.value)}
              className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              required
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-6 border-t border-slate-200/80 pt-4 dark:border-slate-800">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={whitelistEnabled}
              onChange={(e) => setWhitelistEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Enforce Authorized Merchant Whitelist
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={killSwitch}
              onChange={(e) => setKillSwitch(e.target.checked)}
              className="h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
            />
            <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
              Active Kill Switch (Immediate Halt)
            </span>
          </label>
        </div>

        {/* Merchant Whitelist Manager */}
        {whitelistEnabled && (
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-800/40 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Approved Merchant Counterparties
                </h4>
                <p className="text-[11px] text-slate-500">
                  Only transactions to these whitelisted addresses will be approved by PolicyEngine on Monad.
                </p>
              </div>
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                Onchain Mapping
              </span>
            </div>

            <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-5 text-center text-xs dark:border-slate-700 dark:bg-slate-900/40">
              <p className="font-semibold text-slate-700 dark:text-slate-300">No merchant whitelist records loaded</p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">Whitelist entries will appear only after they are read from the deployed PolicyEngine.</p>
            </div>
          </div>
        )}

        {saveSuccess && (
          <div className="flex items-center space-x-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Policy successfully confirmed on Monad Parallel EVM.</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center space-x-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center space-x-2 rounded-xl bg-[#254BFF] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            <Save className="h-4 w-4" />
            <span>{saving ? 'Committing to Monad...' : 'Save Onchain Policy'}</span>
          </button>
        </div>
      </form>

      {/* Disjoint Storage Slot Live Inspector */}
      <div className="mt-8 border-t border-slate-200/80 pt-6 dark:border-slate-800">
        <DisjointSlotVisualizer state={agent.state} agentAddress={agent.address} />
      </div>
    </div>
  );
};
