import React from 'react';
import {
  Shield,
  Layers,
  Sliders,
  Play,
  FileText,
  ShieldCheck,
  Users,
  Search,
  Activity,
  Cpu,
  Lock,
} from 'lucide-react';

export interface ConsoleSkeletonProps {
  /**
   * When true (default for root bootstrap and App fallback), renders the complete
   * dashboard shell with sidebar, topbar, background glows, and bottom telemetry footer.
   * When false (for router-level Suspense fallbacks), renders only the inner workspace.
   */
  isFullApp?: boolean;
}

export const ConsoleSkeleton: React.FC<ConsoleSkeletonProps> = ({ isFullApp = true }) => {
  const content = (
    <div className="space-y-4 font-sans animate-pulse" aria-busy="true" aria-label="Loading AgentGuard Control Plane">
      {/* 1. Hero Synchronization Banner */}
      <div className="rounded-2xl border border-card-border bg-card/80 p-5 sm:p-6 backdrop-blur-sm shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-primary" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-fg">Synchronizing Autonomous Fleet State</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 font-mono text-[10px] text-primary">
                  Monad Testnet 10143
                </span>
              </div>
              <p className="text-xs text-fg-muted mt-0.5">
                Querying onchain spend limits, velocity counters, and reputation metrics from Monad node…
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="h-7 w-28 rounded-xl bg-card-muted" />
            <div className="h-7 w-24 rounded-xl bg-card-muted" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-card-border/60">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-fg-subtle shrink-0" />
            <div className="h-3 w-24 bg-card-muted rounded" />
          </div>
          <div className="flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5 text-fg-subtle shrink-0" />
            <div className="h-3 w-28 bg-card-muted rounded" />
          </div>
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-fg-subtle shrink-0" />
            <div className="h-3 w-20 bg-card-muted rounded" />
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-fg-subtle shrink-0" />
            <div className="h-3 w-24 bg-card-muted rounded" />
          </div>
        </div>
      </div>

      {/* 2. Four Institutional KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {[
          { label: 'Guarded Fleet Agents', hint: 'Real-time Viem contract polling' },
          { label: '24h Spend Incurred', hint: 'Dynamic sliding window' },
          { label: 'Disjoint Storage Slots', hint: '32-byte Monad packed' },
          { label: 'O(1) Kill-Switch Readiness', hint: '0ms short-circuit latency' },
        ].map((item, idx) => (
          <div
            key={idx}
            className="rounded-2xl border border-card-border bg-card p-4.5 space-y-3 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-fg-muted tracking-wider uppercase">
                {item.label}
              </span>
              <div className="h-5 w-12 rounded-full bg-card-muted" />
            </div>
            <div className="flex items-baseline gap-2">
              <div className="h-7 w-20 rounded-lg bg-card-muted" />
              <div className="h-3.5 w-14 rounded bg-card-muted/60" />
            </div>
            <div className="pt-1 text-[10px] text-fg-subtle flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/50" />
              <span>{item.hint}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 3. Fleet Table & Policy Directory Skeleton */}
      <div className="rounded-2xl border border-card-border bg-card overflow-hidden shadow-xs">
        {/* Table Toolbar Skeleton */}
        <div className="p-4 border-b border-card-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card-subtle/50">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
              <div className="h-9 w-full rounded-xl bg-card-muted pl-9 pr-4" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-24 rounded-xl bg-card-muted" />
            <div className="h-8 w-28 rounded-xl bg-card-muted" />
            <div className="h-8 w-32 rounded-xl bg-primary/20" />
          </div>
        </div>

        {/* Table Header Row Skeleton */}
        <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-card-border bg-card text-[11px] font-semibold text-fg-muted">
          <div className="col-span-1 flex items-center">
            <div className="h-3.5 w-3.5 rounded bg-card-muted" />
          </div>
          <div className="col-span-4 sm:col-span-3">Agent Wallet</div>
          <div className="col-span-3 sm:col-span-3">Policy Limits (Tx / Window)</div>
          <div className="col-span-2 hidden sm:block">Velocity</div>
          <div className="col-span-2 hidden sm:block">Reputation</div>
          <div className="col-span-4 sm:col-span-1 text-right">Actions</div>
        </div>

        {/* Table Shimmering Data Rows */}
        <div className="divide-y divide-card-border">
          {[1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-card-subtle/40 transition-colors"
            >
              {/* Checkbox */}
              <div className="col-span-1 flex items-center">
                <div className="h-3.5 w-3.5 rounded bg-card-muted" />
              </div>

              {/* Agent Wallet Identity */}
              <div className="col-span-4 sm:col-span-3 flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-full bg-card-muted shrink-0" />
                <div className="space-y-1.5 min-w-0">
                  <div className="h-3.5 w-24 rounded bg-card-muted" />
                  <div className="h-2.5 w-32 rounded bg-card-muted/60" />
                </div>
              </div>

              {/* Policy Limits */}
              <div className="col-span-3 sm:col-span-3 space-y-1">
                <div className="h-3.5 w-24 rounded bg-card-muted" />
                <div className="h-2.5 w-16 rounded bg-card-muted/60" />
              </div>

              {/* Velocity Bar */}
              <div className="col-span-2 hidden sm:block space-y-1.5">
                <div className="h-2 w-28 rounded-full bg-card-muted" />
                <div className="h-2 w-16 rounded bg-card-muted/60" />
              </div>

              {/* Reputation Gauge */}
              <div className="col-span-2 hidden sm:block">
                <div className="h-5 w-16 rounded-full bg-card-muted" />
              </div>

              {/* Action Buttons */}
              <div className="col-span-4 sm:col-span-1 flex items-center justify-end gap-1.5">
                <div className="h-7 w-14 rounded-xl bg-card-muted" />
              </div>
            </div>
          ))}
        </div>

        {/* Table Footer Pagination Skeleton */}
        <div className="px-5 py-3 border-t border-card-border flex items-center justify-between bg-card-subtle/30">
          <div className="h-3 w-36 rounded bg-card-muted" />
          <div className="flex items-center gap-1.5">
            <div className="h-7 w-7 rounded-lg bg-card-muted" />
            <div className="h-7 w-7 rounded-lg bg-card-muted" />
            <div className="h-7 w-7 rounded-lg bg-card-muted" />
          </div>
        </div>
      </div>
    </div>
  );

  if (!isFullApp) {
    return content;
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-app font-sans text-fg selection:bg-primary/30 selection:text-white">
      {/* Ambient background glows matching MainLayout */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden hidden dark:block z-0">
        <div className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full bg-primary/10 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 h-[600px] w-[600px] rounded-full bg-indigo-600/10 blur-[160px]" />
        <div className="absolute -bottom-20 left-1/3 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[140px]" />
      </div>

      {/* 64px Left Icon Sidebar Skeleton */}
      <aside
        aria-hidden="true"
        className="fixed top-0 left-0 bottom-0 w-16 bg-app border-r border-card-border z-20 hidden lg:flex flex-col items-center py-4 justify-between"
      >
        <div className="flex flex-col items-center space-y-4">
          <div className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Shield className="h-5 w-5 animate-pulse" />
          </div>
          <div className="w-8 h-px bg-card-border" />
          <div className="flex flex-col space-y-2">
            {[Shield, Sliders, Layers, Play, FileText, ShieldCheck, Users].map((Icon, idx) => (
              <div
                key={idx}
                className="h-10 w-10 rounded-2xl bg-card border border-card-border/50 flex items-center justify-center text-fg-subtle/50"
              >
                <Icon className="h-4 w-4" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center space-y-2">
          <div className="h-8 w-8 rounded-full bg-card-muted animate-pulse" />
        </div>
      </aside>

      {/* Workspace Area */}
      <div className="absolute top-0 left-0 lg:left-16 right-0 bottom-8 overflow-y-auto overflow-x-hidden bg-app-subtle">
        <div className="mx-auto flex w-full max-w-[1540px] flex-col min-h-full p-4">
          {content}
        </div>
      </div>

      {/* Platform Telemetry Footer Skeleton */}
      <footer
        aria-hidden="true"
        className="fixed bottom-0 left-0 lg:left-16 right-0 h-8 z-30 border-t border-card-border bg-app flex items-center justify-between px-4 sm:px-6 text-[11px] text-fg-muted select-none"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-fg tracking-tight">AgentGuard</span>
            <span className="text-zinc-600">•</span>
            <span className="text-fg-muted hidden md:inline">Programmable Spend & Risk Control</span>
            <span className="text-zinc-600 hidden md:inline">•</span>
            <span className="font-medium text-primary">Monad Testnet</span>
            <span className="rounded bg-card border border-card-border px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
              10143
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-zinc-400 pl-2 border-l border-card-border">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-zinc-300 font-medium">Connecting to Monad Parallel EVM (10143)…</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-sans">
          <span className="hidden lg:inline text-zinc-400">
            <span className="text-zinc-300 font-medium">Sub-Second</span> Finality
          </span>
          <span className="text-zinc-600 hidden xl:inline">•</span>
          <span className="hidden xl:inline text-zinc-400">
            <span className="text-zinc-300 font-medium">Instant</span> Freeze
          </span>
          <span className="text-zinc-600 hidden sm:inline">•</span>
          <span className="text-zinc-400">
            <span className="text-zinc-300 font-medium">x402</span> + <span className="text-zinc-300 font-medium">AP2</span>
          </span>
        </div>
      </footer>
    </div>
  );
};

export default ConsoleSkeleton;
