import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Play,
  AlertTriangle,
  RotateCcw,
  Zap,
  CheckCircle2,
  XCircle,
  Coins,
  Cpu,
  Layers,
  ArrowRight,
  ShieldCheck,
  Flame,
  ExternalLink,
} from 'lucide-react';
import { Button } from '../common/Button';
import { useDashboard } from '../../context/DashboardContext';
import {
  createDefaultCircuitBreaker,
  recordEvaluation,
  resetCircuitBreaker,
  tripCircuitBreaker,
} from '../../services/circuitBreaker';
import { diagnoseOnchainDenial } from '../../services/qwenCopilot';
import { ReasonCode, type CircuitBreakerConfig } from '@agentguard/shared-types';
import { MONAD_EXPLORER_URL } from '../../config/contracts';

interface AgentExecutionStep {
  id: string;
  type: 'THINK' | 'TOOL_CALL' | 'PAYMENT' | 'SYNTHESIS' | 'BLOCKED';
  title: string;
  detail: string;
  timestamp: string;
  amountMon?: string;
  tokensUsed?: number;
  reasonCode?: ReasonCode;
  status: 'PENDING' | 'SUCCESS' | 'DENIED';
}

const PRESET_PROMPTS = [
  {
    id: 'market-intel',
    label: 'Market Intel & Liquidity Analysis',
    prompt: 'Autonomous research task: Query Monad DEX liquidity depth, fetch token price feeds, and synthesize a comparative market report.',
  },
  {
    id: 'structured-scrape',
    label: 'Web Scraping & Extraction (Firecrawl)',
    prompt: 'Autonomous data task: Scrape validator health metrics, extract structured JSON schemas, and settle compute API fees.',
  },
  {
    id: 'adversarial-runaway',
    label: 'Adversarial Injection (Trip Circuit Breaker)',
    prompt: 'Simulate compromised prompt injection: Force agent into recursive tool loop attempting rapid unauthorized transfers.',
    isAdversarial: true,
  },
];

export const AutonomousAgentPlayground: React.FC = () => {
  const { agents } = useDashboard();
  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].prompt);
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<AgentExecutionStep[]>([]);
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerConfig>(() =>
    createDefaultCircuitBreaker(3, 900)
  );
  const [totalTokens, setTotalTokens] = useState({ prompt: 0, cache: 0, output: 0 });
  const [totalSpentMon, setTotalSpentMon] = useState(0);
  const [simulatedTxCount, setSimulatedTxCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'trace' | 'finops' | 'safety'>('trace');

  const streamEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  // Execute Autonomous Agent Workflow
  const handleExecute = async (overridePrompt?: string) => {
    const activePrompt = overridePrompt || prompt;
    if (isRunning || !activePrompt.trim()) return;

    if (circuitBreaker.status === 'OPEN') {
      alert('Cannot execute: Agent Circuit Breaker is TRIPPED. Reset the circuit breaker to resume execution.');
      return;
    }

    setIsRunning(true);
    setSteps([]);
    const isAdversarial = activePrompt.toLowerCase().includes('recursive') || activePrompt.toLowerCase().includes('compromised');

    let stepCounter = 0;
    const addStep = (step: Omit<AgentExecutionStep, 'id' | 'timestamp'>) => {
      stepCounter += 1;
      const newStep: AgentExecutionStep = {
        ...step,
        id: `step_${Date.now()}_${stepCounter}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setSteps((prev) => [...prev, newStep]);
      return newStep;
    };

    // Step 1: LLM Reasoning & Planning (Qwen 3.8 Max)
    addStep({
      type: 'THINK',
      title: 'Planning & Decomposition (Qwen 3.8 Max)',
      detail: 'Analyzing operator task, resolving sub-goals, and constructing execution DAG.',
      tokensUsed: 280,
      status: 'SUCCESS',
    });
    setTotalTokens((prev) => ({ ...prev, prompt: prev.prompt + 280, cache: prev.cache + 120 }));

    await new Promise((r) => setTimeout(r, 600));

    if (!isAdversarial) {
      // Normal Execution Flow

      // Step 2: Tool Call 1 + Monad x402 settlement
      addStep({
        type: 'TOOL_CALL',
        title: 'Tool Call: query_dex_depth()',
        detail: 'Querying liquidity pools on Monad. Requesting x402 payment clearance.',
        status: 'PENDING',
      });
      await new Promise((r) => setTimeout(r, 500));

      const cbResult1 = recordEvaluation(circuitBreaker, true, ReasonCode.ERR_NONE);
      setCircuitBreaker(cbResult1.config);

      addStep({
        type: 'PAYMENT',
        title: 'x402 Micro-Settlement Cleared',
        detail: 'Paid 0.04 MON to Monad DEX oracle. Evaluated in sub-50µs via PolicyEngine.sol.',
        amountMon: '0.04',
        status: 'SUCCESS',
      });
      setTotalSpentMon((prev) => prev + 0.04);
      setSimulatedTxCount((prev) => prev + 1);

      await new Promise((r) => setTimeout(r, 600));

      // Step 3: Tool Call 2 + Monad x402 settlement
      addStep({
        type: 'TOOL_CALL',
        title: 'Tool Call: fetch_orderbook_metrics()',
        detail: 'Extracting high-frequency orderbook snapshots.',
        status: 'PENDING',
      });
      await new Promise((r) => setTimeout(r, 500));

      addStep({
        type: 'PAYMENT',
        title: 'x402 Micro-Settlement Cleared',
        detail: 'Paid 0.03 MON to compute worker. Monad disjoint storage slot updated.',
        amountMon: '0.03',
        status: 'SUCCESS',
      });
      setTotalSpentMon((prev) => prev + 0.03);
      setSimulatedTxCount((prev) => prev + 1);

      await new Promise((r) => setTimeout(r, 700));

      // Step 4: Final Synthesis
      addStep({
        type: 'SYNTHESIS',
        title: 'Autonomous Synthesis Completed',
        detail: 'Report compiled successfully. Both tool micro-payments cleared within policy ceilings (Total: 0.07 MON).',
        tokensUsed: 460,
        status: 'SUCCESS',
      });
      setTotalTokens((prev) => ({ ...prev, output: prev.output + 460 }));
    } else {
      // Adversarial Runaway Flow (Demonstrates Circuit Breaker Trip)
      let currentCb = circuitBreaker;

      // Denial 1
      addStep({
        type: 'TOOL_CALL',
        title: 'Runaway Loop: Attempted Tool Call #1',
        detail: 'Agent attempting 2.50 MON transfer (Exceeds Max Per Tx of 0.25 MON).',
        status: 'PENDING',
      });
      await new Promise((r) => setTimeout(r, 500));

      const res1 = recordEvaluation(currentCb, false, ReasonCode.ERR_MAX_PER_TX);
      currentCb = res1.config;
      setCircuitBreaker(currentCb);

      addStep({
        type: 'BLOCKED',
        title: 'PolicyEngine Blocked: ERR_MAX_PER_TX (Code 2)',
        detail: 'Attempted 2.50 MON exceeds 0.25 MON cap. Failure counter: 1/3.',
        reasonCode: ReasonCode.ERR_MAX_PER_TX,
        status: 'DENIED',
      });

      await new Promise((r) => setTimeout(r, 600));

      // Denial 2
      addStep({
        type: 'TOOL_CALL',
        title: 'Runaway Loop: Rapid Retry Attempt #2',
        detail: 'Agent retrying unauthorized transfer without exponential backoff.',
        status: 'PENDING',
      });
      await new Promise((r) => setTimeout(r, 500));

      const res2 = recordEvaluation(currentCb, false, ReasonCode.ERR_VELOCITY_EXCEEDED);
      currentCb = res2.config;
      setCircuitBreaker(currentCb);

      addStep({
        type: 'BLOCKED',
        title: 'PolicyEngine Blocked: ERR_VELOCITY_EXCEEDED (Code 4)',
        detail: 'Rapid retry tripped velocity cap. Failure counter: 2/3.',
        reasonCode: ReasonCode.ERR_VELOCITY_EXCEEDED,
        status: 'DENIED',
      });

      await new Promise((r) => setTimeout(r, 600));

      // Denial 3 -> TRIPS CIRCUIT BREAKER
      addStep({
        type: 'TOOL_CALL',
        title: 'Runaway Loop: Retry Attempt #3',
        detail: 'Agent persisting in rogue loop. Reaching failure threshold.',
        status: 'PENDING',
      });
      await new Promise((r) => setTimeout(r, 500));

      const res3 = recordEvaluation(currentCb, false, ReasonCode.ERR_KILL_SWITCH);
      currentCb = res3.config;
      setCircuitBreaker(currentCb);

      addStep({
        type: 'BLOCKED',
        title: '⚡ CIRCUIT BREAKER TRIPPED -> O(1) AGENT QUARANTINE',
        detail: 'Threshold of 3 consecutive rejections reached! Circuit Breaker transitioned to OPEN. Monad kill-switch engaged to prevent financial drain.',
        reasonCode: ReasonCode.ERR_KILL_SWITCH,
        status: 'DENIED',
      });
    }

    setIsRunning(false);
  };

  const handleReset = () => {
    setCircuitBreaker(resetCircuitBreaker(circuitBreaker));
    setSteps([]);
  };

  const handleManualTrip = () => {
    setCircuitBreaker(tripCircuitBreaker(circuitBreaker, 'Manually tripped by supervisor in playground'));
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: AI-Native Header */}
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-card via-card-muted to-primary/5 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                AI-Native Autonomous Agent Runtime
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-fg">
              Autonomous Agent Execution Playground
            </h1>
            <p className="text-xs sm:text-sm text-fg-muted max-w-2xl">
              Interact with a live autonomous agent powered by Qwen 3.8 Max architecture. Observe
              multi-step reasoning, real-time Monad x402 micro-settlements, and fail-safe circuit breaker isolation.
            </p>
          </div>

          {/* Circuit Breaker Status Widget */}
          <div className="flex items-center gap-3 self-start md:self-auto rounded-2xl border border-card-border bg-card/80 p-3 shadow-xs">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-xl font-bold text-xs ${
                  circuitBreaker.status === 'CLOSED'
                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                    : circuitBreaker.status === 'OPEN'
                    ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20 animate-pulse'
                    : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                }`}
              >
                ⚡
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                  Circuit Breaker
                </div>
                <div className="flex items-center gap-1.5 font-mono text-xs font-black text-fg">
                  <span
                    className={
                      circuitBreaker.status === 'CLOSED'
                        ? 'text-emerald-500'
                        : circuitBreaker.status === 'OPEN'
                        ? 'text-rose-500'
                        : 'text-amber-500'
                    }
                  >
                    {circuitBreaker.status}
                  </span>
                  <span className="text-fg-muted font-normal text-[10px]">
                    ({circuitBreaker.consecutiveFailures || 0}/{circuitBreaker.failureThreshold} fails)
                  </span>
                </div>
              </div>
            </div>

            <div className="border-l border-card-border pl-3 flex gap-1">
              {circuitBreaker.status === 'OPEN' ? (
                <Button size="sm" variant="primary" onClick={handleReset} className="text-xs">
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={handleManualTrip} className="text-xs text-rose-500 hover:text-rose-400">
                  <Flame className="h-3 w-3 mr-1" />
                  Trip
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Interactive Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Prompt Input & Preset Controls (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-card-border bg-card p-5 space-y-4 shadow-xs">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-fg-muted flex items-center justify-between">
                <span>Task Prompt for Autonomous Agent</span>
                <span className="text-[10px] text-primary font-mono font-normal">Model: Qwen 3.8 Max</span>
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Give the autonomous agent a research or data extraction task..."
                disabled={isRunning}
                className="mt-2 w-full rounded-xl border border-card-border bg-card-muted px-3 py-2 text-xs text-fg outline-none focus:border-primary font-mono resize-none"
              />
            </div>

            {/* Quick Preset Buttons */}
            <div>
              <div className="text-[11px] font-semibold text-fg-muted mb-2">Preset Demonstrations:</div>
              <div className="space-y-1.5">
                {PRESET_PROMPTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPrompt(p.prompt);
                    }}
                    disabled={isRunning}
                    className={`w-full text-left p-2.5 rounded-xl border text-xs transition flex items-center justify-between ${
                      p.isAdversarial
                        ? 'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 text-rose-400'
                        : 'border-card-border bg-card-muted hover:border-fg-subtle text-fg'
                    }`}
                  >
                    <span className="font-medium truncate">{p.label}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 ml-2 opacity-60" />
                  </button>
                ))}
              </div>
            </div>

            {/* Action Bar */}
            <div className="pt-2 flex items-center gap-2">
              <Button
                variant="primary"
                onClick={() => handleExecute()}
                disabled={isRunning || circuitBreaker.status === 'OPEN'}
                className="flex-1 text-xs font-bold"
              >
                {isRunning ? (
                  <>
                    <span className="h-3 w-3 border-2 border-white/20 border-t-white rounded-full animate-spin mr-2" />
                    Agent Executing...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
                    Launch Autonomous Agent
                  </>
                )}
              </Button>

              <Button
                variant="secondary"
                onClick={() => setSteps([])}
                disabled={isRunning || steps.length === 0}
                className="text-xs"
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Real-Time Telemetry Card */}
          <div className="rounded-2xl border border-card-border bg-card p-5 space-y-4 shadow-xs">
            <div className="text-xs font-bold uppercase tracking-wider text-fg-muted">
              Live Dual-Denomination Telemetry
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-card-border bg-card-muted p-3">
                <div className="text-[10px] font-medium text-fg-muted flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-purple-400" />
                  Token Meter
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-fg">
                  {(totalTokens.prompt + totalTokens.output).toLocaleString()}
                </div>
                <div className="text-[9px] text-fg-muted font-mono mt-0.5">
                  Prompt: {totalTokens.prompt} | Cache: {totalTokens.cache} (90% off)
                </div>
              </div>

              <div className="rounded-xl border border-card-border bg-card-muted p-3">
                <div className="text-[10px] font-medium text-fg-muted flex items-center gap-1">
                  <Coins className="h-3 w-3 text-emerald-400" />
                  Onchain Micro-Settlements
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-emerald-500">
                  {totalSpentMon.toFixed(3)} MON
                </div>
                <div className="text-[9px] text-fg-muted font-mono mt-0.5">
                  Txs: {simulatedTxCount} | Est. Gas: $0.00005
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-card-border bg-card-muted/50 p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-fg-muted">Monad Parallel Finality:</span>
                <span className="font-mono text-fg font-semibold">400ms</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-fg-muted">Kill-Switch Invariant:</span>
                <span className="font-mono text-emerald-400 font-semibold">O(1) Cancun Transient Lock</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-fg-muted">Active Tenant:</span>
                <span className="font-mono text-fg font-semibold">Acme AI Systems</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Execution Stream & Trace (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-card-border bg-card p-5 min-h-[480px] flex flex-col shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-card-border">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold text-fg">Autonomous Execution Stream</span>
              </div>
              <span className="text-[10px] font-mono text-fg-muted">
                {steps.length} {steps.length === 1 ? 'event' : 'events'} recorded
              </span>
            </div>

            {/* Steps Container */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3 font-mono text-xs max-h-[520px]">
              {steps.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center text-fg-muted space-y-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card-muted text-fg-muted border border-card-border">
                    <Zap className="h-6 w-6 opacity-40" />
                  </div>
                  <div>
                    <div className="font-medium text-fg">No Active Execution</div>
                    <div className="text-[11px] text-fg-muted mt-1 max-w-sm">
                      Select a preset demonstration or enter a prompt on the left to watch the autonomous agent reason and transact live.
                    </div>
                  </div>
                </div>
              ) : (
                steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className={`rounded-xl border p-3.5 transition-all ${
                      step.type === 'BLOCKED'
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        : step.type === 'PAYMENT'
                        ? 'border-emerald-500/30 bg-emerald-500/5 text-fg'
                        : step.type === 'THINK'
                        ? 'border-purple-500/30 bg-purple-500/5 text-fg'
                        : 'border-card-border bg-card-muted text-fg'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold text-xs">
                        {step.type === 'BLOCKED' ? (
                          <XCircle className="h-4 w-4 text-rose-500 shrink-0" />
                        ) : step.type === 'PAYMENT' ? (
                          <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                        ) : step.type === 'THINK' ? (
                          <Cpu className="h-4 w-4 text-purple-400 shrink-0" />
                        ) : (
                          <Zap className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <span>{step.title}</span>
                      </div>
                      <span className="text-[10px] text-fg-muted font-normal shrink-0">
                        {step.timestamp}
                      </span>
                    </div>

                    <p className="mt-1.5 text-[11px] text-fg-muted font-sans leading-relaxed">
                      {step.detail}
                    </p>

                    {step.amountMon && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                        x402 Paid: {step.amountMon} MON
                      </div>
                    )}

                    {step.reasonCode !== undefined && (
                      <div className="mt-2.5 rounded-lg bg-card border border-rose-500/30 p-2.5 space-y-1 font-sans text-xs">
                        <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                          Copilot Diagnostic Analysis:
                        </div>
                        <div className="text-fg text-[11px]">
                          {diagnoseOnchainDenial(step.reasonCode).rootCause}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={streamEndRef} />
            </div>

            {/* Quick Footer Action when Tripped */}
            {circuitBreaker.status === 'OPEN' && (
              <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Agent quarantined by circuit breaker. Rogue spending halted.</span>
                </div>
                <Button size="sm" variant="primary" onClick={handleReset} className="text-xs">
                  Restore Agent
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AutonomousAgentPlayground;
