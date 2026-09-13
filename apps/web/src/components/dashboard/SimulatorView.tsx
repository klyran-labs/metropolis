import React, { useState, useEffect, useMemo } from 'react';
import { Play, Search, Shield, Filter, CheckCircle2, ChevronRight, Zap } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { RogueAgentSimulator } from './RogueAgentSimulator';
import { FleetDemoController } from './FleetDemoController';
import { Card } from '../common/Card';

/**
 * /simulator — Enterprise Master-Detail Risk Simulator Workbench.
 * Integrates Multi-Agent Fleet Scenario Orchestrator with Granular
 * Single-Agent Intent Testbench in a cohesive side-by-side workspace.
 */
export const SimulatorView: React.FC = () => {
  const {
    agents,
    selectedAgent,
    setSelectedAgentAddress,
    handleExecuteSimulation,
    handleToggleKillSwitch,
  } = useDashboard();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Automatically select first agent if none is currently selected
  useEffect(() => {
    if (!selectedAgent && agents.length > 0) {
      setSelectedAgentAddress(agents[0].address);
    }
  }, [selectedAgent, agents, setSelectedAgentAddress]);

  const activeAgent = selectedAgent || agents[0];

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      const matchesSearch =
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.role.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === 'ALL' || a.role.toLowerCase() === roleFilter.toLowerCase();
      return matchesSearch && matchesRole;
    });
  }, [agents, searchQuery, roleFilter]);

  return (
    <div className="space-y-4 font-sans">
      {/* 20-Agent Fleet Autonomous Scenario Runner */}
      <FleetDemoController />

      {/* Responsive Master-Detail Simulation Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column: Fleet Directory Selector (4 cols on lg) */}
        <div className="lg:col-span-4 space-y-3">
          <Card padding="sm" className="space-y-3">
            <div className="flex items-center justify-between border-b border-card-border pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary-subtle text-primary shadow-xs">
                  <Shield className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-sm font-bold text-fg">Fleet Directory</h3>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-card-muted text-fg-muted border border-card-border">
                {filteredAgents.length} / {agents.length}
              </span>
            </div>

            {/* Filter / Search Bar */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by agent or 0x..."
                  className="w-full rounded-xl border border-card-border bg-card-muted pl-8 pr-3 py-1.5 text-xs text-fg placeholder:text-fg-subtle outline-none focus:border-primary focus:bg-card transition"
                />
              </div>

              {/* Quick Role Filter Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none text-[10px]">
                {['ALL', 'AUTONOMOUS', 'OPERATIONAL', 'INFERENCE'].map((rf) => (
                  <button
                    key={rf}
                    type="button"
                    onClick={() => setRoleFilter(rf)}
                    className={`px-2 py-0.5 rounded-lg font-medium transition cursor-pointer shrink-0 ${
                      roleFilter === rf
                        ? 'bg-primary text-white shadow-2xs font-semibold'
                        : 'bg-card-muted text-fg-muted hover:text-fg'
                    }`}
                  >
                    {rf}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Agent List */}
            <div className="max-h-[580px] overflow-y-auto space-y-2 pr-1">
              {filteredAgents.map((a) => {
                const isSelected = activeAgent && activeAgent.address.toLowerCase() === a.address.toLowerCase();
                const limitMon = Number(a.policy.maxPerTx) / 1e18;
                return (
                  <button
                    key={a.address}
                    type="button"
                    onClick={() => setSelectedAgentAddress(a.address)}
                    className={`w-full text-left rounded-xl p-3 border transition-all duration-150 cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-primary bg-primary-subtle/25 ring-1 ring-primary shadow-xs'
                        : 'border-card-border bg-card hover:border-primary/40 hover:bg-card-muted'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${a.policy.killSwitch ? 'bg-danger' : 'bg-emerald-500'}`} />
                          <span className="font-bold text-xs text-fg truncate">{a.name}</span>
                        </div>
                        <p className="font-mono text-[10px] text-fg-muted mt-0.5 truncate">{a.address}</p>
                      </div>
                      <span className="shrink-0 rounded-md bg-card border border-card-border px-1.5 py-0.5 text-[9px] font-semibold text-fg-muted uppercase">
                        {a.role.slice(0, 10)}
                      </span>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-card-border/60 flex items-center justify-between text-[11px] text-fg-muted">
                      <span>Cap: <strong className="text-fg font-mono">{limitMon} MON</strong></span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${isSelected ? 'text-primary font-bold' : 'text-fg-subtle group-hover:text-primary'}`}>
                        {isSelected ? 'Active Subject' : 'Inspect →'}
                      </span>
                    </div>
                  </button>
                );
              })}
              {filteredAgents.length === 0 && (
                <div className="p-6 text-center text-xs text-fg-muted">
                  No agents matching "{searchQuery}"
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Interactive Granular Simulation Testbench (8 cols on lg) */}
        <div className="lg:col-span-8">
          {activeAgent ? (
            <RogueAgentSimulator
              agent={activeAgent}
              onExecuteSimulation={handleExecuteSimulation}
              onToggleKillSwitch={handleToggleKillSwitch}
            />
          ) : (
            <Card padding="lg" className="text-center text-fg-muted text-xs">
              No agents provisioned in fleet.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default SimulatorView;

