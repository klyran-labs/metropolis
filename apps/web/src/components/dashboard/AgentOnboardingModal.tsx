import React, { useState } from 'react';
import { type Address, parseEther, isAddress } from 'viem';
import { X, Plus, Bot, Shield, CheckCircle2, AlertCircle, Cpu, Globe, Database, DollarSign } from 'lucide-react';
import { type SpendPolicy } from '@agentguard/shared-types';

interface AgentOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisterAgent: (input: { name: string; role: string; policy: SpendPolicy }) => void | Promise<void>;
}

interface AgentTemplate {
  name: string;
  role: string;
  icon: React.ElementType;
  defaultMaxPerTx: string;
  defaultMaxPerWindow: string;
  defaultWindowSeconds: number;
  defaultVelocity: number;
  whitelistEnabled: boolean;
  description: string;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    name: 'LLM Inference Agent (Claude 3.7 / R1)',
    role: 'Compute Procurement',
    icon: Cpu,
    defaultMaxPerTx: '0.25',
    defaultMaxPerWindow: '2.0',
    defaultWindowSeconds: 3600,
    defaultVelocity: 5,
    whitelistEnabled: false,
    description: 'Procures high-throughput GPU tokens per invocation under tight per-request caps.',
  },
  {
    name: 'Web Data Aggregator (Firecrawl)',
    role: 'Web Scraping & Extraction',
    icon: Globe,
    defaultMaxPerTx: '0.10',
    defaultMaxPerWindow: '1.0',
    defaultWindowSeconds: 3600,
    defaultVelocity: 8,
    whitelistEnabled: false,
    description: 'Executes rapid micro-payments for structured web scraping endpoints.',
  },
  {
    name: 'Synthetic Data & Model Trainer',
    role: 'Distributed Model Training',
    icon: Database,
    defaultMaxPerTx: '1.50',
    defaultMaxPerWindow: '8.0',
    defaultWindowSeconds: 7200,
    defaultVelocity: 12,
    whitelistEnabled: true,
    description: 'High-volume batch compute workloads with strict merchant whitelist enforcement.',
  },
  {
    name: 'DeFi Arbitrage & Execution Bot',
    role: 'Liquidity Optimization',
    icon: DollarSign,
    defaultMaxPerTx: '0.50',
    defaultMaxPerWindow: '5.0',
    defaultWindowSeconds: 1800,
    defaultVelocity: 15,
    whitelistEnabled: true,
    description: 'Sub-second flash execution on Monad DEXes with strict velocity throttling.',
  },
];

export const AgentOnboardingModal: React.FC<AgentOnboardingModalProps> = ({
  isOpen,
  onClose,
  onRegisterAgent,
}) => {
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0);
  const [agentName, setAgentName] = useState(AGENT_TEMPLATES[0].name);
  const [agentRole, setAgentRole] = useState(AGENT_TEMPLATES[0].role);
  const [agentAddress, setAgentAddress] = useState<string>('');
  const [maxPerTx, setMaxPerTx] = useState(AGENT_TEMPLATES[0].defaultMaxPerTx);
  const [maxPerWindow, setMaxPerWindow] = useState(AGENT_TEMPLATES[0].defaultMaxPerWindow);
  const [windowSeconds, setWindowSeconds] = useState(AGENT_TEMPLATES[0].defaultWindowSeconds.toString());
  const [maxVelocity, setMaxVelocity] = useState(AGENT_TEMPLATES[0].defaultVelocity.toString());
  const [whitelistEnabled, setWhitelistEnabled] = useState(AGENT_TEMPLATES[0].whitelistEnabled);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectTemplate = (idx: number) => {
    setSelectedTemplateIndex(idx);
    const template = AGENT_TEMPLATES[idx];
    setAgentName(template.name);
    setAgentRole(template.role);
    setMaxPerTx(template.defaultMaxPerTx);
    setMaxPerWindow(template.defaultMaxPerWindow);
    setWindowSeconds(template.defaultWindowSeconds.toString());
    setMaxVelocity(template.defaultVelocity.toString());
    setWhitelistEnabled(template.whitelistEnabled);
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const targetAddress = agentAddress.trim();
    if (!targetAddress || !isAddress(targetAddress)) {
      setErrorMessage('Please provide a valid 42-character Ethereum address (0x...)');
      return;
    }

    const txCap = parseFloat(maxPerTx);
    const windowCap = parseFloat(maxPerWindow);
    const windowSecs = parseInt(windowSeconds, 10);
    const velocity = parseInt(maxVelocity, 10);

    if (isNaN(txCap) || txCap <= 0) {
      setErrorMessage('Max Per Tx must be greater than 0');
      return;
    }
    if (isNaN(windowCap) || windowCap < txCap) {
      setErrorMessage('Max Per Window must be greater than or equal to Max Per Tx');
      return;
    }
    if (isNaN(windowSecs) || windowSecs < 60) {
      setErrorMessage('Window duration must be at least 60 seconds');
      return;
    }
    if (isNaN(velocity) || velocity <= 0) {
      setErrorMessage('Velocity limit must be greater than 0');
      return;
    }

    const validAddress = targetAddress as Address;
    const newPolicy: SpendPolicy = {
      agent: validAddress,
      maxPerTx: parseEther(maxPerTx),
      maxPerWindow: parseEther(maxPerWindow),
      windowSeconds: windowSecs,
      maxVelocity: velocity,
      killSwitch: false,
      whitelistEnabled,
    };

    try {
      await onRegisterAgent({ name: agentName.trim() || 'Autonomous Agent', role: agentRole.trim() || 'General Agent', policy: newPolicy });
      onClose();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Policy transaction failed. No local agent record was created.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-xs font-sans"
    >
      <div className="relative w-full max-w-2xl rounded-3xl border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-5 top-5 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 border-b border-slate-200/80 pb-4 dark:border-slate-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 id="modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Provision New Autonomous Agent
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bind a disjoint storage slot & risk policy on Monad Parallel EVM (10143).
            </p>
          </div>
        </div>

        {/* Template Selector Grid */}
        <div className="mt-5">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Select Agent Role Template
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AGENT_TEMPLATES.map((tpl, i) => {
              const Icon = tpl.icon;
              const isSelected = selectedTemplateIndex === i;
              return (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => handleSelectTemplate(i)}
                  className={`flex flex-col items-start rounded-2xl border p-3 text-left transition-all ${
                    isSelected
                      ? 'border-[#254BFF] bg-blue-50/50 shadow-xs dark:border-blue-500 dark:bg-blue-950/30'
                      : 'border-slate-200/80 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isSelected ? 'text-[#254BFF] dark:text-blue-400' : 'text-slate-400'}`} />
                  <span className="mt-2 text-xs font-bold text-slate-900 dark:text-white truncate w-full">
                    {tpl.role}
                  </span>
                  <span className="mt-0.5 text-[10px] text-slate-500 line-clamp-1">
                    {tpl.defaultMaxPerTx} MON / tx
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Configuration Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="agent-name-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Agent Display Name
              </label>
              <input
                id="agent-name-input"
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. DeepSeek Reasoning Worker"
                required
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#254BFF] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="agent-role-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Operational Role
              </label>
              <input
                id="agent-role-input"
                type="text"
                value={agentRole}
                onChange={(e) => setAgentRole(e.target.value)}
                placeholder="e.g. Compute Procurement"
                required
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#254BFF] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="agent-address-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Agent Wallet Address (EVM)
              </label>
              <span className="text-[11px] text-slate-400">Use an existing agent wallet</span>
            </div>
            <input
              id="agent-address-input"
              type="text"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              placeholder="0x..."
              required
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-[#254BFF] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Risk Invariant Controls */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-2xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div>
              <label htmlFor="max-per-tx-input" className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Max Per Tx (MON)
              </label>
              <input
                id="max-per-tx-input"
                type="number"
                step="0.01"
                min="0.01"
                value={maxPerTx}
                onChange={(e) => setMaxPerTx(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="max-per-window-input" className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Max Per Window (MON)
              </label>
              <input
                id="max-per-window-input"
                type="number"
                step="0.1"
                min="0.1"
                value={maxPerWindow}
                onChange={(e) => setMaxPerWindow(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="window-seconds-input" className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Window (Secs)
              </label>
              <input
                id="window-seconds-input"
                type="number"
                step="60"
                min="60"
                value={windowSeconds}
                onChange={(e) => setWindowSeconds(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="velocity-cap-input" className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Velocity Cap (Txs)
              </label>
              <input
                id="velocity-cap-input"
                type="number"
                step="1"
                min="1"
                value={maxVelocity}
                onChange={(e) => setMaxVelocity(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <input
              id="whitelist-checkbox"
              type="checkbox"
              checked={whitelistEnabled}
              onChange={(e) => setWhitelistEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#254BFF] focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <label htmlFor="whitelist-checkbox" className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              Enforce Merchant Whitelisting on Monad (Blocks unverified counterparty payments)
            </label>
          </div>

          {errorMessage && (
            <div className="flex items-center space-x-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-200/80 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center space-x-2 rounded-xl bg-[#254BFF] px-5 py-2 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-[#1D40DF] transition cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Provision & Commit Slot</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
