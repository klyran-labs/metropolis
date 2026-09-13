import React from 'react';
import { type Address, formatEther } from 'viem';
import { CheckCircle2, ExternalLink, Lock, Unlock, Sliders, XCircle, Clock, Radio } from 'lucide-react';
import { useRecentActivity, type ActivityEvent } from '../../hooks/usePolicyEvents';
import { MONAD_EXPLORER_URL } from '../../config/contracts';

interface ActivityFeedProps {
  agent?: Address | null;
  limit?: number;
  emptyMessage?: string;
}

function relativeTime(timestamp: bigint | null): string {
  if (timestamp === null) return 'pending block timestamp';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function describe(event: ActivityEvent): { icon: React.ReactNode; title: string; detail: string; tone: 'success' | 'danger' | 'info' | 'neutral' } {
  const shortAgent = event.agent ? `${event.agent.slice(0, 6)}…${event.agent.slice(-4)}` : 'System';
  switch (event.kind) {
    case 'POLICY_SET':
      return { icon: <Sliders className="h-3.5 w-3.5" />, title: 'Policy updated', detail: `Spend policy committed for ${shortAgent}`, tone: 'info' };
    case 'KILL_SWITCH':
      return event.active
        ? { icon: <Lock className="h-3.5 w-3.5" />, title: 'Emergency stop activated', detail: `${shortAgent} halted — spend evaluation immediately cut off`, tone: 'danger' }
        : { icon: <Unlock className="h-3.5 w-3.5" />, title: 'Emergency stop released', detail: `${shortAgent} restored to active evaluation`, tone: 'success' };
    case 'SPEND_EVALUATED':
      if (event.allowed) {
        return {
          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
          title: 'Spend allowed',
          detail: `${shortAgent} → ${event.merchant?.slice(0, 6)}…${event.merchant?.slice(-4)}${event.amount !== undefined ? ` for ${formatEther(event.amount)} MON` : ''}`,
          tone: 'success',
        };
      }
      return {
        icon: <XCircle className="h-3.5 w-3.5" />,
        title: 'Spend denied',
        detail: `${shortAgent}: ${event.reasonMessage ?? 'policy denied'}`,
        tone: 'danger',
      };
    case 'SPEND_RECORDED':
      return { icon: <CheckCircle2 className="h-3.5 w-3.5" />, title: 'Spend settled', detail: `${shortAgent} settled ${event.amount !== undefined ? formatEther(event.amount) : '0'} MON`, tone: 'success' };
    case 'BUDGET_POOL_CREATED':
      return { icon: <Sliders className="h-3.5 w-3.5" />, title: 'Budget Pool created', detail: `Shared pool created with ${event.amount !== undefined ? formatEther(event.amount) : '0'} MON cap`, tone: 'info' };
    case 'AGENT_ASSIGNED_TO_POOL':
      return { icon: <Sliders className="h-3.5 w-3.5" />, title: 'Agent pooled', detail: `${shortAgent} assigned to shared team budget pool`, tone: 'info' };
    case 'BUDGET_POOL_SPENT':
      return { icon: <CheckCircle2 className="h-3.5 w-3.5" />, title: 'Pool spend allocated', detail: `${event.amount !== undefined ? formatEther(event.amount) : '0'} MON drawn from pool`, tone: 'info' };
    default:
      return { icon: <Clock className="h-3.5 w-3.5" />, title: 'Policy event', detail: shortAgent, tone: 'neutral' };
  }
}

const TONE_CLASSES: Record<'success' | 'danger' | 'info' | 'neutral', string> = {
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-primary-subtle text-primary',
  neutral: 'bg-card-muted text-fg-muted',
};

/**
 * Real activity decoded from PolicyEngine event logs — replaces both the
 * notification drawer's previously-static "Policy Initialized" placeholder
 * and the dashboard's dead auditRecords state. Every row here corresponds to
 * an actual onchain event; there is no synthetic activity generator.
 */
export const ActivityFeed: React.FC<ActivityFeedProps> = ({ agent, limit = 25, emptyMessage }) => {
  const { events, loading, error } = useRecentActivity(agent ?? undefined, limit);

  if (error) {
    return <p role="alert" className="rounded-xl bg-danger-subtle p-3 text-xs text-danger">{error}</p>;
  }

  if (events.length === 0) {
    return (
      <div className="py-6 px-4 text-center">
        <div className="relative mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-xs">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-2xl bg-emerald-400/20 opacity-75" />
          <Radio className="relative h-4 w-4 animate-pulse" />
        </div>
        <h4 className="mt-3 text-xs font-bold text-fg">
          {loading ? 'Connecting to Monad Stream…' : 'Live Policy Event Bus Active'}
        </h4>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted max-w-xs mx-auto">
          {loading
            ? 'Querying onchain event logs from the Monad Parallel EVM settlement contracts…'
            : emptyMessage ?? 'Listening for live transactions on Monad (Chain 10143). Spend evaluations and emergency stop triggers will stream here in real time.'}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 pt-1 border-t border-card-border/60">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 font-mono border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            RPC Connected
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-card-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted font-mono">
            Real-Time Cadence
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((event) => {
        const { icon, title, detail, tone } = describe(event);
        return (
          <div key={event.id} className="flex items-start gap-3 rounded-xl border border-card-border bg-card p-3">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}>{icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-fg">{title}</p>
                <span className="shrink-0 text-[10px] text-fg-subtle">{relativeTime(event.timestamp)}</span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-fg-muted" title={detail}>{detail}</p>
              <a
                href={`${MONAD_EXPLORER_URL}/tx/${event.transactionHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
              >
                <span>{event.transactionHash.slice(0, 10)}…</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
};
