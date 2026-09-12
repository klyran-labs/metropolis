import React, { useState, useEffect } from 'react';
import { type Address, parseEther } from 'viem';
import { Sliders, Save, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import { type FleetAgent, type SpendPolicy } from '@agentguard/shared-types';
import { DisjointSlotVisualizer } from './DisjointSlotVisualizer';
import { Card } from '../common/Card';
import { Button } from '../common/Button';

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
      <Card padding="lg" className="text-center">
        <Sliders className="mx-auto h-12 w-12 text-fg-subtle" />
        <h3 className="mt-4 text-base font-semibold text-fg">No Agent Selected</h3>
        <p className="mt-1 text-xs text-fg-muted">
          Select an agent wallet from the Fleet Overview to inspect or calibrate its Monad onchain policy.
        </p>
      </Card>
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
    <Card padding="md">
      <div className="flex items-center justify-between border-b border-card-border pb-4">
        <div>
          <h2 className="text-base font-bold text-fg">Policy Studio: {agent.name}</h2>
          <p className="font-mono text-xs text-fg-muted">{agent.address}</p>
        </div>
        <div className="flex items-center space-x-2">
          {agent.policy.killSwitch && (
            <span className="flex items-center space-x-1 rounded-full bg-danger-subtle px-2.5 py-1 text-xs font-semibold text-danger">
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
            <label className="block text-xs font-bold uppercase tracking-wider text-fg">
              Max Spend Per Transaction (MON)
            </label>
            <p className="mb-2 text-[11px] text-fg-muted">
              Hard limit for individual payment executions. Invariant: `req.amount &lt;= maxPerTx`.
            </p>
            <div className="relative rounded-xl shadow-xs">
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxPerTxInput}
                onChange={(e) => setMaxPerTxInput(e.target.value)}
                className="block w-full rounded-xl border border-card-border bg-card px-4 py-2.5 text-sm font-medium text-fg focus:border-primary focus:outline-none"
                required
              />
              <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-xs font-semibold text-fg-subtle">
                MON
              </span>
            </div>
          </div>

          {/* Max Per Window */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-fg">
              Max Spend Per Sliding Window (MON)
            </label>
            <p className="mb-2 text-[11px] text-fg-muted">
              Cumulative budget across the rolling window. Invariant: `spent + req.amount &lt;= maxPerWindow`.
            </p>
            <div className="relative rounded-xl shadow-xs">
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxPerWindowInput}
                onChange={(e) => setMaxPerWindowInput(e.target.value)}
                className="block w-full rounded-xl border border-card-border bg-card px-4 py-2.5 text-sm font-medium text-fg focus:border-primary focus:outline-none"
                required
              />
              <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-xs font-semibold text-fg-subtle">
                MON
              </span>
            </div>
          </div>

          {/* Window Duration */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-fg">
              Sliding Window Duration (Seconds)
            </label>
            <p className="mb-2 text-[11px] text-fg-muted">
              Timespan before accumulated spend and velocity counters reset (e.g. 3600 = 1 hour).
            </p>
            <input
              type="number"
              min="1"
              value={windowSecondsInput}
              onChange={(e) => setWindowSecondsInput(e.target.value)}
              className="block w-full rounded-xl border border-card-border bg-card px-4 py-2.5 text-sm font-medium text-fg focus:border-primary focus:outline-none"
              required
            />
          </div>

          {/* Max Velocity */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-fg">
              Max Transaction Velocity
            </label>
            <p className="mb-2 text-[11px] text-fg-muted">
              Maximum allowable transaction count per window to prevent runaway loops or bot compromise.
            </p>
            <input
              type="number"
              min="1"
              value={maxVelocityInput}
              onChange={(e) => setMaxVelocityInput(e.target.value)}
              className="block w-full rounded-xl border border-card-border bg-card px-4 py-2.5 text-sm font-medium text-fg focus:border-primary focus:outline-none"
              required
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-6 border-t border-card-border pt-4">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={whitelistEnabled}
              onChange={(e) => setWhitelistEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-card-border text-primary focus:ring-primary"
            />
            <span className="text-xs font-semibold text-fg">
              Enforce Authorized Merchant Whitelist
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={killSwitch}
              onChange={(e) => setKillSwitch(e.target.checked)}
              className="h-4 w-4 rounded border-danger/40 text-danger focus:ring-danger"
            />
            <span className="text-xs font-semibold text-danger">
              Active Kill Switch (Immediate Halt)
            </span>
          </label>
        </div>

        {/* Merchant Whitelist Manager */}
        {whitelistEnabled && (
          <Card muted padding="md" className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-fg">
                  Approved Merchant Counterparties
                </h4>
                <p className="text-[11px] text-fg-muted">
                  Only transactions to these whitelisted addresses will be approved by PolicyEngine on Monad.
                </p>
              </div>
              <span className="rounded-full bg-primary-subtle px-2.5 py-0.5 text-[10px] font-bold text-primary">
                Onchain Mapping
              </span>
            </div>

            <div className="rounded-xl border border-dashed border-card-border bg-card/60 p-5 text-center text-xs">
              <p className="font-semibold text-fg">No merchant whitelist records loaded</p>
              <p className="mt-1 text-fg-muted">Whitelist entries will appear only after they are read from the deployed PolicyEngine.</p>
            </div>
          </Card>
        )}

        {saveSuccess && (
          <div className="flex items-center space-x-2 rounded-xl bg-success-subtle p-3 text-xs text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Policy successfully confirmed on Monad Parallel EVM.</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center space-x-2 rounded-xl bg-danger-subtle p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            variant="primary"
            leftIcon={<Save className="h-4 w-4" />}
            loading={saving}
            loadingLabel="Committing to Monad..."
          >
            Save Onchain Policy
          </Button>
        </div>
      </form>

      {/* Disjoint Storage Slot Live Inspector */}
      <div className="mt-8 border-t border-card-border pt-6">
        <DisjointSlotVisualizer state={agent.state} agentAddress={agent.address} />
      </div>
    </Card>
  );
};
