import React, { useMemo, useState } from 'react';
import { type Address, formatEther } from 'viem';
import { Activity, BarChart3, RefreshCw, ShieldAlert } from 'lucide-react';
import { useRecentActivity } from '../../hooks/usePolicyEvents';
import { Card } from '../common/Card';
import { Button } from '../common/Button';

interface SpendAnalyticsPanelProps {
  /** Scope to one agent's SpendRecorded history, or omit for the fleet-wide feed. */
  agent?: Address | null;
  title?: string;
}

interface DayBucket {
  dateKey: string;
  label: string;
  totalWei: bigint;
}

const MAX_DOTS_PER_COLUMN = 14;
const MAX_COLUMNS = 24;

function bucketByDay(events: { amount?: bigint; timestamp: bigint | null }[]): DayBucket[] {
  const byDay = new Map<string, bigint>();
  for (const event of events) {
    if (event.timestamp === null || event.amount === undefined) continue;
    const date = new Date(Number(event.timestamp) * 1000);
    const dateKey = date.toISOString().slice(0, 10);
    byDay.set(dateKey, (byDay.get(dateKey) ?? 0n) + event.amount);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-MAX_COLUMNS)
    .map(([dateKey, totalWei]) => ({
      dateKey,
      label: new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      totalWei,
    }));
}

/**
 * Real spend-over-time visualization sourced from PolicyEngine's
 * SpendRecorded events — no fabricated history, no projected/forecast line.
 * Shows a genuine empty state until real spend activity has actually been
 * recorded onchain, which is the truthful state of a freshly deployed
 * (or not-yet-deployed) PolicyEngine today.
 */
export const SpendAnalyticsPanel: React.FC<SpendAnalyticsPanelProps> = ({ agent, title = 'Spend Analytics' }) => {
  const { events, loading, error, refresh } = useRecentActivity(agent ?? undefined, 500);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);

  const spendEvents = useMemo(() => events.filter((e) => e.kind === 'SPEND_RECORDED'), [events]);
  const deniedCount = useMemo(() => events.filter((e) => e.kind === 'SPEND_EVALUATED' && e.allowed === false).length, [events]);
  const evaluatedCount = useMemo(() => events.filter((e) => e.kind === 'SPEND_EVALUATED').length, [events]);
  const buckets = useMemo(() => bucketByDay(spendEvents), [spendEvents]);

  const maxWei = buckets.reduce((max, b) => (b.totalWei > max ? b.totalWei : max), 1n);
  const hovered = buckets.find((b) => b.dateKey === hoveredDay) ?? buckets[buckets.length - 1] ?? null;

  const denyRate = evaluatedCount > 0 ? Math.round((deniedCount / evaluatedCount) * 100) : null;

  return (
    <Card padding="md">
      <div className="flex flex-col gap-3 border-b border-card-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-subtle text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-fg">{title}</h2>
            <p className="text-[11px] text-fg-muted">Real `SpendRecorded` events read from PolicyEngine on Monad</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger-subtle p-3 text-xs text-danger">{error}</p>
      )}

      {!error && buckets.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-card-border p-10 text-center">
          <Activity className="mx-auto h-8 w-8 text-fg-subtle" />
          <p className="mt-3 text-sm font-semibold text-fg">No settled spend events yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-fg-muted">
            {loading
              ? 'Reading PolicyEngine event history from Monad…'
              : 'This chart populates from real `SpendRecorded` events once an agent executes a policy-gated payment through evaluateAndSpend. Nothing is simulated here.'}
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex items-end gap-[3px] overflow-x-auto pb-2" style={{ minHeight: `${MAX_DOTS_PER_COLUMN * 10 + 20}px` }}>
            {buckets.map((bucket) => {
              const ratio = Number(bucket.totalWei) / Number(maxWei);
              const dotCount = Math.max(1, Math.round(ratio * MAX_DOTS_PER_COLUMN));
              const isHovered = hovered?.dateKey === bucket.dateKey;
              return (
                <div
                  key={bucket.dateKey}
                  className="flex shrink-0 flex-col items-center gap-1 cursor-pointer"
                  onMouseEnter={() => setHoveredDay(bucket.dateKey)}
                  onMouseLeave={() => setHoveredDay(null)}
                >
                  <div className="flex flex-col-reverse gap-[3px]">
                    {Array.from({ length: dotCount }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full transition-colors ${isHovered ? 'bg-primary' : 'bg-primary/40'}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-[3px] overflow-x-auto text-[9px] text-fg-subtle">
            {buckets.map((bucket, i) => (
              <span key={bucket.dateKey} className="w-2 shrink-0 -rotate-45 origin-top-left whitespace-nowrap" style={{ marginLeft: i === 0 ? 0 : undefined }}>
                {i % Math.max(1, Math.ceil(buckets.length / 8)) === 0 ? bucket.label : ''}
              </span>
            ))}
          </div>

          {hovered && (
            <p className="mt-4 text-xs text-fg-muted">
              <span className="font-mono font-bold text-fg">{formatEther(hovered.totalWei)} MON</span> settled on {hovered.label}
            </p>
          )}
        </div>
      )}

      {denyRate !== null && (
        <div className={`mt-5 flex items-start gap-3 rounded-xl border p-3.5 text-xs ${denyRate >= 25 ? 'border-warning/30 bg-warning-subtle' : 'border-card-border bg-card-muted'}`}>
          <ShieldAlert className={`h-4 w-4 shrink-0 ${denyRate >= 25 ? 'text-warning' : 'text-fg-muted'}`} />
          <div>
            <p className="font-semibold text-fg">Risk signal (computed, not predicted)</p>
            <p className="mt-0.5 text-fg-muted">
              {deniedCount} of {evaluatedCount} evaluated requests were denied ({denyRate}%) in the events read above
              {denyRate >= 25 ? ' — high enough to warrant reviewing this policy\'s limits or the calling agent\'s behavior.' : '.'}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};
