import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Shield, Layers, Sliders, Play, FileText, ShieldAlert, ArrowRight, X } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { ReasonCode } from '@agentguard/shared-types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { agents, budgetPools, handleToggleKillSwitch } = useDashboard();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else onClose(); // parent handles toggle
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.toLowerCase().trim();

  const navigationCommands = [
    { label: 'Fleet Command', route: '/fleet', icon: Shield, detail: 'View monitored autonomous agents' },
    { label: 'Budget Allocations', route: '/pools', icon: Layers, detail: 'Shared team budget pools and caps' },
    { label: 'Guardrail Authoring', route: '/studio', icon: Sliders, detail: 'Configure per-transaction and window limits' },
    { label: 'Risk Simulator', route: '/simulator', icon: Play, detail: 'Run 20-agent autonomous scenario' },
    { label: 'Audit Trail', route: '/audit', icon: FileText, detail: 'Verifiable reason-code decision ledger' },
    { label: 'Policy Invariants', route: '/compliance', icon: Shield, detail: 'Cryptographic risk governance and invariant attestation' },
  ].filter((item) => !q || item.label.toLowerCase().includes(q) || item.detail.toLowerCase().includes(q));

  const matchingAgents = agents.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.address.toLowerCase().includes(q)
  ).slice(0, 5);

  const matchingPools = budgetPools.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.poolId.toLowerCase().includes(q)
  ).slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 sm:pt-28 px-4 font-sans pointer-events-auto">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-card border border-card-border shadow-2xl animate-fade-in-up">
        {/* Search Header */}
        <div className="relative flex items-center border-b border-card-border px-4 py-3.5 bg-card-muted/50">
          <Search className="h-4 w-4 text-fg-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents, pools, policy rules, or shortcuts... (Esc to close)"
            className="w-full bg-transparent px-3 py-1 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-fg-muted hover:bg-card-muted hover:text-fg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-4 text-xs">
          {/* Routes */}
          {navigationCommands.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Navigation</p>
              <div className="mt-1 space-y-1">
                {navigationCommands.map((nav) => {
                  const Icon = nav.icon;
                  return (
                    <button
                      key={nav.route}
                      type="button"
                      onClick={() => {
                        navigate(nav.route);
                        onClose();
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-card-muted transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-card-muted text-fg">
                          <Icon className="h-3.5 w-3.5 text-primary" />
                        </span>
                        <div>
                          <p className="font-bold text-fg">{nav.label}</p>
                          <p className="text-[11px] text-fg-muted">{nav.detail}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-fg-subtle" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Agents */}
          {matchingAgents.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Autonomous Agents</p>
              <div className="mt-1 space-y-1">
                {matchingAgents.map((agent) => (
                  <div
                    key={agent.address}
                    className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-card-muted transition"
                  >
                    <div>
                      <p className="font-bold text-fg">{agent.name}</p>
                      <p className="font-mono text-[10px] text-fg-muted">
                        {agent.address.slice(0, 8)}…{agent.address.slice(-6)} • Velocity: {agent.state.txCountInWindow}/{agent.policy.maxVelocity}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        await handleToggleKillSwitch(agent.address, agent.policy.killSwitch);
                        onClose();
                      }}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold ${
                        agent.policy.killSwitch
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      <ShieldAlert className="h-3 w-3" />
                      {agent.policy.killSwitch ? 'Restore Agent' : 'Emergency Stop'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Budget Pools */}
          {matchingPools.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Budget Pools</p>
              <div className="mt-1 space-y-1">
                {matchingPools.map((pool) => (
                  <button
                    key={pool.poolId}
                    type="button"
                    onClick={() => {
                      navigate('/pools');
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-card-muted transition"
                  >
                    <div>
                      <p className="font-bold text-fg">{pool.name}</p>
                      <p className="text-[10px] text-fg-muted">Allocation Cap: {(Number(pool.totalBudget) / 1e18).toFixed(2)} MON</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-fg-subtle" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="border-t border-card-border bg-card-muted/50 px-4 py-2.5 text-[11px] text-fg-muted flex justify-between items-center">
          <span>Navigate with <kbd className="rounded border border-card-border bg-card px-1.5 py-0.5 font-mono text-fg-muted">↑</kbd> <kbd className="rounded border border-card-border bg-card px-1.5 py-0.5 font-mono text-fg-muted">↓</kbd></span>
          <span>Press <kbd className="rounded border border-card-border bg-card px-1.5 py-0.5 font-mono text-fg-muted">Esc</kbd> to exit</span>
        </div>
      </div>
    </div>
  );
};
