import React, { useState, useEffect, useMemo } from 'react';
import { type Address, parseEther } from 'viem';
import {
  Sliders,
  Save,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Search,
  Check,
  Cpu,
  Clock,
  Zap,
  Lock,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { type FleetAgent, type SpendPolicy } from '@agentguard/shared-types';
import { DisjointSlotVisualizer } from './DisjointSlotVisualizer';
import { Pagination } from '../common/Pagination';
import { useRbac } from '../../context/RbacContext';

interface PolicyStudioProps {
  agent: FleetAgent | null;
  agents?: FleetAgent[];
  onSelectAgent?: (agentAddress: Address) => void;
  onSavePolicy: (agentAddress: Address, policy: SpendPolicy) => Promise<void>;
}

export const PolicyStudio: React.FC<PolicyStudioProps> = ({
  agent,
  agents = [],
  onSelectAgent,
  onSavePolicy,
}) => {
  const { can, roleConfig } = useRbac();
  const [searchQuery, setSearchQuery] = useState('');
  const [maxPerTxInput, setMaxPerTxInput] = useState('1.0');
  const [maxPerWindowInput, setMaxPerWindowInput] = useState('5.0');
  const [windowSecondsInput, setWindowSecondsInput] = useState('3600');
  const [maxVelocityInput, setMaxVelocityInput] = useState('10');
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active agent fallback
  const activeAgent = agent || (agents.length > 0 ? agents[0] : null);

  useEffect(() => {
    if (activeAgent) {
      setMaxPerTxInput((Number(activeAgent.policy.maxPerTx) / 1e18).toString());
      setMaxPerWindowInput((Number(activeAgent.policy.maxPerWindow) / 1e18).toString());
      setWindowSecondsInput(activeAgent.policy.windowSeconds.toString());
      setMaxVelocityInput(activeAgent.policy.maxVelocity.toString());
      setWhitelistEnabled(activeAgent.policy.whitelistEnabled);
      setKillSwitch(activeAgent.policy.killSwitch);
      setSaveSuccess(false);
      setErrorMessage(null);
    }
  }, [activeAgent]);

  // Filter agents for master sidebar
  const [directoryPage, setDirectoryPage] = useState(1);
  const [directoryPageSize, setDirectoryPageSize] = useState(8);

  useEffect(() => {
    setDirectoryPage(1);
  }, [searchQuery]);

  const filteredAgents = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.address.toLowerCase().includes(q)
    );
  }, [agents, searchQuery]);

  const paginatedAgents = useMemo(() => {
    const start = (directoryPage - 1) * directoryPageSize;
    return filteredAgents.slice(start, start + directoryPageSize);
  }, [filteredAgents, directoryPage, directoryPageSize]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAgent) return;
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
        agent: activeAgent.address,
        maxPerTx: maxPerTxWei,
        maxPerWindow: maxPerWindowWei,
        windowSeconds,
        maxVelocity,
        whitelistEnabled,
        killSwitch,
      };

      await onSavePolicy(activeAgent.address, updatedPolicy);
      setSaveSuccess(true);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to update policy on Monad');
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (tx: string, window: string, duration: string, velocity: string) => {
    setMaxPerTxInput(tx);
    setMaxPerWindowInput(window);
    setWindowSecondsInput(duration);
    setMaxVelocityInput(velocity);
    setSaveSuccess(false);
    setErrorMessage(null);
  };

  const [showSlotVisualizer, setShowSlotVisualizer] = useState(false);

  return (
    <div className="space-y-4 font-sans">
      {/* Top Header Banner */}
      <div className="rounded-2xl border border-card-border bg-card p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-fg tracking-tight">Policy Authoring Studio</h1>
            <span className="rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2.5 py-0.5 border border-primary/20 font-mono">
              Active Spend Control
            </span>
          </div>
          <p className="text-xs text-fg-muted mt-1">
            Configure transaction spend caps, time-window limits, velocity thresholds, and emergency freeze rules.
          </p>
        </div>

        {/* Telemetry & Finality Badge */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2 rounded-xl bg-card-muted border border-card-border px-3.5 py-1.5 text-xs text-fg-muted font-mono">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-fg font-medium">Monad Real-Time</span>
          </div>
        </div>
      </div>

      {/* Master-Detail Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Column (4 cols): Fleet Directory */}
        <div className="xl:col-span-4 rounded-2xl border border-card-border bg-card p-4 flex flex-col shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-card-border">
            <div>
              <h2 className="text-sm font-bold text-fg tracking-tight">Fleet Directory</h2>
              <p className="text-[11px] text-fg-muted mt-0.5">Select an agent to manage guardrails</p>
            </div>
            <span className="text-xs font-mono text-fg-subtle bg-card-muted px-2 py-0.5 rounded-lg border border-card-border">
              {agents.length} Agents
            </span>
          </div>

          {/* Search bar */}
          <div className="relative my-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter agents by name or address..."
              className="w-full rounded-xl bg-card-muted border border-card-border pl-9 pr-3 py-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition"
            />
          </div>

          {/* Agents List */}
          <div className="space-y-1.5 max-h-[640px] overflow-y-auto pr-1">
            {paginatedAgents.map((a) => {
              const isSelected = activeAgent?.address.toLowerCase() === a.address.toLowerCase();
              const isHalted = a.policy.killSwitch;

              return (
                <button
                  key={a.address}
                  type="button"
                  onClick={() => onSelectAgent?.(a.address)}
                  className={`group relative w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'border-primary bg-primary/10 shadow-xs'
                      : 'border-transparent hover:border-card-border bg-card-muted/40 hover:bg-card-muted'
                  }`}
                >
                  {/* Active Indicator Bar */}
                  {isSelected && (
                    <span className="absolute left-0 inset-y-2 w-1 bg-primary rounded-r-full" />
                  )}

                  <div className="min-w-0 pr-2 pl-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-fg truncate">{a.name}</span>
                      {isHalted && (
                        <span className="text-[9px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded font-mono">
                          HALTED
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-muted font-mono truncate mt-0.5">
                      {a.address.slice(0, 8)}…{a.address.slice(-6)}
                    </div>
                    <div className="text-[10px] text-fg-subtle mt-1.5 flex items-center gap-2">
                      <span>Rate: <strong className="text-fg font-medium">{a.policy.maxVelocity} tx/w</strong></span>
                      <span>·</span>
                      <span>Cap: <strong className="text-fg font-medium">{Number(a.policy.maxPerTx) / 1e18} MON</strong></span>
                    </div>
                  </div>

                  <ChevronRight
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      isSelected ? 'text-primary translate-x-0.5' : 'text-fg-subtle group-hover:text-fg-muted'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Directory Pagination */}
          <Pagination
            currentPage={directoryPage}
            pageSize={directoryPageSize}
            totalItems={filteredAgents.length}
            pageSizeOptions={[8, 16, 32]}
            onPageChange={setDirectoryPage}
            onPageSizeChange={(size) => {
              setDirectoryPageSize(size);
              setDirectoryPage(1);
            }}
            className="mt-3 rounded-xl border border-card-border"
          />
        </div>

        {/* Right Column (8 cols): Active Policy Editor */}
        <div className="xl:col-span-8 space-y-4">
          {activeAgent ? (
            <div className="rounded-2xl border border-card-border bg-card p-6 shadow-xs space-y-6">
              {/* Active Agent Identity Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-card-border pb-5 gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-primary/15 border border-primary/25 text-primary flex items-center justify-center font-bold text-sm uppercase shadow-inner">
                    {activeAgent.name.slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-fg tracking-tight">
                        {activeAgent.name}
                      </h2>
                      <span className="rounded-full bg-card-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted border border-card-border">
                        {activeAgent.role}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-fg-subtle mt-0.5">{activeAgent.address}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold px-3 py-1 font-mono">
                    Reputation: 98% (Tier 1)
                  </span>
                  {activeAgent.policy.killSwitch && (
                    <span className="flex items-center gap-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 px-3 py-1 text-[10px] font-bold font-mono">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>HALTED ONCHAIN</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Form Controls */}
              <form onSubmit={handleSave} className="space-y-6">
                {/* Template Chips Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1">
                  <div>
                    <h3 className="text-xs font-bold text-fg uppercase tracking-wider">Guardrail Invariants</h3>
                    <p className="text-[11px] text-fg-muted">Set spending and execution bounds enforced in parallel EVM storage</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-fg-subtle mr-1 hidden sm:inline">Templates:</span>
                    <button
                      type="button"
                      onClick={() => applyPreset('0.5', '2.0', '1800', '15')}
                      className="px-2.5 py-1 rounded-lg bg-card-muted hover:bg-card border border-card-border hover:border-primary/40 text-[11px] font-medium text-fg-muted hover:text-fg transition cursor-pointer"
                    >
                      Micro-Spend
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('1.0', '5.0', '3600', '10')}
                      className="px-2.5 py-1 rounded-lg bg-card-muted hover:bg-card border border-card-border hover:border-primary/40 text-[11px] font-medium text-fg-muted hover:text-fg transition cursor-pointer"
                    >
                      Standard Fleet
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('5.0', '20.0', '7200', '30')}
                      className="px-2.5 py-1 rounded-lg bg-card-muted hover:bg-card border border-card-border hover:border-primary/40 text-[11px] font-medium text-fg-muted hover:text-fg transition cursor-pointer"
                    >
                      High-Capacity
                    </button>
                  </div>
                </div>

                {/* 4 Invariant Fields (Streamlined 2x2 Grid) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Max Spend Per Transaction */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-fg">
                      Max Spend Per Transaction
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={maxPerTxInput}
                        onChange={(e) => setMaxPerTxInput(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-muted/60 border border-card-border focus:border-primary focus:bg-card text-sm text-fg font-mono placeholder:text-fg-subtle focus:outline-none transition pr-16"
                        required
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-fg-muted bg-card px-2 py-0.5 rounded-md border border-card-border">
                        MON
                      </span>
                    </div>
                    <p className="text-[11px] text-fg-subtle">
                      Ceiling for individual payment transfers
                    </p>
                  </div>

                  {/* Max Spend Per Sliding Window */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-fg">
                      Max Spend Per Sliding Window
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={maxPerWindowInput}
                        onChange={(e) => setMaxPerWindowInput(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-muted/60 border border-card-border focus:border-primary focus:bg-card text-sm text-fg font-mono placeholder:text-fg-subtle focus:outline-none transition pr-16"
                        required
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-fg-muted bg-card px-2 py-0.5 rounded-md border border-card-border">
                        MON
                      </span>
                    </div>
                    <p className="text-[11px] text-fg-subtle">
                      Cumulative spend limit across the rolling window
                    </p>
                  </div>

                  {/* Sliding Window Duration */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-fg">
                      Sliding Window Duration
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        value={windowSecondsInput}
                        onChange={(e) => setWindowSecondsInput(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-muted/60 border border-card-border focus:border-primary focus:bg-card text-sm text-fg font-mono placeholder:text-fg-subtle focus:outline-none transition pr-16"
                        required
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-fg-muted bg-card px-2 py-0.5 rounded-md border border-card-border">
                        SEC
                      </span>
                    </div>
                    <p className="text-[11px] text-fg-subtle">
                      Duration before spend & velocity counters reset (3600 = 1 hr)
                    </p>
                  </div>

                  {/* Max Transaction Velocity */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-fg">
                      Max Transaction Velocity
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        value={maxVelocityInput}
                        onChange={(e) => setMaxVelocityInput(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-muted/60 border border-card-border focus:border-primary focus:bg-card text-sm text-fg font-mono placeholder:text-fg-subtle focus:outline-none transition pr-16"
                        required
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-fg-muted bg-card px-2 py-0.5 rounded-md border border-card-border">
                        TX
                      </span>
                    </div>
                    <p className="text-[11px] text-fg-subtle">
                      Maximum transaction count permitted in window
                    </p>
                  </div>
                </div>

                {/* Policy Governance & Security Controls */}
                <div className="space-y-3 pt-2">
                  {/* Whitelist Checkbox */}
                  <div className="p-3.5 rounded-xl border border-card-border bg-card-muted/40 hover:bg-card-muted/70 transition flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <input
                        id="whitelist-toggle"
                        type="checkbox"
                        checked={whitelistEnabled}
                        onChange={(e) => setWhitelistEnabled(e.target.checked)}
                        className="rounded border-card-border bg-card text-primary focus:ring-0 cursor-pointer h-4 w-4"
                      />
                      <label htmlFor="whitelist-toggle" className="cursor-pointer">
                        <span className="text-xs font-semibold text-fg block">Enforce Authorized Merchant Whitelist</span>
                        <span className="text-[11px] text-fg-muted block">Reject transactions destined for unverified or non-whitelisted contracts</span>
                      </label>
                    </div>
                  </div>

                  {/* Emergency Kill Switch Callout (Dedicated High-Salience Block) */}
                  <div className={`p-4 rounded-xl border transition ${
                    killSwitch
                      ? 'border-rose-500/40 bg-rose-500/10'
                      : 'border-card-border bg-card-muted/30'
                  }`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg mt-0.5 ${
                          killSwitch ? 'bg-rose-500 text-white' : 'bg-card-muted text-rose-500'
                        }`}>
                          <ShieldAlert className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-fg">Active Kill Switch (Immediate Halt)</span>
                            {!can('canToggleKillSwitch') && (
                              <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.2 rounded">
                                SecOps Only
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-fg-muted mt-0.5 leading-relaxed">
                            {killSwitch
                              ? 'Agent is frozen. All outgoing transactions are immediately intercepted and denied onchain.'
                              : 'Emergency override to freeze this agent instantly onchain without mutating other policy rules.'}
                          </p>
                        </div>
                      </div>

                      <label className={`flex items-center gap-2 shrink-0 ${can('canToggleKillSwitch') ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                        <input
                          type="checkbox"
                          checked={killSwitch}
                          disabled={!can('canToggleKillSwitch')}
                          onChange={(e) => setKillSwitch(e.target.checked)}
                          className="rounded border-rose-400 bg-card text-rose-600 focus:ring-0 h-4 w-4 disabled:cursor-not-allowed"
                        />
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                          {killSwitch ? 'HALTED' : 'Normal'}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Status Feedback Messages */}
                {errorMessage && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2.5"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {saveSuccess && (
                  <div
                    role="status"
                    className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs flex items-center gap-2.5 font-mono"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                    <span>Guardrail policy committed onchain on Monad Parallel EVM.</span>
                  </div>
                )}

                {/* Submit Action Bar */}
                <div className="flex items-center justify-end pt-2 border-t border-card-border">
                  <button
                    type="submit"
                    disabled={saving || !can('canEditPolicy')}
                    title={
                      !can('canEditPolicy')
                        ? `Policy modification disabled: Requires Treasury Manager or Super Admin (Current: ${roleConfig.label})`
                        : 'Save Guardrail Policy'
                    }
                    className={`px-6 py-2.5 rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-2 ${
                      !can('canEditPolicy')
                        ? 'bg-card-muted text-fg-subtle border border-card-border cursor-not-allowed'
                        : 'bg-primary hover:bg-primary-hover text-white shadow-primary/25 cursor-pointer disabled:opacity-50'
                    }`}
                  >
                    {!can('canEditPolicy') ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>Policy Updates Locked ({roleConfig.badge})</span>
                      </>
                    ) : saving ? (
                      <>
                        <span className="animate-spin text-white">⚙</span>
                        <span>Committing Onchain Invariants…</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Guardrail Policy</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Collapsible Disjoint 32-Byte Storage Visualizer */}
              <div className="border-t border-card-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowSlotVisualizer(!showSlotVisualizer)}
                  className="flex items-center justify-between w-full py-2 text-xs font-semibold text-fg-muted hover:text-fg transition cursor-pointer"
                >
                  <span className="flex items-center gap-2 font-mono text-[11px]">
                    <Cpu className="w-3.5 h-3.5 text-primary" />
                    <span>Onchain State Commitment • Atomic Storage Slot</span>
                  </span>
                  <span className="text-[11px] text-primary hover:underline">
                    {showSlotVisualizer ? 'Hide Architecture' : 'Inspect Packed Storage'}
                  </span>
                </button>
                {showSlotVisualizer && (
                  <div className="mt-3 animate-fade-in-up">
                    <DisjointSlotVisualizer state={activeAgent.state} agentAddress={activeAgent.address} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-card-border bg-card p-12 text-center text-fg-subtle text-xs italic">
              No agents loaded. Please deploy agents or verify Monad Devnet connection.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PolicyStudio;
