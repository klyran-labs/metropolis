import React from 'react';
import { Sparkles, ShieldCheck, Zap, ShieldAlert, CheckCircle2, Lock } from 'lucide-react';
import { InlinePrivyAuth } from './InlinePrivyAuth';
import { ThemeToggle } from './common/ThemeToggle';

export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#f3f5fa] dark:bg-[#0c1020] text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row relative overflow-hidden font-sans">
      {/* Ambient background soft light accents */}
      <div className="absolute top-0 left-0 w-[550px] h-[550px] bg-blue-400/10 dark:bg-blue-600/10 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[450px] h-[450px] bg-indigo-300/15 dark:bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Top Floating Theme Toggle */}
      <div className="absolute top-6 right-6 z-30">
        <ThemeToggle />
      </div>

      {/* Left Panel: High-Impact Marketing & Institutional Value Proposition (50%) */}
      <div className="w-full lg:w-1/2 flex flex-col justify-between p-8 sm:p-12 lg:p-16 xl:p-20 relative z-10 animate-fade-in-up">
        {/* Brand Header */}
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#254BFF] to-blue-700 flex items-center justify-center font-sans font-black text-white text-lg shadow-md shadow-blue-500/25">
              AG
            </div>
            <div className="flex items-center space-x-2.5">
              <span className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100 uppercase font-sans">
                Agent<span className="text-[#254BFF] dark:text-blue-400">Guard</span>
              </span>
              <span className="text-[10px] font-sans px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800/60 text-[#254BFF] dark:text-blue-400 font-bold">
                MONAD AGENT RISK
              </span>
            </div>
          </div>
        </div>

        {/* Hero Content */}
        <div className="my-10 lg:my-auto max-w-xl">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700 text-[#254BFF] dark:text-blue-400 text-xs font-semibold mb-6 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400" />
            <span>Programmable Risk & Spend Control Layer for Agentic Payments</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 dark:text-slate-100 leading-[1.1] mb-6 font-sans">
            Autonomous agent spend control <br />
            <span className="text-[#254BFF] dark:text-blue-400">enforced onchain.</span>
          </h1>

          <p className="text-slate-600 dark:text-slate-300 text-base sm:text-lg font-normal leading-relaxed mb-8">
            Enforce real-time budget caps, transaction velocity limits, and sub-second kill switches on Monad before rogue or misaligned agents drain your enterprise treasury. Built for x402 and AP2 agent payment standards.
          </p>

          {/* Public Value Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400" />
                </div>
                <span className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider font-sans">
                  Evaluation Speed
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 font-sans">400ms</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Parallel EVM sub-second deterministic settlement</p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                </div>
                <span className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider font-sans">
                  Emergency Revocation
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 font-sans">O(1)</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Instant onchain kill switch with zero bypass</p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider font-sans">
                  Protocol Support
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 font-sans">x402 + AP2</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Compatible with HTTP 402 payment negotiation</p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-purple-50 dark:bg-purple-950/50 flex items-center justify-center">
                  <Lock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                </div>
                <span className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider font-sans">
                  Trust Model
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 font-sans">Non-Custodial</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Funds remain in enterprise custody until policy passes</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-8 border-t border-slate-200/60 dark:border-slate-800/60 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
          <span>AgentGuard Architecture • Monad Metropolis</span>
          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Chain ID 10143</span>
            </span>
          </div>
        </div>
      </div>

      {/* Right Panel: Official Privy Authentication Container (50%) */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 lg:p-16 relative z-10 bg-slate-50/50 dark:bg-slate-900/50 lg:bg-transparent">
        <div className="w-full max-w-md">
          <InlinePrivyAuth />
        </div>
      </div>
    </div>
  );
};
