import React, { useState } from 'react';
import { type Address, isAddress, keccak256, parseEther, toHex } from 'viem';
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle, Zap, Shield, ArrowUpRight, Flame, Clock } from 'lucide-react';
import { type FleetAgent, type PolicyDecision, type SpendRequest, ReasonCode } from '@agentguard/shared-types';
import { createPolicyRejectionResponse } from '@agentguard/x402-middleware';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { KillSwitchConfirmDialog } from '../common/KillSwitchConfirmDialog';
import { formatWeb3ErrorMessage } from '../../utils/errors';

interface RogueAgentSimulatorProps {
  agent: FleetAgent;
  onExecuteSimulation: (req: SpendRequest) => Promise<PolicyDecision>;
  onToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
}

export const RogueAgentSimulator: React.FC<RogueAgentSimulatorProps> = ({ agent, onExecuteSimulation, onToggleKillSwitch }) => {
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<PolicyDecision | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);
  const [killSwitchConfirmOpen, setKillSwitchConfirmOpen] = useState(false);

  const limitMon = Number(agent.policy.maxPerTx) / 1e18;

  const triggerEvaluationWithParams = async (m: string, a: string, c: string) => {
    setError(null);
    setDecision(null);
    setPayload(null);
    if (!isAddress(m)) return setError('Enter a valid merchant wallet address to evaluate.');
    if (!a || Number(a) <= 0) return setError('Enter a positive amount in MON.');
    if (!c.trim()) return setError('Enter a policy category.');

    const startTime = performance.now();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const request: SpendRequest = {
      agent: agent.address,
      merchant: m as Address,
      amount: parseEther(a),
      category: keccak256(toHex(c.trim())),
      timestamp,
      deadline: timestamp + 300n,
      nonce: agent.state.nonce + 1n,
    };

    setRunning(true);
    try {
      const result = await onExecuteSimulation(request);
      setDecision(result);
      setExecutionTimeMs(Math.round((performance.now() - startTime) * 10) / 10);
      if (result.reasonCode !== 0) {
        setPayload(createPolicyRejectionResponse(result.reasonCode, agent.address));
      }
    } catch (cause) {
      setError(formatWeb3ErrorMessage(cause));
    } finally {
      setRunning(false);
    }
  };

  const evaluate = async (event: React.FormEvent) => {
    event.preventDefault();
    await triggerEvaluationWithParams(merchant, amount, category);
  };

  // 1-Click Scenario Preset Injectors (Derives valid Monad agent address or target)
  const injectScenario = (type: 'nominal' | 'exceeds_cap' | 'velocity_burst' | 'unauthorized_vendor') => {
    const targetMerchant = merchant && isAddress(merchant) ? merchant : agent.address;
    if (!merchant) setMerchant(targetMerchant);

    if (type === 'nominal') {
      const safeAmount = (Math.max(0.01, limitMon * 0.25)).toFixed(3);
      setAmount(safeAmount);
      setCategory('inference');
      triggerEvaluationWithParams(targetMerchant, safeAmount, 'inference');
    } else if (type === 'exceeds_cap') {
      const spikeAmount = (limitMon * 3.5).toFixed(2);
      setAmount(spikeAmount);
      setCategory('bulk_compute');
      triggerEvaluationWithParams(targetMerchant, spikeAmount, 'bulk_compute');
    } else if (type === 'velocity_burst') {
      setAmount('0.10');
      setCategory('high_frequency_api');
      triggerEvaluationWithParams(targetMerchant, '0.10', 'high_frequency_api');
    } else if (type === 'unauthorized_vendor') {
      const unauthMerchant = '0x0000000000000000000000000000000000000001' as Address;
      setMerchant(unauthMerchant);
      setAmount('0.05');
      setCategory('unauthorized_drain');
      triggerEvaluationWithParams(unauthMerchant, '0.05', 'unauthorized_drain');
    }
  };

  const handleConfirmKillSwitch = async () => {
    try {
      await onToggleKillSwitch(agent.address, agent.policy.killSwitch);
    } finally {
      setKillSwitchConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-4 font-sans">
      <Card padding="md">
        {/* Subject Header */}
        <div className="flex flex-col gap-3 border-b border-card-border pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-subtle text-primary shadow-xs">
                <Shield className="h-4 w-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-fg tracking-tight">{agent.name}</h2>
                  <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-[9px] font-bold text-primary uppercase font-mono">
                    {agent.role}
                  </span>
                  {agent.policy.killSwitch && (
                    <span className="rounded-full bg-danger-subtle px-2 py-0.5 text-[9px] font-bold text-danger uppercase font-mono">
                      FROZEN (KILL SWITCH)
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted font-mono">{agent.address}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              Evaluate a real payment intent against live Monad parallel policy slots without submitting funds or mutating state.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={agent.policy.killSwitch ? 'primary' : 'outline-danger'}
              size="sm"
              leftIcon={<ShieldAlert className="h-4 w-4" />}
              onClick={() => setKillSwitchConfirmOpen(true)}
            >
              {agent.policy.killSwitch ? 'Release Kill Switch' : 'Activate Kill Switch'}
            </Button>
          </div>
        </div>

        {/* 1-Click Interactive Test Scenarios */}
        <div className="mt-4 pt-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-fg-muted flex items-center gap-1">
              <Zap className="h-3 w-3 text-primary" />
              Quick 1-Click Simulation Scenarios
            </span>
            <span className="text-[10px] text-fg-subtle">Sub-millisecond Monad evaluation</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-left">
            <button
              type="button"
              onClick={() => injectScenario('nominal')}
              disabled={running}
              className="flex flex-col rounded-xl border border-card-border bg-card-muted/60 p-2.5 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition cursor-pointer group"
            >
              <div className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                <span>1. Nominal Spend</span>
                <span className="text-[10px] uppercase font-mono">ALLOW</span>
              </div>
              <p className="text-[10px] text-fg-muted mt-1">
                Small micro-spend under limits ({(limitMon * 0.25).toFixed(2)} MON)
              </p>
            </button>

            <button
              type="button"
              onClick={() => injectScenario('exceeds_cap')}
              disabled={running}
              className="flex flex-col rounded-xl border border-card-border bg-card-muted/60 p-2.5 hover:border-rose-500/50 hover:bg-rose-500/5 transition cursor-pointer group"
            >
              <div className="flex items-center justify-between text-xs font-bold text-rose-600 dark:text-rose-400">
                <span>2. Spend Spike</span>
                <span className="text-[10px] uppercase font-mono">DENY (ERR_2)</span>
              </div>
              <p className="text-[10px] text-fg-muted mt-1">
                Breaches per-tx cap ({(limitMon * 3.5).toFixed(2)} MON &gt; {limitMon} MON)
              </p>
            </button>

            <button
              type="button"
              onClick={() => injectScenario('velocity_burst')}
              disabled={running}
              className="flex flex-col rounded-xl border border-card-border bg-card-muted/60 p-2.5 hover:border-amber-500/50 hover:bg-amber-500/5 transition cursor-pointer group"
            >
              <div className="flex items-center justify-between text-xs font-bold text-amber-600 dark:text-amber-400">
                <span>3. High Velocity</span>
                <span className="text-[10px] uppercase font-mono">DENY (ERR_4)</span>
              </div>
              <p className="text-[10px] text-fg-muted mt-1">
                Rapid bursts exceed window transaction limit
              </p>
            </button>

            <button
              type="button"
              onClick={() => injectScenario('unauthorized_vendor')}
              disabled={running}
              className="flex flex-col rounded-xl border border-card-border bg-card-muted/60 p-2.5 hover:border-purple-500/50 hover:bg-purple-500/5 transition cursor-pointer group"
            >
              <div className="flex items-center justify-between text-xs font-bold text-purple-600 dark:text-purple-400">
                <span>4. Rogue Counterparty</span>
                <span className="text-[10px] uppercase font-mono">DENY (ERR_5)</span>
              </div>
              <p className="text-[10px] text-fg-muted mt-1">
                Unapproved non-whitelisted counterparty
              </p>
            </button>
          </div>
        </div>

        {/* Custom Input Form */}
        <form onSubmit={evaluate} className="mt-5 border-t border-card-border pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-fg">Custom Payment Intent Parameters</span>
            <span className="text-xs font-mono text-fg-muted">Nonce: #{agent.state.nonce.toString()}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-fg-muted block mb-1">Merchant address</label>
              <input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="0x..."
                className="w-full rounded-xl border border-card-border bg-card px-3 py-2 font-mono text-xs text-fg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-fg-muted block mb-1">Spend Amount (MON)</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.05"
                className="w-full rounded-xl border border-card-border bg-card px-3 py-2 font-mono text-xs text-fg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-fg-muted block mb-1">Category Identifier</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. inference"
                className="w-full rounded-xl border border-card-border bg-card px-3 py-2 text-xs text-fg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-fg-muted flex items-center gap-2">
              <span>Limit Cap: <strong className="text-fg font-mono">{limitMon} MON</strong></span>
              <span>•</span>
              <span>Window: <strong className="text-fg font-mono">{agent.policy.windowSeconds.toString()}s</strong></span>
            </div>
            <Button type="submit" variant="primary" size="sm" loading={running} loadingLabel="Evaluating Onchain…">
              Evaluate onchain
            </Button>
          </div>
        </form>

        {error && (
          <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-danger-subtle p-3 text-xs text-danger font-medium border border-danger/20">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </Card>

      {/* Authoritative Onchain Decision Card */}
      <Card padding="md">
        <div className="flex items-center justify-between border-b border-card-border pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary-subtle text-primary">
              <Zap className="h-3.5 w-3.5" />
            </span>
            <h3 className="text-sm font-bold text-fg">Onchain Policy Decision</h3>
          </div>
          {executionTimeMs !== null && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              <Clock className="h-3 w-3" />
              {executionTimeMs}ms execution
            </span>
          )}
        </div>

        {!decision ? (
          <div className="mt-4 rounded-xl border border-dashed border-card-border p-8 text-center text-xs text-fg-muted">
            <p className="font-semibold text-fg">No Intent Evaluated Yet</p>
            <p className="mt-1 max-w-md mx-auto text-fg-subtle">
              Click any of the 1-Click Simulation Scenarios above or submit a custom payment intent to probe live onchain policy slots on Monad Testnet.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div
              className={`flex items-start gap-3 rounded-xl border p-4 transition ${
                decision.decision === 'ALLOW'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              }`}
            >
              {decision.decision === 'ALLOW' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-bold uppercase tracking-wide">
                    {decision.decision === 'ALLOW' ? 'TRANSACTION ALLOWED' : 'TRANSACTION DENIED (AUTO-CAPPED)'}
                  </span>
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-card border border-card-border text-fg">
                    ReasonCode: {String(decision.reasonCode)} ({ReasonCode[decision.reasonCode] || 'CUSTOM'})
                  </span>
                </div>
                <p className="mt-1 text-xs opacity-90">{decision.reasonMessage}</p>
              </div>
            </div>

            {payload !== null && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-fg-muted mb-1 font-mono">
                  x402 HTTP 403 Challenge Diagnostic Body:
                </p>
                <pre className="overflow-auto rounded-xl bg-card-muted p-3 text-[11px] font-mono text-emerald-500 border border-card-border">
                  {String(JSON.stringify(payload, null, 2))}
                </pre>
              </div>
            )}
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

export default RogueAgentSimulator;

