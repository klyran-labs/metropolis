import React, { useState, useMemo } from 'react';
import { type Address } from 'viem';
import { Shield, ShieldAlert, Zap, Lock, Unlock, Plus, Play, Search } from 'lucide-react';
import { type FleetAgent } from '@agentguard/shared-types';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { StatCard } from '../common/StatCard';
import { SegmentedControl } from '../common/SegmentedControl';
import { KillSwitchConfirmDialog } from '../common/KillSwitchConfirmDialog';

interface FleetOverviewProps {
  agents: FleetAgent[];
  onToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
  onSelectAgent: (agent: FleetAgent) => void;
  selectedAgentAddress?: Address | null;
  onOpenOnboarding?: () => void;
  onRunLifecycle?: (agent: FleetAgent) => void;
}

const STATUS_FILTERS = [
  { value: 'ALL', label: 'ALL' },
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'REVOKED', label: 'REVOKED' },
] as const;

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
  const [pendingKillSwitchAgent, setPendingKillSwitchAgent] = useState<FleetAgent | null>(null);

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

  const handleConfirmKillSwitch = async () => {
    if (!pendingKillSwitchAgent) return;
    const agent = pendingKillSwitchAgent;
    try {
      setTogglingAddress(agent.address);
      await onToggleKillSwitch(agent.address, agent.policy.killSwitch);
    } finally {
      setTogglingAddress(null);
      setPendingKillSwitchAgent(null);
    }
  };

  const avgVelocity = agents.reduce((acc, a) => acc + a.state.txCountInWindow, 0) / (agents.length || 1);
  const reputationAgents = agents.filter((a) => a.reputation);
  const avgReputation =
    reputationAgents.reduce((acc, a) => acc + (a.reputation?.rollingScoreBps || 0), 0) / (reputationAgents.length || 1) / 10000;

  return (
    <div className="space-y-6">
      {/* KPI Header Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Agent Fleets"
          icon={Shield}
          tone="info"
          value={agents.filter((a) => !a.policy.killSwitch).length}
          suffix={`/ ${agents.length} configured`}
          footnote="Monad Testnet (10143)"
        />
        <StatCard
          label="Emergency Kill Switches"
          icon={ShieldAlert}
          tone="danger"
          value={agents.filter((a) => a.policy.killSwitch).length}
          suffix="revoked"
          footnote="O(1) instant onchain cutoff"
        />
        <StatCard
          label="Mean Velocity"
          icon={Zap}
          tone="warning"
          value={avgVelocity.toFixed(1)}
          suffix="tx/window"
          footnote="Rolling sliding window"
        />
        <StatCard
          label="Average Trust Score"
          icon={Shield}
          tone="success"
          value={avgReputation.toFixed(1)}
          suffix={agents.some((a) => a.reputation) ? '%' : 'unavailable'}
          footnote="Onchain EWMA calculation"
        />
      </div>

      {/* Fleet Agents Table Header & Controls */}
      <Card padding="none">
        <div className="flex flex-col space-y-3 border-b border-card-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <h2 className="text-base font-semibold text-fg">Monitored Agent Wallets</h2>
            <p className="text-xs text-fg-muted">
              Each agent wallet is bound to a disjoint onchain policy slot on Monad Parallel EVM.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-fg-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agent name or address..."
                className="rounded-xl border border-card-border bg-card py-1.5 pl-8 pr-3 text-xs text-fg outline-none focus:border-primary"
              />
            </div>

            <SegmentedControl
              aria-label="Filter agents by status"
              options={STATUS_FILTERS}
              value={statusFilter}
              onChange={setStatusFilter}
            />

            {onOpenOnboarding && (
              <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={onOpenOnboarding}>
                Register Agent
              </Button>
            )}
          </div>
        </div>

        {filteredAgents.length === 0 ? (
          <div className="p-12 text-center">
            <Shield className="mx-auto h-12 w-12 text-fg-subtle" />
            <h3 className="mt-4 text-sm font-semibold text-fg">No Matching Agents</h3>
            <p className="mt-1 text-xs text-fg-muted">
              No configured agent matches the current status filter or search query.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-fg-muted">
              <thead className="border-b border-card-border bg-card-muted text-xs font-semibold text-fg-muted uppercase">
                <tr>
                  <th scope="col" className="px-6 py-3">Agent Name & Account</th>
                  <th scope="col" className="px-6 py-3">Status</th>
                  <th scope="col" className="px-6 py-3">Velocity (Tx / Limit)</th>
                  <th scope="col" className="px-6 py-3">Window Spend</th>
                  <th scope="col" className="px-6 py-3">Reputation</th>
                  <th scope="col" className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {filteredAgents.map((agent) => {
                  const isSelected = selectedAgentAddress?.toLowerCase() === agent.address.toLowerCase();
                  const velocityPct = agent.policy.maxVelocity > 0
                    ? Math.min(100, Math.round((agent.state.txCountInWindow / agent.policy.maxVelocity) * 100))
                    : 0;

                  return (
                    <tr
                      key={agent.address}
                      onClick={() => onSelectAgent(agent)}
                      className={`cursor-pointer transition-colors hover:bg-card-muted ${
                        isSelected ? 'bg-primary-subtle' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-card-muted font-bold text-fg-muted">
                            {agent.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-fg">{agent.name}</p>
                            <div className="flex items-center space-x-2 text-xs text-fg-subtle">
                              <span className="font-mono">{agent.address.slice(0, 6)}...{agent.address.slice(-4)}</span>
                              <span>•</span>
                              <span>{agent.role}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {agent.policy.killSwitch ? (
                          <span className="inline-flex items-center space-x-1 rounded-full bg-danger-subtle px-2.5 py-0.5 text-xs font-semibold text-danger">
                            <ShieldAlert className="h-3 w-3" />
                            <span>REVOKED</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 rounded-full bg-success-subtle px-2.5 py-0.5 text-xs font-semibold text-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                            <span>ACTIVE</span>
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <div className="w-36">
                          <div className="flex justify-between text-xs">
                            <span className="font-semibold text-fg">
                              {agent.state.txCountInWindow} / {agent.policy.maxVelocity}
                            </span>
                            <span className="text-[10px] text-fg-subtle">{velocityPct}%</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full rounded-full bg-card-muted overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                velocityPct >= 90 ? 'bg-danger' : velocityPct >= 70 ? 'bg-warning' : 'bg-primary'
                              }`}
                              style={{ width: `${velocityPct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-mono font-semibold text-fg">
                          {(Number(agent.state.spentInWindow) / 1e18).toFixed(4)} MON
                        </span>
                        <div className="text-[11px] text-fg-subtle">
                          Limit: {(Number(agent.policy.maxPerWindow) / 1e18).toFixed(2)} MON
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-bold text-fg">
                            {agent.reputation ? `${(agent.reputation.rollingScoreBps / 10000).toFixed(1)}%` : 'Unavailable'}
                          </span>
                          <span className="text-[10px] text-fg-subtle">
                            {agent.reputation ? `(${agent.reputation.settledCount} settled)` : '(no recorded outcomes)'}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {onRunLifecycle && (
                            <Button
                              variant="secondary"
                              size="sm"
                              leftIcon={<Play className="h-3 w-3" />}
                              onClick={(e) => {
                                e.stopPropagation();
                                onRunLifecycle(agent);
                              }}
                              title="Run interactive end-to-end lifecycle for this agent"
                            >
                              Lifecycle
                            </Button>
                          )}

                          <Button
                            variant={agent.policy.killSwitch ? 'secondary' : 'outline-danger'}
                            size="sm"
                            disabled={togglingAddress === agent.address}
                            leftIcon={agent.policy.killSwitch ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingKillSwitchAgent(agent);
                            }}
                          >
                            {togglingAddress === agent.address
                              ? (agent.policy.killSwitch ? 'Restoring...' : 'Halting...')
                              : (agent.policy.killSwitch ? 'Restore' : 'Kill Switch')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <KillSwitchConfirmDialog
        isOpen={pendingKillSwitchAgent !== null}
        agentName={pendingKillSwitchAgent?.name ?? 'this agent'}
        activating={pendingKillSwitchAgent ? !pendingKillSwitchAgent.policy.killSwitch : false}
        onConfirm={handleConfirmKillSwitch}
        onCancel={() => setPendingKillSwitchAgent(null)}
      />
    </div>
  );
};
