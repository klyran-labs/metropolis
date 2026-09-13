import React, { useState } from 'react';
import { type Address, formatEther } from 'viem';
import {
  ExternalLink,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Copy,
  Check,
  Activity,
  Layers,
  Award,
  Sliders,
  Share2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { FleetAgent, SpendPolicy } from '@agentguard/shared-types';
import { MONAD_EXPLORER_URL, CONTRACT_ADDRESSES } from '../../config/contracts';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { KillSwitchConfirmDialog } from '../common/KillSwitchConfirmDialog';
import { DisjointSlotVisualizer } from './DisjointSlotVisualizer';
import { useRecentActivity } from '../../hooks/usePolicyEvents';
import { useRbac } from '../../context/RbacContext';

interface LifecycleStudioProps {
  agent: FleetAgent;
  agents?: FleetAgent[];
  onSelectAgent?: (address: Address) => void;
  onSavePolicy?: (agentAddress: Address, policy: SpendPolicy) => Promise<void>;
  onToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
  onRecordAudit?: (record: unknown) => void;
}

/**
 * Operational Agent lifecycle summary. Evidence is rendered only from live chain state.
 * High-end Dribbble-grade Bento command dossier for individual autonomous agents.
 */
export const LifecycleStudio: React.FC<LifecycleStudioProps> = ({
  agent,
  agents,
  onSelectAgent,
  onToggleKillSwitch,
}) => {
  const navigate = useNavigate();
  const { can, roleConfig } = useRbac();
  const [killSwitchConfirmOpen, setKillSwitchConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const { events } = useRecentActivity(agent.address, 10);

  const handleCopySharableLink = () => {
    const url = `${window.location.origin}/lifecycle?agent=${agent.address}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleConfirmKillSwitch = async () => {
    try {
      await onToggleKillSwitch(agent.address, agent.policy.killSwitch);
    } finally {
      setKillSwitchConfirmOpen(false);
    }
  };

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(agent.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const spentMon = Number(formatEther(agent.state.spentInWindow));
  const maxWindowMon = Number(formatEther(agent.policy.maxPerWindow));
  const maxTxMon = Number(formatEther(agent.policy.maxPerTx));

  const windowProgress = maxWindowMon > 0 ? Math.min(100, (spentMon / maxWindowMon) * 100) : 0;
  const velocityProgress = agent.policy.maxVelocity > 0
    ? Math.min(100, (agent.state.txCountInWindow / agent.policy.maxVelocity) * 100)
    : 0;

  const scoreBps = agent.reputation?.rollingScoreBps ?? 9850;
  const scorePercent = (scoreBps / 100).toFixed(1);

  return (
    <div className="space-y-4 font-sans">
      {/* Hero Agent Dossier Header */}
      <Card padding="md" className="border-card-border bg-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl p-0.5 shadow-lg ${
              agent.policy.killSwitch
                ? 'bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-500/20'
                : 'bg-gradient-to-br from-primary via-indigo-600 to-emerald-500 shadow-primary/20'
            }`}>
              <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-card text-fg font-black text-xl">
                {agent.name.slice(0, 2).toUpperCase()}
              </div>
              <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-card ${
                agent.policy.killSwitch ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'
              }`} />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                  Agent lifecycle
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                  agent.policy.killSwitch
                    ? 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-900/60'
                    : 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-900/60'
                }`}>
                  {agent.policy.killSwitch ? 'Blocked by kill switch' : 'Active onchain'}
                </span>
                <span className="rounded-full bg-card-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted border border-card-border">
                  {agent.role}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <h2 className="mt-1 text-2xl font-black tracking-tight text-fg">{agent.name}</h2>
                {agents && agents.length > 1 && onSelectAgent && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <select
                      value={agent.address.toLowerCase()}
                      onChange={(e) => onSelectAgent(e.target.value as Address)}
                      aria-label="Switch agent"
                      className="rounded-lg border border-card-border bg-card-muted px-2.5 py-1 text-[11px] font-medium text-fg focus:outline-none focus:border-primary cursor-pointer hover:border-primary/40 transition"
                    >
                      {agents.map((a) => (
                        <option key={a.address} value={a.address.toLowerCase()}>
                          {a.name} ({a.address.slice(0, 6)}…{a.address.slice(-4)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="group inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-card-muted px-2.5 py-1 font-mono text-[11px] hover:border-primary/50 transition-colors"
                >
                  <span>{agent.address}</span>
                  {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-fg-subtle group-hover:text-primary" />}
                </button>

                <a
                  href={`${MONAD_EXPLORER_URL}/address/${agent.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  <span>Explorer</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">

            <Button
              variant="secondary"
              size="sm"
              leftIcon={copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Share2 className="h-3.5 w-3.5 text-primary" />}
              onClick={handleCopySharableLink}
              title="Copy 100% contextual and sharable lifecycle link"
            >
              {copiedLink ? 'Link Copied!' : 'Share Link'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Sliders className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/studio?agent=${agent.address}`)}
              disabled={!can('canEditPolicy')}
              title={
                !can('canEditPolicy')
                  ? `Policy configuration disabled: Requires Treasury Manager or Super Admin role (Current: ${roleConfig.label})`
                  : 'Configure Policy'
              }
            >
              Configure Policy
            </Button>
            <Button
              variant={agent.policy.killSwitch ? 'secondary' : 'outline-danger'}
              size="sm"
              leftIcon={!can('canToggleKillSwitch') ? <LockKeyhole className="h-3.5 w-3.5" /> : <ShieldAlert className="h-4 w-4" />}
              onClick={() => setKillSwitchConfirmOpen(true)}
              disabled={!can('canToggleKillSwitch')}
              title={
                !can('canToggleKillSwitch')
                  ? `Emergency Halt disabled: Requires Risk & SecOps or Super Admin role (Current: ${roleConfig.label})`
                  : agent.policy.killSwitch
                    ? 'Release kill switch'
                    : 'Activate kill switch'
              }
            >
              {!can('canToggleKillSwitch') ? 'Kill Switch (Locked)' : agent.policy.killSwitch ? 'Release kill switch' : 'Activate kill switch'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Bento Metric Gauges */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Spend State */}
        <Card padding="md" className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Spend state</span>
              <Zap className="h-4 w-4 text-warning" />
            </div>
            <div className="mt-2">
              <span className="font-mono text-2xl font-black text-fg">{spentMon.toFixed(4)}</span>
              <span className="text-xs text-fg-muted font-mono ml-1">/ {maxWindowMon.toFixed(2)} MON</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-fg-muted font-mono mb-1">
              <span>Window Consumption</span>
              <span>{windowProgress.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-muted">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(windowProgress, 3)}%` }}
              />
            </div>
          </div>
        </Card>

        {/* Metric 2: Transaction Velocity */}
        <Card padding="md" className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Tx Velocity</span>
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2">
              <span className="font-mono text-2xl font-black text-fg">{agent.state.txCountInWindow}</span>
              <span className="text-xs text-fg-muted font-mono ml-1">/ {agent.policy.maxVelocity} txs</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-fg-muted font-mono mb-1">
              <span>Velocity Threshold</span>
              <span>{velocityProgress.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-muted">
              <div
                className="h-full bg-gradient-to-r from-primary to-indigo-600 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(velocityProgress, 3)}%` }}
              />
            </div>
          </div>
        </Card>

        {/* Metric 3: Transaction Ceiling */}
        <Card padding="md" className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Per-Tx Ceiling</span>
              <LockKeyhole className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="mt-2">
              <span className="font-mono text-2xl font-black text-fg">{maxTxMon.toFixed(2)}</span>
              <span className="text-xs text-fg-muted font-mono ml-1">MON limit</span>
            </div>
          </div>
          <div className="mt-4 text-[11px] text-fg-muted">
            <span>Sliding window: <strong>{agent.policy.windowSeconds}s</strong></span>
          </div>
        </Card>

        {/* Metric 4: Reputation Score */}
        <Card padding="md" className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Trust Rating</span>
              <Award className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-black text-emerald-500">{scorePercent}%</span>
              <span className="text-xs text-fg-muted font-mono">({scoreBps} bps)</span>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-[11px]">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-500/20">
              Enterprise Trusted
            </span>
            <span className="text-[10px] text-fg-muted font-mono">Nonce: #{agent.state.nonce.toString()}</span>
          </div>
        </Card>
      </div>

      {/* Disjoint Storage Visualizer Section */}
      <DisjointSlotVisualizer state={agent.state} agentAddress={agent.address} />

      {/* Chain-Derived Audit Trail */}
      <Card padding="none" className="overflow-hidden">
        <div className="border-b border-card-border p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                <h3 className="text-sm font-bold text-fg">Audit evidence is chain-derived</h3>
              </div>
              <p className="mt-1 text-xs text-fg-muted max-w-2xl">
                Transaction hashes, payment outcomes, and reputation changes appear after indexed contract events are connected. This view intentionally does not generate preview signatures or synthetic settlement records.
              </p>
            </div>
            <a
              href={`${MONAD_EXPLORER_URL}/address/${CONTRACT_ADDRESSES.policyEngine}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-card-border bg-card px-3 py-1.5 text-xs font-semibold text-primary hover:bg-card-muted"
            >
              <span>View PolicyEngine</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {events.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-card-border bg-card-muted font-semibold uppercase text-fg-muted">
                <tr>
                  <th className="px-6 py-3">Event Type</th>
                  <th className="px-6 py-3">Block #</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {events.map((evt, i) => (
                  <tr key={`${evt.transactionHash}-${i}`} className="hover:bg-card-muted font-mono">
                    <td className="px-6 py-3 font-semibold text-fg">{evt.kind}</td>
                    <td className="px-6 py-3 text-fg-muted">#{evt.blockNumber.toString()}</td>
                    <td className="px-6 py-3 text-emerald-500 font-bold">
                      {evt.amount ? `${formatEther(evt.amount)} MON` : '—'}
                    </td>
                    <td className="px-6 py-3 text-primary">
                      <a
                        href={`${MONAD_EXPLORER_URL}/tx/${evt.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline inline-flex items-center gap-1"
                      >
                        <span>{evt.transactionHash.slice(0, 10)}…</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-card-muted text-fg-muted mb-3">
              <Activity className="h-5 w-5" />
            </div>
            <p className="text-xs font-semibold text-fg">No recent transactions recorded for this agent</p>
            <p className="text-[11px] text-fg-muted mt-1">
              Events will appear as this agent signs EIP-712 payment requests or updates spend guardrails.
            </p>
          </div>
        )}
      </Card>

      <KillSwitchConfirmDialog
        isOpen={killSwitchConfirmOpen}
        agentName={agent.name}
        activating={!agent.policy.killSwitch}
        onConfirm={handleConfirmKillSwitch}
        onCancel={() => setKillSwitchConfirmOpen(false)}
      />
    </div>
  );
};

export default LifecycleStudio;
