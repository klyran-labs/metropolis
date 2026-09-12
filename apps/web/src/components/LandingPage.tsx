import React from 'react';
import { Sparkles, ShieldCheck, Zap, Server, Cpu, CheckCircle2, ArrowRight } from 'lucide-react';
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
              CX
            </div>
            <div className="flex items-center space-x-2.5">
              <span className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100 uppercase font-sans">
                Compute<span className="text-[#254BFF] dark:text-blue-400">X</span>
              </span>
              <span className="text-[10px] font-sans px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800/60 text-[#254BFF] dark:text-blue-400 font-bold">
                ENTERPRISE
              </span>
            </div>
          </div>
        </div>

        {/* Hero Content */}
        <div className="my-10 lg:my-auto max-w-xl">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700 text-[#254BFF] dark:text-blue-400 text-xs font-semibold mb-6 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400" />
            <span>Enterprise Capacity Procurement & Operations Platform</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 dark:text-slate-100 leading-[1.1] mb-6 font-sans">
            Verified compute capacity <br />
            <span className="text-[#254BFF] dark:text-blue-400">for every workload.</span>
          </h1>

          <p className="text-slate-600 dark:text-slate-300 text-base sm:text-lg font-normal leading-relaxed mb-8">
            Procure dedicated CPU, GPU, and cluster capacity with transparent pricing, evidence-backed provisioning, and policy-defined service levels.
          </p>

          {/* Public Value Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400" />
                </div>
                <span className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider font-sans">
                  Provisioning Workflow
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 font-sans">Evidence-backed</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Access is issued only after authoritative host output</p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider font-sans">
                  Policy Target
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 font-sans">99.50%</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Configured policy with collateral protection when eligible</p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-purple-50 dark:bg-purple-950/50 flex items-center justify-center">
                  <Cpu className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                </div>
                <span className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider font-sans">
                  Capacity Types
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 font-sans">CPU + GPU</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Browse live offers by model, region, and availability</p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-sky-50 dark:bg-sky-950/50 flex items-center justify-center">
                  <Server className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                </div>
                <span className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider font-sans">
                  Pricing Model
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 font-sans">Transparent</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Review rate, duration, and settlement details before approval</p>
            </div>
          </div>

          {/* Key Value Highlights */}
          <div className="mt-8 space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-center space-x-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#254BFF] dark:text-blue-400 shrink-0" />
              <span className="font-medium text-slate-700 dark:text-slate-200">Dedicated bare-metal instances with cryptographically verified host sanitization</span>
            </div>
            <div className="flex items-center space-x-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#254BFF] dark:text-blue-400 shrink-0" />
              <span className="font-medium text-slate-700 dark:text-slate-200">Continuous non-custodial streaming settlements with atomic delivery vs. payment</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-6 border-t border-slate-200/80 dark:border-slate-800 text-xs font-sans text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>ComputeX Enterprise Platform</span>
          <span className="text-[#254BFF] dark:text-blue-400 font-semibold">Enterprise security review ready</span>
        </div>
      </div>

      {/* Right Panel: Authentication & Onboarding Card (50%) */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 sm:p-10 lg:p-12 xl:p-16 relative z-20 border-t lg:border-t-0 lg:border-l border-slate-200/80 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/40">
        <div className="w-full max-w-md relative z-10 flex flex-col items-center animate-fade-in-up">
          <div className="text-center mb-6">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight font-sans">
              Enter Workspace
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5 font-sans">
            Sign in with your organization email or connect a wallet to begin.
            </p>
          </div>

          {/* Embedded Auth & Intent Selector */}
          <InlinePrivyAuth />

          {/* Security badge */}
          <div className="mt-6 flex items-center space-x-2 text-[11px] font-sans text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 py-2 px-4 rounded-full border border-slate-200/80 dark:border-slate-700 shadow-sm">
            <ShieldCheck className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400" />
            <span>Enterprise Authentication & Session Security</span>
          </div>
        </div>
      </div>
    </div>
  );
};
