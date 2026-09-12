import React, { useState, useMemo } from 'react';
import { type Address } from 'viem';
import { Shield, ShieldAlert, Zap, AlertTriangle, ArrowUpRight, Lock, Unlock, Plus, Play, Search } from 'lucide-react';
import { type FleetAgent, ReasonCode } from '@agentguard/shared-types';
import { MONAD_EXPLORER_URL } from '../../config/contracts';

interface FleetOverviewProps {
  agents: FleetAgent[];
  onToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
  onSelectAgent: (agent: FleetAgent) => void;
  selectedAgentAddress?: Address | null;
  onOpenOnboarding?: () => void;
  onRunLifecycle?: (agent: FleetAgent) => void;
}

export const FleetOverview: React.FC<FleetOverviewProps> = ({
  agents,
  onToggleKillSwitch,
  onSelectAgent,
  selectedAgentAddress,
  onOpenOnboarding,
  onRunLifecycle,
}) => {
  const [togglingAddress, setTogglingAddress] = useState<Address | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'REVOKED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      const matchesStatus =
        statusFilter === 'ALL'
          ? true
          : statusFilter === 'REVOKED'
          ? agent.policy.killSwitch
          : !agent.policy.killSwitch;

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        agent.name.toLowerCase().includes(q) ||
        agent.role.toLowerCase().includes(q) ||
        agent.address.toLowerCase().includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [agents, statusFilter, searchQuery]);

  const handleKillSwitch = async (e: React.MouseEvent, agent: FleetAgent) => {
    e.stopPropagation();
    try {
      setTogglingAddress(agent.address);
      await onToggleKillSwitch(agent.address, agent.policy.killSwitch);
    } finally {
      setTogglingAddress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Header Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Agent Fleets
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <Shield className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
            {agents.filter((a) => !a.policy.killSwitch).length}
            <span className="ml-1 text-sm font-normal text-slate-500">/ {agents.length} configured</span>
          </p>
          <div className="mt-2 flex items-center text-xs text-emerald-600 dark:text-emerald-400">
            <span className="font-semibold">Monad Testnet (10143)</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Emergency Kill Switches
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
              <ShieldAlert className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
            {agents.filter((a) => a.policy.killSwitch).length}
            <span className="ml-1 text-sm font-normal text-slate-500">revoked</span>
          </p>
          <div className="mt-2 flex items-center text-xs text-slate-500 dark:text-slate-400">
            <span>O(1) instant onchain cutoff</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Mean Velocity
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
              <Zap className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
            {(
              agents.reduce((acc, a) => acc + a.state.txCountInWindow, 0) / (agents.length || 1)
            ).toFixed(1)}
            <span className="ml-1 text-sm font-normal text-slate-500">tx/window</span>
          </p>
          <div className="mt-2 flex items-center text-xs text-blue-600 dark:text-blue-400">
            <span>Rolling sliding window</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Average Trust Score
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
              <Shield className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
            {(
              agents.filter((a) => a.reputation).reduce((acc, a) => acc + (a.reputation?.rollingScoreBps || 0), 0) / (agents.filter((a) => a.reputation).length || 1) / 10000
            ).toFixed(1)}
            <span className="ml-1 text-sm font-normal text-slate-500">{agents.some((a) => a.reputation) ? '%' : 'unavailable'}</span>
          </p>
          <div className="mt-2 flex items-center text-xs text-emerald-600 dark:text-emerald-400">
            <span>Onchain EWMA calculation</span>
          </div>
        </div>
      </div>

      {/* Fleet Agents Table Header & Controls */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col space-y-3 border-b border-slate-200/80 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Monitored Agent Wallets
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Each agent wallet is bound to a disjoint onchain policy slot on Monad Parallel EVM.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agent name or address..."
                className="rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-[#254BFF] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            {/* Status Filter Pills */}
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
              {(['ALL', 'ACTIVE', 'REVOKED'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                    statusFilter === filter
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Register New Agent CTA */}
            {onOpenOnboarding && (
              <button
                type="button"
                onClick={onOpenOnboarding}
                className="inline-flex items-center space-x-1.5 rounded-xl bg-[#254BFF] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#1D40DF] transition cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Register Agent</span>
              </button>
            )}
          </div>
        </div>

        {filteredAgents.length === 0 ? (
          <div className="p-12 text-center">
            <Shield className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">No Matching Agents</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              No configured agent matches the current status filter or search query.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-6 py-3">Agent Name & Account</th>
                  <th scope="col" className="px-6 py-3">Status</th>
                  <th scope="col" className="px-6 py-3">Velocity (Tx / Limit)</th>
                  <th scope="col" className="px-6 py-3">Window Spend</th>
                  <th scope="col" className="px-6 py-3">Reputation</th>
                  <th scope="col" className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                {filteredAgents.map((agent) => {
                  const isSelected = selectedAgentAddress?.toLowerCase() === agent.address.toLowerCase();
                  const velocityPct = agent.policy.maxVelocity > 0
                    ? Math.min(100, Math.round((agent.state.txCountInWindow / agent.policy.maxVelocity) * 100))
                    : 0;

                  return (
                    <tr
                      key={agent.address}
                      onClick={() => onSelectAgent(agent)}
                      className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                        isSelected ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {agent.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">{agent.name}</p>
                            <div className="flex items-center space-x-2 text-xs text-slate-400">
                              <span className="font-mono">{agent.address.slice(0, 6)}...{agent.address.slice(-4)}</span>
                              <span>•</span>
                              <span>{agent.role}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {agent.policy.killSwitch ? (
                          <span className="inline-flex items-center space-x-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
                            <ShieldAlert className="h-3 w-3" />
                            <span>REVOKED</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span>ACTIVE</span>
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <div className="w-36">
                          <div className="flex justify-between text-xs">
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {agent.state.txCountInWindow} / {agent.policy.maxVelocity}
                            </span>
                            <span className="text-[10px] text-slate-400">{velocityPct}%</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                velocityPct >= 90 ? 'bg-rose-500' : velocityPct >= 70 ? 'bg-amber-500' : 'bg-[#254BFF]'
                              }`}
                              style={{ width: `${velocityPct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-mono font-semibold text-slate-900 dark:text-white">
                          {(Number(agent.state.spentInWindow) / 1e18).toFixed(4)} MON
                        </span>
                        <div className="text-[11px] text-slate-400">
                          Limit: {(Number(agent.policy.maxPerWindow) / 1e18).toFixed(2)} MON
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {agent.reputation ? `${(agent.reputation.rollingScoreBps / 10000).toFixed(1)}%` : 'Unavailable'}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {agent.reputation ? `(${agent.reputation.settledCount} settled)` : '(no recorded outcomes)'}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {onRunLifecycle && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRunLifecycle(agent);
                              }}
                              className="inline-flex items-center space-x-1 rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-[#254BFF] hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400"
                              title="Run interactive end-to-end lifecycle for this agent"
                            >
                              <Play className="h-3 w-3" />
                              <span>Lifecycle</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={togglingAddress === agent.address}
                            onClick={(e) => handleKillSwitch(e, agent)}
                            className={`inline-flex items-center space-x-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all shadow-xs ${
                              agent.policy.killSwitch
                                ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {agent.policy.killSwitch ? (
                              <>
                                <Unlock className="h-3 w-3" />
                                <span>{togglingAddress === agent.address ? 'Restoring...' : 'Restore'}</span>
                              </>
                            ) : (
                              <>
                                <Lock className="h-3 w-3" />
                                <span>{togglingAddress === agent.address ? 'Halting...' : 'Kill Switch'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
