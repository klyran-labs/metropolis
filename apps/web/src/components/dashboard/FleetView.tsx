import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatEther } from 'viem';
import {
  ArrowUpRight,
  CheckCircle2,
  Sliders,
  Radio,
  Layers,
  Lock,
  Zap,
  ShieldCheck,
} from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { useRecentActivity, publicClient } from '../../hooks/usePolicyEvents';
import { MONAD_CHAIN_ID } from '../../config/contracts';
import { FleetOverview } from './FleetOverview';
import { SpendAnalyticsPanel } from './SpendAnalyticsPanel';
import { SpendVelocityChart } from './SpendVelocityChart';
import { ActivityFeed } from '../common/ActivityFeed';
import { Card } from '../common/Card';

/**
 * /fleet — Primary enterprise control plane view.
 * 2-column layout:
 * Left column: Fleet Overview (4 Hero cards + Table/Grid + Pagination + Bulk actions)
 * + Spend Velocity Time-Series + Settled Spend Analytics
 * Right column: Monad Real-Time Settlement Telemetry Radar + Live policy activity feed
 */
export const FleetView: React.FC = () => {
  const navigate = useNavigate();
  const {
    agents,
    handleToggleKillSwitch,
    selectedAgentAddress,
    setSelectedAgentAddress,
    openOnboarding,
    handleBatchProvision,
    simulatedRecords,
  } = useDashboard();
  const { events } = useRecentActivity(selectedAgentAddress ?? undefined, 100);

  const [currentBlock, setCurrentBlock] = useState<bigint | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchBlock = async () => {
      try {
        const block = await publicClient.getBlockNumber();
        if (mounted) setCurrentBlock(block);
      } catch {
        // quiet fallback
      }
    };
    fetchBlock();
    const timer = setInterval(fetchBlock, 3500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const selectedAgent = agents.find(
    (a) => selectedAgentAddress && a.address.toLowerCase() === selectedAgentAddress.toLowerCase()
  );

  return (
    <div className="space-y-4">
      {/* 4-Card AgentGuard Grid */}
      <FleetOverview
        agents={agents}
        onToggleKillSwitch={handleToggleKillSwitch}
        onSelectAgent={(agent) => setSelectedAgentAddress(agent.address)}
        selectedAgentAddress={selectedAgentAddress}
        onOpenOnboarding={openOnboarding}
        onBatchProvision={handleBatchProvision}
        onRunLifecycle={(agent) => {
          setSelectedAgentAddress(agent.address);
          navigate(`/lifecycle?agent=${agent.address}`);
        }}
      />

      {/* Analytics & Settlement Telemetry Rail Below */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Main Analytics: Velocity & Settled Spend */}
        <div className="xl:col-span-8 space-y-4">
          <SpendVelocityChart
            events={events}
            simulatedRecords={simulatedRecords}
            maxVelocityCap={selectedAgent?.policy.maxVelocity ?? 5}
            windowSeconds={selectedAgent?.policy.windowSeconds ?? 3600}
            agentAddress={selectedAgentAddress}
          />

          <SpendAnalyticsPanel
            agent={selectedAgentAddress}
            title={selectedAgentAddress ? undefined : 'Fleet-wide settled spend'}
          />
        </div>

        {/* Right Telemetry Radar & Event Stream */}
        <div className="xl:col-span-4 space-y-4">
          {/* Monad Parallel EVM Settlement Radar */}
        <div className="group relative rounded-2xl border border-card-border bg-card p-4 shadow-xs overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-card-border pb-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 shadow-xs">
                <Radio className="h-4 w-4 animate-pulse" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-fg tracking-tight">
                  Settlement Radar
                </h3>
                <p className="text-[10px] text-fg-muted font-mono">
                  Monad Parallel EVM • Chain {MONAD_CHAIN_ID}
                </p>
              </div>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
              Sub-Second Finality
            </span>
          </div>

          {/* Block Height & Determinism Telemetry */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-card-border bg-card-muted p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted font-mono">
                Latest Block
              </span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-mono text-lg font-black text-fg">
                  {currentBlock !== null ? `#${currentBlock.toString()}` : 'Syncing…'}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-card-border bg-card-muted p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted font-mono">
                Block Velocity
              </span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-mono text-lg font-black text-emerald-600 dark:text-emerald-400">
                  2.5
                </span>
                <span className="text-[10px] font-bold text-fg-muted font-mono">blocks/s</span>
              </div>
            </div>
          </div>

          {/* Parallel EVM Invariants Grid */}
          <div className="mt-4 space-y-2.5 border-t border-card-border pt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-fg-muted">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Isolated State Partitioning
              </span>
              <span className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                Atomic State Packing
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-fg-muted">
                <Lock className="h-3.5 w-3.5 text-primary" />
                Reentrancy Protection
              </span>
              <span className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                Active
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-fg-muted">
                <Zap className="h-3.5 w-3.5 text-primary" />
                Emergency Freeze
              </span>
              <span className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                Sub-Second Abort
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-fg-muted">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Audit Reason Codes
              </span>
              <span className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                100% Traceable
              </span>
            </div>
          </div>

          {/* Active Context / Selection Inspector */}
          <div className="mt-5 rounded-xl border border-card-border bg-card-muted p-3.5">
            {selectedAgent ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-fg truncate max-w-[180px]">
                    {selectedAgent.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedAgentAddress(null)}
                    className="text-[10px] text-fg-subtle hover:text-fg transition-colors cursor-pointer"
                  >
                    Clear Filter
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-fg-muted">Window Spend:</span>
                  <span className="font-bold text-fg">
                    {Number(formatEther(selectedAgent.state.spentInWindow)).toFixed(4)} / {Number(formatEther(selectedAgent.policy.maxPerWindow)).toFixed(2)} MON
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-fg-muted">Tx Velocity:</span>
                  <span className="font-bold text-fg">
                    {selectedAgent.state.txCountInWindow} / {selectedAgent.policy.maxVelocity}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/studio')}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-card py-1.5 text-xs font-semibold text-primary border border-card-border hover:bg-card-muted transition-colors shadow-2xs cursor-pointer"
                >
                  <Sliders className="h-3 w-3" />
                  Edit Guardrails for Agent
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 text-center py-1">
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-fg">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Fleet Guardrails Enforced
                </div>
                <p className="text-[11px] text-fg-muted leading-relaxed">
                  Select any agent row in the fleet table to inspect individual window consumption and real-time state.
                </p>
              </div>
            )}
          </div>

          {/* Quick Actions Button Rail */}
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-card-border pt-3">
            <button
              type="button"
              onClick={() => navigate('/simulator')}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-card-border bg-card py-2 px-3 text-xs font-semibold text-fg hover:bg-card-muted transition shadow-2xs whitespace-nowrap cursor-pointer"
            >
              <span>Risk Simulator</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-fg-subtle" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/audit')}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-card-border bg-card py-2 px-3 text-xs font-semibold text-fg hover:bg-card-muted transition shadow-2xs whitespace-nowrap cursor-pointer"
            >
              <span>Audit Ledger</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-fg-subtle" />
            </button>
          </div>
        </div>

        {/* Live Policy Activity Feed */}
        <div className="group relative rounded-2xl border border-card-border bg-card shadow-xs overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          <div className="border-b border-card-border px-5 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-fg tracking-tight">Live Policy Activity</h2>
              <p className="mt-0.5 text-xs text-fg-muted">
                Live settlement events across the fleet, newest first.
              </p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-card-muted px-2.5 py-0.5 text-[10px] font-mono font-semibold text-fg-muted border border-card-border">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Stream
            </span>
          </div>
          <div className="max-h-[500px] overflow-y-auto p-4">
            <ActivityFeed
              limit={30}
              emptyMessage="No policy events recorded yet — events will appear as agents execute intents, spend is evaluated, or emergency stops are triggered."
            />
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

export default FleetView;
