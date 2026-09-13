import React from 'react';
import { InlinePrivyAuth } from './InlinePrivyAuth';
import { ThemeToggle } from './common/ThemeToggle';

export const LandingPage: React.FC = () => {
  return (
    <div className="h-screen w-screen bg-app text-fg flex p-3 sm:p-4 md:p-6 overflow-hidden font-sans select-none relative">
      {/* Floating Theme Toggle in Top Right */}
      <div className="absolute top-5 right-5 sm:top-6 sm:right-8 z-40">
        <div className="p-1 rounded-xl bg-card-muted/80 border border-card-border backdrop-blur-md hover:scale-105 transition-all">
          <ThemeToggle />
        </div>
      </div>

      <main className="w-full h-full grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-center">
        {/* Left Column (5 cols): Pure clean centered Sign In card matching reference */}
        <section className="lg:col-span-5 h-full flex items-center justify-center p-2 sm:p-4">
          <InlinePrivyAuth />
        </section>

        {/* Right Column (7 cols): Inset preview window matching reference */}
        <section className="hidden lg:flex lg:col-span-7 h-full rounded-[24px] border border-card-border bg-card p-8 xl:p-10 flex-col justify-between relative overflow-hidden shadow-2xl">
          {/* Ambient subtle light streak */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-primary/10 via-purple-500/5 to-transparent rounded-full blur-[140px] pointer-events-none" />

          {/* Top Brand & Title Section */}
          <div className="relative z-10 space-y-3">
            {/* AgentGuard Brand Mark */}
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary via-purple-600 to-indigo-700 text-white font-black text-xs shadow-md shadow-primary/30 ring-1 ring-white/20">
                AG
              </div>
              <span className="text-xs font-mono text-fg-subtle uppercase tracking-widest pl-1 font-semibold">
                AgentGuard
              </span>
            </div>

            {/* Title */}
            <h2 className="text-2xl xl:text-3xl font-bold text-fg tracking-tight">
              Secure Dashboard Access
            </h2>

            {/* Subtitle */}
            <p className="text-xs xl:text-sm text-fg-muted leading-relaxed max-w-lg font-normal">
              A robust authentication gateway ensuring secure, compliant operator access to the AgentGuard Control Plane. Autonomous agent spend control enforced onchain.
            </p>
          </div>

          {/* Perspective Preview Tiles Matrix matching reference screenshot */}
          <div className="relative z-10 my-auto py-2 grid grid-cols-12 gap-3.5 opacity-95">
            {/* Tile 1: Theme mode preview card (Top Right) */}
            <div className="col-span-12 xl:col-span-7 rounded-xl border border-card-border bg-card-muted p-3.5 shadow-lg">
              <div className="flex items-center justify-between text-[10px] text-fg-muted font-semibold mb-2">
                <span>Theme mode</span>
                <span className="text-fg-subtle">Select or customize your UI theme</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {/* Dark Theme pill */}
                <div className="rounded-lg border border-primary bg-card p-2 flex flex-col gap-1 relative shadow-sm">
                  <div className="h-10 rounded bg-card-muted border border-card-border p-1 flex gap-1">
                    <div className="w-1/3 h-full bg-primary/20 rounded-xs" />
                    <div className="w-2/3 h-full bg-card rounded-xs" />
                  </div>
                  <div className="flex items-center justify-between text-[9px] text-fg pt-1">
                    <span className="font-semibold">Dark</span>
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  </div>
                </div>
                {/* Light Theme pill */}
                <div className="rounded-lg border border-card-border bg-card-muted p-2 flex flex-col gap-1 opacity-70">
                  <div className="h-10 rounded bg-white dark:bg-zinc-800 p-1 flex gap-1">
                    <div className="w-1/3 h-full bg-slate-200 dark:bg-zinc-700 rounded-xs" />
                    <div className="w-2/3 h-full bg-slate-100 dark:bg-zinc-600 rounded-xs" />
                  </div>
                  <div className="text-[9px] text-fg-muted pt-1 font-semibold">Light</div>
                </div>
              </div>
              {/* Transparent sidebar toggle */}
              <div className="mt-2.5 pt-2 border-t border-card-border flex items-center justify-between text-[10px] text-fg-muted">
                <span>Transparent sidebar</span>
                <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-semibold">
                  Active
                </span>
              </div>
            </div>

            {/* Tile 2: Integrations Preview Card */}
            <div className="col-span-12 xl:col-span-5 rounded-xl border border-card-border bg-card-muted p-3.5 shadow-lg flex flex-col justify-between">
              <div>
                <div className="text-[10px] font-semibold text-fg mb-2">Integrations</div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between p-1.5 rounded-lg bg-card border border-card-border">
                    <div className="flex items-center gap-1.5">
                      <div className="h-4 w-4 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-[8px] font-bold">
                        G
                      </div>
                      <span className="text-[9px] text-fg truncate max-w-[90px]">Gitlab DevOps</span>
                    </div>
                    <span className="h-2 w-3.5 rounded-full bg-primary inline-block" />
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded-lg bg-card border border-card-border">
                    <div className="flex items-center gap-1.5">
                      <div className="h-4 w-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[8px] font-bold">
                        E
                      </div>
                      <span className="text-[9px] text-fg truncate max-w-[90px]">Evernote Sync</span>
                    </div>
                    <span className="h-2 w-3.5 rounded-full bg-fg-subtle inline-block" />
                  </div>
                </div>
              </div>
              <div className="text-[9px] text-fg-subtle pt-2 border-t border-card-border">
                Showing 10 of 49,000 integrations
              </div>
            </div>
          </div>

          {/* Bottom Metric Pills */}
          <div className="relative z-10 pt-3 border-t border-card-border grid grid-cols-4 gap-2 text-left">
            <div className="rounded-lg bg-card-muted border border-card-border p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-fg-subtle font-bold">Settlement</div>
              <div className="text-sm font-bold text-fg font-mono mt-0.5">Sub-Second</div>
              <div className="text-[9px] text-fg-muted truncate">Real-time finality</div>
            </div>
            <div className="rounded-lg bg-card-muted border border-card-border p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-fg-subtle font-bold">Revocation</div>
              <div className="text-sm font-bold text-fg font-mono mt-0.5">&lt;1ms</div>
              <div className="text-[9px] text-fg-muted truncate">Instant emergency halt</div>
            </div>
            <div className="rounded-lg bg-card-muted border border-card-border p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-fg-subtle font-bold">Protocol</div>
              <div className="text-sm font-bold text-fg font-mono mt-0.5">x402 + AP2</div>
              <div className="text-[9px] text-fg-muted truncate">HTTP 402 negotiation</div>
            </div>
            <div className="rounded-lg bg-card-muted border border-card-border p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-fg-subtle font-bold">Trust Model</div>
              <div className="text-sm font-bold text-fg tracking-tight mt-0.5">Non-Custodial</div>
              <div className="text-[9px] text-fg-muted truncate">Enterprise safety</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default LandingPage;
