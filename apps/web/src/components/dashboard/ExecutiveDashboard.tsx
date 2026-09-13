import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatEther } from 'viem';
import {
  Shield,
  ShieldAlert,
  Zap,
  Layers,
  Sliders,
  Play,
  Users,
  ArrowUpRight,
  Activity,
  CheckCircle2,
  Radio,
  Plus,
} from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { useRbac } from '../../context/RbacContext';
import { useWeb3Wallet } from '../../hooks/useWeb3Wallet';
import { useRecentActivity } from '../../hooks/usePolicyEvents';
import { useCurrentBlock } from '../../hooks/useFleetSync';
import { PageHeader } from '../common/PageHeader';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { SpendVelocityChart } from './SpendVelocityChart';
import { SpendAnalyticsPanel } from './SpendAnalyticsPanel';
import { ActivityFeed } from '../common/ActivityFeed';
import { MONAD_CHAIN_ID } from '../../config/contracts';

export const ExecutiveDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { agents, budgetPools, openOnboarding, simulatedRecords } = useDashboard();
  const { can, roleConfig } = useRbac();
  const wallet = useWeb3Wallet();
  const currentBlock = useCurrentBlock();
  const { events } = useRecentActivity(undefined, 100);

  const activeAgentsCount = useMemo(
    () => agents.filter((a) => !a.policy.killSwitch).length,
    [agents]
  );
  const haltedAgentsCount = agents.length - activeAgentsCount;

  // Real onchain 24h settled volume from spend events
  const totalSettledWei = useMemo(() => {
    return events
      .filter((e) => e.kind === 'SPEND_RECORDED' || (e.kind === 'SPEND_EVALUATED' && e.allowed))
      .reduce((acc, curr) => acc + (curr.amount ?? 0n), 0n);
  }, [events]);

  const totalPoolBudgetWei = useMemo(() => {
    return budgetPools.reduce((acc, curr) => acc + curr.totalBudget, 0n);
  }, [budgetPools]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Overview"
        description="Autonomous fleet command deck: real-time spend ceilings, treasury solvency, and settlement telemetry on Monad."
        breadcrumbs={[{ label: 'AgentGuard', href: '/' }, { label: 'Executive Dashboard' }]}
        badge={
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Monad Testnet • 10143
          </span>
        }
        actions={
          can('canRegisterAgents') ? (
            <Button
              variant="primary"
              size="md"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={openOnboarding}
            >
              Register Agent
            </Button>
          ) : undefined
        }
      />

      {/* 4-KPI Institutional Executive Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1: Active Agents */}
        <Card
          className="p-5 flex flex-col justify-between hover:border-primary/40 transition cursor-pointer group"
          onClick={() => navigate('/fleet')}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
              Guarded Agents
            </span>
            <div className="p-2 rounded-xl bg-primary/10 text-primary group-hover:scale-105 transition-transform">
              <Shield className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-fg font-mono">
                {activeAgentsCount}
              </span>
              <span className="text-xs text-fg-muted">/ {agents.length} Total</span>
            </div>
            <p className="text-xs text-fg-muted mt-1 flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  haltedAgentsCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              {haltedAgentsCount > 0
                ? `${haltedAgentsCount} Emergency Halted`
                : '100% Policy Enforced'}
            </p>
          </div>
        </Card>

        {/* KPI 2: Settled Spend */}
        <Card
          className="p-5 flex flex-col justify-between hover:border-primary/40 transition cursor-pointer group"
          onClick={() => navigate('/audit')}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
              Settled Volume
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:scale-105 transition-transform">
              <Zap className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-fg font-mono">
                {formatEther(totalSettledWei)}
              </span>
              <span className="text-xs text-fg-muted">MON</span>
            </div>
            <p className="text-xs text-fg-muted mt-1">
              {events.length > 0 ? `${events.length} decoded onchain events` : 'Zero settled spend yet'}
            </p>
          </div>
        </Card>

        {/* KPI 3: Treasury Capacity */}
        <Card
          className="p-5 flex flex-col justify-between hover:border-primary/40 transition cursor-pointer group"
          onClick={() => navigate('/finance')}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
              Treasury Budget
            </span>
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 group-hover:scale-105 transition-transform">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-fg font-mono">
                {formatEther(totalPoolBudgetWei)}
              </span>
              <span className="text-xs text-fg-muted">MON</span>
            </div>
            <p className="text-xs text-fg-muted mt-1">
              {budgetPools.length > 0
                ? `${budgetPools.length} Active Budget Pools`
                : 'No department pools allocated'}
            </p>
          </div>
        </Card>

        {/* KPI 4: Security Health */}
        <Card
          className="p-5 flex flex-col justify-between hover:border-primary/40 transition cursor-pointer group"
          onClick={() => navigate('/fleet')}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
              Fleet Security
            </span>
            <div
              className={`p-2 rounded-xl ${
                haltedAgentsCount > 0
                  ? 'bg-danger-subtle text-danger'
                  : 'bg-emerald-500/10 text-emerald-400'
              } group-hover:scale-105 transition-transform`}
            >
              {haltedAgentsCount > 0 ? (
                <ShieldAlert className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-fg font-mono">
                {haltedAgentsCount > 0 ? 'INTERVENTION' : 'SECURE'}
              </span>
            </div>
            <p className="text-xs text-fg-muted mt-1">
              {haltedAgentsCount > 0
                ? `${haltedAgentsCount} agent halted via O(1) kill switch`
                : 'Sub-second Monad invariant lock'}
            </p>
          </div>
        </Card>
      </div>

      {/* Quick Action Launcher Grid */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-fg-muted px-1">
          Operational Workspaces & Launchers
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Action 1: Register Agent */}
          <div
            onClick={can('canRegisterAgents') ? openOnboarding : undefined}
            className={`rounded-2xl border border-card-border bg-card p-5 flex flex-col justify-between transition group ${
              can('canRegisterAgents')
                ? 'hover:border-primary/50 hover:bg-card-muted/50 cursor-pointer shadow-xs'
                : 'opacity-60 cursor-not-allowed'
            }`}
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-3.5 group-hover:scale-105 transition-transform">
                <Shield className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-fg group-hover:text-primary transition-colors flex items-center gap-1.5">
                <span>Register Agent</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-fg-muted group-hover:text-primary transition-colors" />
              </h3>
              <p className="text-xs text-fg-muted mt-1.5 leading-relaxed">
                Generate sovereign keypairs, author EIP-712 spend limits, and activate O(1) kill switches.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-card-border/60 flex items-center justify-between text-[11px] text-fg-muted">
              <span>{can('canRegisterAgents') ? 'Self-Serve' : 'Role Locked'}</span>
              <span className="text-primary font-medium">Launch →</span>
            </div>
          </div>

          {/* Action 2: Treasury & Pools */}
          <div
            onClick={() => navigate('/finance')}
            className="rounded-2xl border border-card-border bg-card p-5 flex flex-col justify-between hover:border-primary/50 hover:bg-card-muted/50 transition group cursor-pointer shadow-xs"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 mb-3.5 group-hover:scale-105 transition-transform">
                <Layers className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-fg group-hover:text-primary transition-colors flex items-center gap-1.5">
                <span>Treasury & Finance</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-fg-muted group-hover:text-primary transition-colors" />
              </h3>
              <p className="text-xs text-fg-muted mt-1.5 leading-relaxed">
                Manage organization budget pools, replenish gas reserves, and configure department ceilings.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-card-border/60 flex items-center justify-between text-[11px] text-fg-muted">
              <span>{budgetPools.length} Pools Configured</span>
              <span className="text-primary font-medium">View Pools →</span>
            </div>
          </div>

          {/* Action 3: Risk Simulator */}
          <div
            onClick={() => navigate('/simulator')}
            className="rounded-2xl border border-card-border bg-card p-5 flex flex-col justify-between hover:border-primary/50 hover:bg-card-muted/50 transition group cursor-pointer shadow-xs"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 mb-3.5 group-hover:scale-105 transition-transform">
                <Play className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-fg group-hover:text-primary transition-colors flex items-center gap-1.5">
                <span>Rogue Agent Simulator</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-fg-muted group-hover:text-primary transition-colors" />
              </h3>
              <p className="text-xs text-fg-muted mt-1.5 leading-relaxed">
                Simulate adversarial double-spends, sliding-window velocity breaches, and emergency halts.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-card-border/60 flex items-center justify-between text-[11px] text-fg-muted">
              <span>Testbed Active</span>
              <span className="text-primary font-medium">Run Testbench →</span>
            </div>
          </div>

          {/* Action 4: Team & IAM */}
          <div
            onClick={() => navigate(can('canManageAccess') ? '/access' : '/fleet')}
            className="rounded-2xl border border-card-border bg-card p-5 flex flex-col justify-between hover:border-primary/50 hover:bg-card-muted/50 transition group cursor-pointer shadow-xs"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 mb-3.5 group-hover:scale-105 transition-transform">
                <Users className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-fg group-hover:text-primary transition-colors flex items-center gap-1.5">
                <span>Team & Governance</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-fg-muted group-hover:text-primary transition-colors" />
              </h3>
              <p className="text-xs text-fg-muted mt-1.5 leading-relaxed">
                {can('canManageAccess')
                  ? 'Audit operator capabilities, invite team members, and assign role-based permissions.'
                  : `Authenticated as ${roleConfig.label}. View tenant agent credentials and personal policies.`}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-card-border/60 flex items-center justify-between text-[11px] text-fg-muted">
              <span>Role: {roleConfig.label}</span>
              <span className="text-primary font-medium">
                {can('canManageAccess') ? 'Manage Team →' : 'View Fleet →'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Macro Telemetry & Event Feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Spend Velocity & Settlement Analytics */}
        <div className="lg:col-span-2 space-y-6">
          <SpendVelocityChart
            events={events}
            simulatedRecords={simulatedRecords}
            maxVelocityCap={5}
            windowSeconds={3600}
          />
          <SpendAnalyticsPanel title="Settled Spend History" />
        </div>

        {/* Right 1 Col: Monad Radar & Live Activity Feed */}
        <div className="space-y-6">
          {/* Monad Real-Time Settlement Telemetry Radar */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary animate-pulse" />
                <span className="text-xs font-bold text-fg uppercase tracking-wider">
                  Settlement Radar
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Live Node
              </span>
            </div>

            <div className="space-y-3 mt-4">
              <div className="flex items-center justify-between py-2 border-b border-card-border text-xs">
                <span className="text-fg-muted">Settlement Chain</span>
                <span className="font-semibold text-fg">Monad Testnet</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-card-border text-xs">
                <span className="text-fg-muted">Block Height</span>
                <span className="font-mono font-bold text-primary">
                  {currentBlock !== null ? `#${currentBlock.toString()}` : 'Syncing…'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-card-border text-xs">
                <span className="text-fg-muted">Deterministic Finality</span>
                <span className="font-semibold text-emerald-400">~800 ms</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-card-border text-xs">
                <span className="text-fg-muted">State Partitioning</span>
                <span className="font-semibold text-fg">Disjoint Storage Slots</span>
              </div>
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-fg-muted">Kill-Switch Complexity</span>
                <span className="font-mono font-bold text-emerald-400">O(1) Constant</span>
              </div>
            </div>
          </Card>

          {/* Activity Feed */}
          <ActivityFeed limit={15} />
        </div>
      </div>
    </div>
  );
};

export default ExecutiveDashboard;
