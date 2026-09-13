import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Address, formatEther } from 'viem';
import { Zap, AlertTriangle, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { Card } from '../common/Card';
import { type ActivityEvent } from '../../hooks/usePolicyEvents';
import { type SimulatedAuditRecord } from '../../context/DashboardContext';

interface SpendVelocityChartProps {
  events: ActivityEvent[];
  simulatedRecords?: SimulatedAuditRecord[];
  maxVelocityCap?: number;
  windowSeconds?: number;
  agentAddress?: Address | null;
}

type TimeframeOption = '15m' | '1h' | '24h';

interface TimeSeriesPoint {
  timestamp: number; // Unix seconds
  timeLabel: string;
  txCount: number;
  totalWei: bigint;
  isBreach: boolean;
  isSimulated?: boolean;
}

export const SpendVelocityChart: React.FC<SpendVelocityChartProps> = ({
  events,
  simulatedRecords = [],
  maxVelocityCap = 5,
  windowSeconds = 3600,
  agentAddress,
}) => {
  const navigate = useNavigate();
  const [timeframe, setTimeframe] = useState<TimeframeOption>('1h');
  const [hoveredPoint, setHoveredPoint] = useState<TimeSeriesPoint | null>(null);

  // Combine onchain SpendRecorded/SpendEvaluated events with simulated evaluations
  const points: TimeSeriesPoint[] = useMemo(() => {
    const rawItems: { timestamp: number; amountWei: bigint; isSimulated: boolean }[] = [];
    const now = Math.floor(Date.now() / 1000);
    const windowSec = timeframe === '15m' ? 900 : timeframe === '1h' ? 3600 : 86400;
    const cutoff = now - windowSec;

    // Onchain spend events
    for (const e of events) {
      if (e.timestamp && (e.kind === 'SPEND_RECORDED' || e.kind === 'SPEND_EVALUATED')) {
        const ts = Number(e.timestamp);
        // If within cutoff, or if timestamps are simulated / relative
        if (ts >= cutoff || cutoff > 2000000000) {
          if (!agentAddress || (e.agent && e.agent.toLowerCase() === agentAddress.toLowerCase())) {
            rawItems.push({
              timestamp: ts,
              amountWei: e.amount || 0n,
              isSimulated: false,
            });
          }
        }
      }
    }

    // Simulated intents
    for (const s of simulatedRecords) {
      const ts = Number(s.timestamp);
      if (ts >= cutoff || cutoff > 2000000000) {
        if (!agentAddress || s.agent.toLowerCase() === agentAddress.toLowerCase()) {
          rawItems.push({
            timestamp: ts,
            amountWei: s.amountWei,
            isSimulated: true,
          });
        }
      }
    }

    if (rawItems.length === 0) return [];

    rawItems.sort((a, b) => a.timestamp - b.timestamp);

    // Group into 1-minute buckets for time-series display
    const bucketMap = new Map<number, { count: number; totalWei: bigint; isSimulated: boolean }>();
    for (const item of rawItems) {
      const bucket = Math.floor(item.timestamp / 60) * 60;
      const existing = bucketMap.get(bucket) || { count: 0, totalWei: 0n, isSimulated: false };
      existing.count += 1;
      existing.totalWei += item.amountWei;
      if (item.isSimulated) existing.isSimulated = true;
      bucketMap.set(bucket, existing);
    }

    return Array.from(bucketMap.entries())
      .slice(-20)
      .map(([bucket, data]) => {
        const d = new Date(bucket * 1000);
        const timeLabel = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        return {
          timestamp: bucket,
          timeLabel,
          txCount: data.count,
          totalWei: data.totalWei,
          isBreach: data.count > maxVelocityCap,
          isSimulated: data.isSimulated,
        };
      });
  }, [events, simulatedRecords, maxVelocityCap, agentAddress, timeframe]);

  const maxVelocityInSample = Math.max(maxVelocityCap + 2, ...points.map((p) => p.txCount), 6);

  // SVG Chart Geometry
  const width = 640;
  const height = 180;
  const padding = { top: 20, right: 30, bottom: 30, left: 40 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  const getX = (index: number) => {
    if (points.length <= 1) return padding.left + graphWidth / 2;
    return padding.left + (index / (points.length - 1)) * graphWidth;
  };

  const getY = (val: number) => {
    return padding.top + graphHeight - (val / maxVelocityInSample) * graphHeight;
  };

  // Build SVG polyline path for velocity
  const pathD = useMemo(() => {
    if (points.length === 0) return '';
    return points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.txCount)}`)
      .join(' ');
  }, [points, maxVelocityInSample]);

  const capY = getY(maxVelocityCap);

  return (
    <Card padding="md">
      <div className="flex flex-col gap-3 border-b border-card-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-fg">Spend Velocity & Rate Limit Time-Series</h3>
            <p className="text-[11px] text-fg-muted">
              Rolling window ({windowSeconds}s) transaction frequency vs onchain velocity ceiling ({maxVelocityCap} tx/window)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* Timeframe Toggles */}
          <div className="flex items-center rounded-lg border border-card-border bg-card-muted p-0.5">
            {(['15m', '1h', '24h'] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${
                  timeframe === tf
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => navigate('/audit')}
            className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
          >
            <span>Inspect Audit</span>
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-dashed border-card-border p-6 text-center text-xs text-fg-muted">
          <ShieldCheck className="h-7 w-7 text-fg-subtle" />
          <p className="mt-2 font-medium">No recorded transactions in current window</p>
          <p className="mt-1 text-[11px]">Execute an intent or run the fleet benchmark to stream real-time velocity curves.</p>
        </div>
      ) : (
        <div className="relative mt-4">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible font-mono text-[10px]">
            {/* Grid Lines */}
            <line
              x1={padding.left}
              y1={padding.top}
              x2={width - padding.right}
              y2={padding.top}
              stroke="currentColor"
              className="text-card-border"
              strokeDasharray="3 3"
            />
            <line
              x1={padding.left}
              y1={getY(maxVelocityInSample / 2)}
              x2={width - padding.right}
              y2={getY(maxVelocityInSample / 2)}
              stroke="currentColor"
              className="text-card-border"
              strokeDasharray="3 3"
            />
            <line
              x1={padding.left}
              y1={padding.top + graphHeight}
              x2={width - padding.right}
              y2={padding.top + graphHeight}
              stroke="currentColor"
              className="text-card-border"
            />

            {/* Threshold line */}
            <line
              x1={padding.left}
              y1={capY}
              x2={width - padding.right}
              y2={capY}
              stroke="rgb(239, 68, 68)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            <text x={width - padding.right + 4} y={capY + 3} fill="rgb(239, 68, 68)" textAnchor="start">
              Cap
            </text>

            {/* Velocity Area & Curve */}
            <path
              d={`${pathD} L ${getX(points.length - 1)} ${padding.top + graphHeight} L ${getX(0)} ${padding.top + graphHeight} Z`}
              fill="url(#velocityGradient)"
              opacity="0.15"
            />
            <path d={pathD} fill="none" stroke="rgb(16, 185, 129)" strokeWidth="2.5" />

            <defs>
              <linearGradient id="velocityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(16, 185, 129)" />
                <stop offset="100%" stopColor="transparent" />
              </linearGradient>
            </defs>

            {/* Data Points */}
            {points.map((pt, idx) => {
              const cx = getX(idx);
              const cy = getY(pt.txCount);
              const isBreach = pt.isBreach;
              return (
                <g
                  key={pt.timestamp}
                  className="cursor-pointer group"
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onClick={() => navigate('/audit')}
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isBreach ? 5 : 3.5}
                    fill={isBreach ? 'rgb(239, 68, 68)' : 'rgb(16, 185, 129)'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  {/* X Axis Label */}
                  <text
                    x={cx}
                    y={height - 8}
                    textAnchor="middle"
                    fill="currentColor"
                    className="text-fg-muted text-[9px]"
                  >
                    {pt.timeLabel}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Hover Information Tooltip */}
          {hoveredPoint && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-card-muted border border-card-border p-3 text-xs">
              <div className="flex items-center gap-2">
                {hoveredPoint.isBreach ? (
                  <AlertTriangle className="h-4 w-4 text-danger" />
                ) : (
                  <Zap className="h-4 w-4 text-success" />
                )}
                <span className="font-semibold text-fg">
                  {hoveredPoint.timeLabel} — {hoveredPoint.txCount} txs ({hoveredPoint.isBreach ? 'BREACHED CAP' : 'NORMAL VELOCITY'})
                </span>
                {hoveredPoint.isSimulated && (
                  <span className="rounded bg-primary-subtle px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    DRY RUN
                  </span>
                )}
              </div>
              <span className="font-mono text-fg-muted">
                Vol: {formatEther(hoveredPoint.totalWei)} MON
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
