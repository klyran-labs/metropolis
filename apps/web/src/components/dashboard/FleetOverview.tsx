import React, { useState, useMemo, useEffect } from 'react';
import { type Address, formatEther } from 'viem';
import {
  MoreVertical,
  Search,
  Lock,
  Unlock,
  Shield,
  ShieldAlert,
  ArrowUpRight,
  Sliders,
  Check,
  Cpu,
  Globe,
  ArrowLeftRight,
  Boxes,
  Coins,
  AlertTriangle,
  RotateCcw,
  Clock,
  Activity,
  CheckCircle2,
  Zap,
} from 'lucide-react';
import { type FleetAgent } from '@agentguard/shared-types';
import { KillSwitchConfirmDialog } from '../common/KillSwitchConfirmDialog';
import { FundAgentModal } from './FundAgentModal';
import { Pagination } from '../common/Pagination';
import { useRbac } from '../../context/RbacContext';
import { useDashboard } from '../../context/DashboardContext';

interface FleetOverviewProps {
  agents: FleetAgent[];
  onToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
  onSelectAgent: (agent: FleetAgent) => void;
  selectedAgentAddress?: Address | null;
  onOpenOnboarding?: () => void;
  onRunLifecycle?: (agent: FleetAgent) => void;
  onBatchProvision?: (count: number) => Promise<void>;
}

// Autonomous Fleet & Cryptographic Shield Vector Illustration (AgentGuard style)
const FleetSecurityIllustration: React.FC = () => (
  <svg className="w-36 h-28 mx-auto" viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Theme-adaptive backdrop bubble */}
    <path
      d="M40 70 C30 40, 60 15, 95 20 C130 25, 140 60, 125 85 C110 110, 50 100, 40 70 Z"
      className="fill-primary/10 dark:fill-primary/20"
    />
    {/* Sparkles / motion nodes */}
    <path d="M30 35 L24 32" stroke="currentColor" className="text-primary" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M40 22 L36 16" stroke="currentColor" className="text-primary" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M120 18 L124 12" stroke="currentColor" className="text-primary" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M135 30 L142 27" stroke="currentColor" className="text-primary" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="28" cy="24" r="1.5" className="fill-primary" />
    <circle cx="132" cy="22" r="1.5" className="fill-primary" />

    {/* Central Shield Outline */}
    <path
      d="M80 32 L105 42 V65 C105 82 94 96 80 102 C66 96 55 82 55 65 V42 L80 32 Z"
      className="stroke-primary dark:stroke-white"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* Inner Agent Circuit Key / Monad Parallel EVM lines */}
    <path d="M80 44 V74" stroke="currentColor" className="text-primary" strokeWidth="2" strokeLinecap="round" />
    <circle cx="80" cy="50" r="3" className="fill-primary" />
    <path d="M70 60 L80 67 L90 60" stroke="currentColor" className="text-primary" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

    {/* Satellite Agent Nodes */}
    <circle cx="48" cy="75" r="4" className="fill-card stroke-primary dark:stroke-white" strokeWidth="1.5" />
    <path d="M52 75 L62 72" stroke="currentColor" className="text-fg-muted" strokeWidth="1" strokeDasharray="2 2" />

    <circle cx="112" cy="75" r="4" className="fill-card stroke-primary dark:stroke-white" strokeWidth="1.5" />
    <path d="M108 75 L98 72" stroke="currentColor" className="text-fg-muted" strokeWidth="1" strokeDasharray="2 2" />
  </svg>
);

export const FleetOverview: React.FC<FleetOverviewProps> = ({
  agents,
  onToggleKillSwitch,
  onSelectAgent,
  selectedAgentAddress,
  onOpenOnboarding,
  onRunLifecycle,
  onBatchProvision,
}) => {
  const { can, roleConfig } = useRbac();
  const { fleetScope, setFleetScope, myAgentsCount, totalNetworkAgentsCount, balanceMon, handleFundAgent } = useDashboard();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [haltInput, setHaltInput] = useState('');
  const [togglingAddress, setTogglingAddress] = useState<Address | null>(null);
  const [pendingKillSwitchAgent, setPendingKillSwitchAgent] = useState<FleetAgent | null>(null);
  const [fundingAgent, setFundingAgent] = useState<FleetAgent | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Reset pagination when searching
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Block/Halt list derived from real onchain agents with active killSwitch
  const blockedAgents = useMemo(() => {
    return agents.filter((a) => a.policy.killSwitch);
  }, [agents]);

  // Dynamic telemetry metrics
  const activeCount = agents.length - blockedAgents.length;
  const activePercent = agents.length > 0 ? Math.round((activeCount / agents.length) * 100) : 100;
  const haltedPercent = 100 - activePercent;

  // Filtered agents for table
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

  // Paginated agents for current table page
  const paginatedAgents = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAgents.slice(start, start + pageSize);
  }, [filteredAgents, currentPage, pageSize]);

  const handleConfirmKillSwitch = async () => {
    if (!pendingKillSwitchAgent) return;
    const agent = pendingKillSwitchAgent;
    try {
      setTogglingAddress(agent.address);
      await onToggleKillSwitch(agent.address, agent.policy.killSwitch);
      setPendingKillSwitchAgent(null);
    } finally {
      setTogglingAddress(null);
    }
  };

  const handleHaltFromInput = async () => {
    const trimmed = haltInput.trim();
    if (!trimmed.startsWith('0x') || trimmed.length !== 42) return;
    await onToggleKillSwitch(trimmed as Address, false);
    setHaltInput('');
  };

  const toggleRowSelect = (id: string) => {
    const next = new Set(selectedRowIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedRowIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedRowIds.size === filteredAgents.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(filteredAgents.map((a) => a.address)));
    }
  };

  // Operational workload channels
  const FLEET_WORKLOADS = [
    { label: 'Inference Compute', icon: Cpu, limit: '5.0 MON', status: 'Active', up: true },
    { label: 'Data Scraping', icon: Globe, limit: '2.5 MON', status: 'Normal', up: true },
    { label: 'x402 Protocol Settlement', icon: ArrowLeftRight, limit: '10.0 MON', status: 'Sub-ms', up: true },
    { label: 'Swarm Orchestration', icon: Boxes, limit: '1.0 MON', status: 'Guarded', up: true },
    { label: 'Treasury Balancing', icon: Coins, limit: '6.5 MON', status: 'Enforced', up: true },
  ] as const;

  return (
    <div className="space-y-4 font-sans">
      {/* Executive Command Grid (Streamlined for immediate operational focus) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Card 1: Executive Command Summary (8 cols) */}
        <div className="xl:col-span-8 rounded-2xl border border-card-border bg-card p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 relative overflow-hidden shadow-xs">
          <div className="flex items-start gap-4 z-10">
            <div className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/25 text-primary flex items-center justify-center shrink-0 shadow-inner">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-fg tracking-tight">
                  Autonomous Fleet Command & Spend Control
                </h2>
                <span className="rounded-full bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 border border-primary/20 font-mono">
                  Live
                </span>
              </div>
              <p className="text-xs text-fg-muted mt-1 max-w-xl leading-relaxed">
                Real-time per-transaction spend caps, velocity limits, and instant emergency halts enforced on Monad.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-fg-subtle font-mono">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <strong className="text-fg">{agents.length} Guarded Agents</strong>
                </span>
                <span>·</span>
                <span>Sub-Second Settlement</span>
                <span>·</span>
                <span>Isolated State Partitions</span>
              </div>
            </div>
          </div>

          {/* Action CTA Button */}
          <div className="shrink-0 z-10 w-full sm:w-auto">
            <button
              type="button"
              onClick={onOpenOnboarding}
              disabled={!can('canRegisterAgents')}
              title={
                !can('canRegisterAgents')
                  ? `Registration disabled: Requires Fleet DevOps or Super Admin role (Current: ${roleConfig.label})`
                  : 'Register new autonomous agent wallet'
              }
              className={`w-full sm:w-auto rounded-xl px-4 py-2.5 text-xs font-semibold shadow-xs transition flex items-center justify-center gap-2 ${
                can('canRegisterAgents')
                  ? 'bg-primary hover:bg-primary-hover text-white shadow-primary/25 cursor-pointer'
                  : 'bg-card-muted text-fg-muted border border-card-border cursor-not-allowed opacity-80'
              }`}
            >
              {can('canRegisterAgents') ? (
                <Shield className="w-3.5 h-3.5" />
              ) : (
                <Lock className="w-3.5 h-3.5 text-fg-muted" />
              )}
              <span>{can('canRegisterAgents') ? 'Register Agent' : 'Register Agent (Locked)'}</span>
            </button>
          </div>
        </div>

        {/* Card 2: Enforced Fleet Capacity Summary (4 cols) */}
        <div className="xl:col-span-4 rounded-2xl border border-card-border bg-card p-5 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-fg uppercase tracking-wider">Fleet Capacity</span>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-fg-muted font-mono">Live Monad</span>
              </div>
            </div>

            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-black text-fg tracking-tight font-mono">
                25.0 MON
              </span>
              <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-mono">
                100% Guarded
              </span>
            </div>

            {/* Segmented Progress Multi-Bar */}
            <div className="flex h-1.5 w-full overflow-hidden rounded-full gap-1 mt-3">
              <div
                className="bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${activePercent}%` }}
              />
              <div
                className="bg-rose-500 rounded-full transition-all duration-500"
                style={{ width: `${haltedPercent}%` }}
              />
            </div>

            {/* Legend Dots */}
            <div className="flex items-center gap-4 mt-2.5 text-xs text-fg-muted">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[11px]">Active ({activeCount})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-[11px]">Halted ({blockedAgents.length})</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Monitored Agent Wallets Table (8 cols) */}
        <div className="xl:col-span-8 rounded-2xl border border-card-border bg-card overflow-hidden">
          {/* Card Header, Role Switcher & Search Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-3 border-b border-card-border">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-fg tracking-tight">Monitored Agent Wallets</h3>
                  <span className="rounded-full bg-primary-subtle text-primary text-[10px] font-semibold px-2 py-0.5 border border-primary/20 font-mono">
                    {filteredAgents.length} {fleetScope === 'my_agents' ? 'My Agents' : 'Network Agents'}
                  </span>
                </div>
                <p className="text-[11px] text-fg-muted mt-0.5">
                  {fleetScope === 'my_agents'
                    ? 'Isolated tenant scope: Viewing autonomous agent wallets bound to your user address'
                    : 'Global protocol scope: Viewing all onchain registered agents on Monad'}
                </p>
              </div>

              {/* Tenant Scope Selector */}
              <div className="inline-flex rounded-xl bg-card-muted p-0.5 border border-card-border shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setFleetScope('my_agents')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    fleetScope === 'my_agents'
                      ? 'bg-card text-fg shadow-xs border border-card-border'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <Shield className="h-3 w-3 text-emerald-500" />
                  <span>My Agents</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-card-border/60 text-fg-muted">
                    {myAgentsCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setFleetScope('network')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    fleetScope === 'network'
                      ? 'bg-card text-fg shadow-xs border border-card-border'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <Globe className="h-3 w-3 text-primary" />
                  <span>Network Fleet</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-card-border/60 text-fg-muted">
                    {totalNetworkAgentsCount}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search agents..."
                  className="w-full sm:w-52 rounded-lg bg-card-muted border border-card-border pl-8 pr-3 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
                />
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-y border-card-border bg-card-muted text-fg-muted">
                  <th className="py-3 px-6 w-10">
                    <input
                      type="checkbox"
                      checked={selectedRowIds.size > 0 && selectedRowIds.size === filteredAgents.length}
                      onChange={toggleSelectAll}
                      aria-label="Select all agents"
                      className="rounded border-card-border bg-card text-primary focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-4 font-medium">
                    <span className="text-fg font-semibold">Agent Wallet</span>
                  </th>
                  <th className="py-3 px-4 font-medium" title="Policy Limits (Tx / Window)">
                    <span className="text-fg font-semibold">Policy Limits</span>
                    <span className="block text-[10px] text-fg-muted font-normal leading-tight mt-0.5">
                      (Tx / Window)
                    </span>
                  </th>
                  <th className="py-3 px-4 font-medium" title="Velocity (Tx / Limit)">
                    <span className="text-fg font-semibold">Velocity</span>
                    <span className="block text-[10px] text-fg-muted font-normal leading-tight mt-0.5">
                      (Tx / Limit)
                    </span>
                  </th>
                  <th className="py-3 px-4 font-medium">
                    <span className="text-fg font-semibold">Reputation</span>
                  </th>
                  <th className="py-3 px-6 font-medium text-right">
                    <span className="text-fg font-semibold">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {filteredAgents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 px-4 text-center">
                      <div className="max-w-md mx-auto space-y-3">
                        <div className="mx-auto w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                          <Shield className="w-5 h-5" />
                        </div>
                        <h4 className="text-sm font-bold text-fg">
                          {fleetScope === 'my_agents'
                            ? 'No Agents Registered Under Your Account'
                            : 'No Agents Found in Current Roster'}
                        </h4>
                        <p className="text-xs text-fg-muted leading-relaxed">
                          {fleetScope === 'my_agents'
                            ? 'You have not registered any autonomous agents yet. Register your first agent to set spend ceilings, assign budget pools, and enable O(1) instant kill switches.'
                            : 'No agents matched your query in the current network roster.'}
                        </p>
                        {fleetScope === 'my_agents' && can('canRegisterAgents') && onOpenOnboarding && (
                          <button
                            type="button"
                            onClick={onOpenOnboarding}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-xs transition cursor-pointer"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            <span>Register Agent</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedAgents.map((agent) => {
                    const isHalted = agent.policy.killSwitch;
                    const isSelected = selectedAgentAddress?.toLowerCase() === agent.address.toLowerCase();
                    const maxTxFormatted = formatEther(agent.policy.maxPerTx);
                    const maxWindowFormatted = formatEther(agent.policy.maxPerWindow);
                    const repScore = agent.reputation?.rollingScoreBps
                      ? `${(agent.reputation.rollingScoreBps / 100).toFixed(0)}%`
                      : '98%';

                    return (
                      <tr
                        key={agent.address}
                        onClick={() => onSelectAgent(agent)}
                        className={`hover:bg-card-muted/70 transition group cursor-pointer ${
                          isSelected ? 'bg-card-muted' : ''
                        }`}
                      >
                        <td className="py-3.5 px-6" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedRowIds.has(agent.address)}
                            onChange={() => toggleRowSelect(agent.address)}
                            aria-label={`Select agent ${agent.name}`}
                            className="rounded border-card-border bg-card text-primary focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={`h-7 w-7 rounded-lg flex items-center justify-center text-[10px] font-bold uppercase shrink-0 ${
                                isHalted
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/40'
                                  : 'bg-primary-subtle text-primary border border-primary/30'
                              }`}
                            >
                              {agent.name.slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-semibold text-fg group-hover:text-primary transition flex items-center gap-1.5 flex-wrap">
                                <span>{agent.name}</span>
                                {isHalted && (
                                  <span className="text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200 dark:text-rose-400 dark:bg-rose-950/60 dark:border-rose-800/40 px-1.5 py-0.5 rounded font-mono">
                                    HALTED
                                  </span>
                                )}
                                <span className="text-[9px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 dark:text-sky-300 dark:bg-sky-950/50 dark:border-sky-800/40 px-1.5 py-0.5 rounded font-mono">
                                  {agent.signerType || 'EOA'}
                                </span>
                                {agent.securityTier === 'TEE_ENCLAVE' && (
                                  <span className="text-[9px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 dark:text-purple-300 dark:bg-purple-950/50 dark:border-purple-800/40 px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-0.5">
                                    <Cpu className="w-2.5 h-2.5" /> TEE
                                  </span>
                                )}
                                {agent.gasMode === 'PAYMASTER_SPONSORED' && (
                                  <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-800/40 px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-0.5">
                                    <Zap className="w-2.5 h-2.5" /> Gasless (7677)
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-fg-muted font-mono">
                                {agent.address.slice(0, 8)}...{agent.address.slice(-6)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-mono text-[11px] text-fg">
                            {maxTxFormatted} / {maxWindowFormatted} MON
                          </div>
                          <div className="text-[10px] text-fg-muted flex items-center gap-1 mt-0.5">
                            <Clock className="h-2.5 w-2.5 text-fg-subtle" />
                            <span>{agent.policy.windowSeconds}s window</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[11px] text-fg-muted">
                          {agent.state.txCountInWindow} / {agent.policy.maxVelocity} tx
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/40 font-mono text-[10px] font-medium">
                              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
                              {repScore}
                            </span>
                            <span className="text-[10px] text-fg-muted">Tier 1</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {/* Fund Agent Action */}
                            <button
                              type="button"
                              onClick={() => setFundingAgent(agent)}
                              title="Fund agent with native MON"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-card-border hover:border-primary/50 text-[11px] font-medium text-fg-muted hover:text-fg transition shadow-2xs cursor-pointer"
                            >
                              <Coins className="h-3.5 w-3.5 text-amber-500" />
                              <span>Fund</span>
                            </button>

                            {/* Lifecycle Navigation */}
                            {onRunLifecycle && (
                              <button
                                type="button"
                                onClick={() => onRunLifecycle(agent)}
                                title="Inspect agent lifecycle & state machine"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-card-border hover:border-primary/50 text-[11px] font-medium text-fg-muted hover:text-fg transition shadow-2xs cursor-pointer"
                              >
                                <Activity className="h-3.5 w-3.5 text-primary" />
                                <span>Lifecycle</span>
                              </button>
                            )}

                            {/* Kill Switch / Restore Action Button */}
                            <button
                              type="button"
                              disabled={!can('canToggleKillSwitch')}
                              onClick={() => {
                                if (isHalted) {
                                  onToggleKillSwitch(agent.address, true);
                                } else {
                                  setPendingKillSwitchAgent(agent);
                                }
                              }}
                              title={
                                !can('canToggleKillSwitch')
                                  ? `Emergency Halt disabled: Requires Risk & SecOps or Super Admin role (Current: ${roleConfig.label})`
                                  : isHalted
                                    ? 'Restore agent payment authority'
                                    : 'Suspend agent payments (Emergency Stop)'
                              }
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition shadow-2xs border ${
                                !can('canToggleKillSwitch')
                                  ? 'bg-card-muted text-fg-subtle border-card-border cursor-not-allowed opacity-60'
                                  : isHalted
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-500/30 dark:hover:bg-emerald-950/50 cursor-pointer'
                                    : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 dark:bg-rose-950/25 dark:text-rose-400 dark:border-rose-500/30 dark:hover:bg-rose-950/50 cursor-pointer'
                              }`}
                            >
                              {!can('canToggleKillSwitch') ? (
                                <>
                                  <Lock className="h-3.5 w-3.5 text-fg-subtle" />
                                  <span>{isHalted ? 'Restore (Locked)' : 'Kill Switch (Locked)'}</span>
                                </>
                              ) : isHalted ? (
                                <>
                                  <RotateCcw className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span>Restore</span>
                                </>
                              ) : (
                                <>
                                  <ShieldAlert className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                                  <span>Kill Switch</span>
                                </>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Pagination Controls */}
          <Pagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={filteredAgents.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        </div>

        {/* Card 4: Emergency Kill Switch & Revocation List (4 cols) */}
        <div className="xl:col-span-4 rounded-2xl border border-card-border bg-card p-4 flex flex-col justify-between min-h-[300px]">
          <div>
            {/* Title */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                <h3 className="text-sm font-bold text-fg tracking-tight">Emergency Kill Switch List</h3>
              </div>
              {!can('canToggleKillSwitch') && (
                <span className="flex items-center gap-1 text-[10px] font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 dark:text-amber-400 dark:bg-amber-950/50 dark:border-amber-800/40">
                  <Lock className="h-2.5 w-2.5" />
                  <span>SecOps Only</span>
                </span>
              )}
            </div>

            {/* Description */}
            <p className="text-xs text-fg-muted mt-2 leading-relaxed font-normal">
              Agents currently suspended. All outgoing payments and transaction requests are blocked immediately.
            </p>

            {/* Input Group: Halt agent address + Halt */}
            <div className="mt-4 flex items-center">
              <input
                type="text"
                value={haltInput}
                disabled={!can('canToggleKillSwitch')}
                onChange={(e) => setHaltInput(e.target.value)}
                placeholder={can('canToggleKillSwitch') ? "Enter agent address (0x...)" : "Emergency stop disabled for this role"}
                className="bg-card-muted border border-card-border rounded-l-lg text-xs text-fg px-3 py-2 placeholder:text-fg-subtle flex-1 focus:outline-none focus:border-rose-500 font-mono transition disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleHaltFromInput}
                disabled={!can('canToggleKillSwitch') || !haltInput.startsWith('0x') || haltInput.length !== 42}
                title={!can('canToggleKillSwitch') ? `Requires Risk & SecOps or Super Admin role (Current: ${roleConfig.label})` : 'Suspend agent'}
                className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-r-lg transition cursor-pointer shrink-0 disabled:cursor-not-allowed"
              >
                Suspend
              </button>
            </div>
          </div>

          {/* Active Blocked List */}
          <div className="mt-4 pt-3 border-t border-card-border space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-fg-muted uppercase tracking-wider">
              <span>Suspended Agents ({blockedAgents.length})</span>
              <span className="text-[10px] text-rose-500 font-mono">Status: Suspended (Code 1)</span>
            </div>
            {blockedAgents.length === 0 ? (
              <div className="text-xs text-fg-subtle italic py-3 text-center">
                No agents currently suspended. All fleet policies active.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {blockedAgents.map((agent) => (
                  <div
                    key={agent.address}
                    className="flex items-center justify-between p-2 rounded-lg bg-card-muted border border-card-border text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-6 w-6 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800/40 flex items-center justify-center text-[10px] font-bold shrink-0">
                        {agent.name.slice(0, 2)}
                      </div>
                      <div className="truncate">
                        <div className="font-semibold text-fg truncate">{agent.name}</div>
                        <div className="text-[10px] text-fg-muted font-mono truncate">
                          {agent.address.slice(0, 10)}...
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!can('canToggleKillSwitch')}
                      onClick={() => onToggleKillSwitch(agent.address, true)}
                      title={!can('canToggleKillSwitch') ? `Requires Risk & SecOps or Super Admin (Current: ${roleConfig.label})` : 'Restore agent'}
                      className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 ml-2 shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Kill Switch Emergency Halt */}
      {pendingKillSwitchAgent && (
        <KillSwitchConfirmDialog
          isOpen={!!pendingKillSwitchAgent}
          agentName={pendingKillSwitchAgent.name}
          activating={!pendingKillSwitchAgent.policy.killSwitch}
          onConfirm={handleConfirmKillSwitch}
          onCancel={() => setPendingKillSwitchAgent(null)}
        />
      )}

      {/* Fund Agent Modal */}
      {fundingAgent && (
        <FundAgentModal
          isOpen={!!fundingAgent}
          agent={fundingAgent}
          connectedBalanceMon={balanceMon}
          onClose={() => setFundingAgent(null)}
          onFundAgent={handleFundAgent}
        />
      )}
    </div>
  );
};

export default FleetOverview;
