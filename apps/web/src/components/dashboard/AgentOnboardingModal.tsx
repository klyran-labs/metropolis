import React, { useState, useEffect } from 'react';
import { type Address, parseEther, isAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  X,
  Plus,
  Bot,
  AlertCircle,
  Cpu,
  Globe,
  Database,
  DollarSign,
  Key,
  Zap,
  Copy,
  Check,
  Eye,
  EyeOff,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { type SpendPolicy } from '@agentguard/shared-types';
import { Button } from '../common/Button';

interface AgentOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisterAgent: (input: {
    name: string;
    role: string;
    policy: SpendPolicy;
    privateKey?: `0x${string}`;
    saveToVault?: boolean;
  }) => void | Promise<void>;
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
  const [walletMode, setWalletMode] = useState<'generate' | 'import'>('generate');
  const [agentAddress, setAgentAddress] = useState<string>('');
  const [generatedPrivateKey, setGeneratedPrivateKey] = useState<`0x${string}` | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [saveToVault, setSaveToVault] = useState(true);

  const [maxPerTx, setMaxPerTx] = useState(AGENT_TEMPLATES[0].defaultMaxPerTx);
  const [maxPerWindow, setMaxPerWindow] = useState(AGENT_TEMPLATES[0].defaultMaxPerWindow);
  const [windowSeconds, setWindowSeconds] = useState(AGENT_TEMPLATES[0].defaultWindowSeconds.toString());
  const [maxVelocity, setMaxVelocity] = useState(AGENT_TEMPLATES[0].defaultVelocity.toString());
  const [whitelistEnabled, setWhitelistEnabled] = useState(AGENT_TEMPLATES[0].whitelistEnabled);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Generate keypair in browser using secure Web Crypto
  const handleGenerateKeypair = () => {
    const privKey = generatePrivateKey();
    const account = privateKeyToAccount(privKey);
    setGeneratedPrivateKey(privKey);
    setAgentAddress(account.address);
    setCopiedKey(false);
    setCopiedEnv(false);
  };

  useEffect(() => {
    if (isOpen && walletMode === 'generate' && !generatedPrivateKey) {
      handleGenerateKeypair();
    }
  }, [isOpen, walletMode]);

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

  const handleCopyEnv = () => {
    const envSnippet = `# AgentGuard Autonomous Agent Credentials\n# Settlement Chain: Monad Testnet (Chain ID: 10143)\nAGENT_WALLET_ADDRESS=${agentAddress}\nAGENT_PRIVATE_KEY=${generatedPrivateKey || ''}\nAGENTGUARD_GATEWAY_URL=https://gateway.agentguard.io\n`;
    navigator.clipboard.writeText(envSnippet);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

  const handleCopyPrivateKey = () => {
    if (generatedPrivateKey) {
      navigator.clipboard.writeText(generatedPrivateKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
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

    setSubmitting(true);
    try {
      await onRegisterAgent({
        name: agentName.trim() || 'Autonomous Agent',
        role: agentRole.trim() || 'General Agent',
        policy: newPolicy,
        privateKey: walletMode === 'generate' ? generatedPrivateKey || undefined : undefined,
        saveToVault: walletMode === 'generate' && saveToVault,
      });
      onClose();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Policy transaction failed. No local agent record was created.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-xs font-sans"
    >
      <div className="relative w-full max-w-2xl rounded-3xl border border-card-border bg-card p-6 shadow-2xl sm:p-8">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-5 top-5 rounded-full p-2 text-fg-subtle hover:bg-card-muted hover:text-fg"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 border-b border-card-border pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 id="modal-title" className="text-lg font-bold text-fg">
              Provision New Autonomous Agent
            </h2>
            <p className="text-xs text-fg-muted">
              Bind an isolated policy partition with autonomous spend guardrails.
            </p>
          </div>
        </div>

        {/* Template Selector Grid */}
        <div className="mt-5">
          <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
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
                      ? 'border-primary bg-primary-subtle shadow-xs'
                      : 'border-card-border bg-card hover:border-fg-subtle'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isSelected ? 'text-primary' : 'text-fg-subtle'}`} />
                  <span className="mt-2 text-xs font-bold text-fg truncate w-full">
                    {tpl.role}
                  </span>
                  <span className="mt-0.5 text-[10px] text-fg-muted line-clamp-1">
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
              <label htmlFor="agent-name-input" className="text-xs font-semibold text-fg">
                Agent Display Name
              </label>
              <input
                id="agent-name-input"
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. DeepSeek Reasoning Worker"
                required
                className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-xs text-fg outline-none focus:border-primary"
              />
            </div>

            <div>
              <label htmlFor="agent-role-input" className="text-xs font-semibold text-fg">
                Operational Role
              </label>
              <input
                id="agent-role-input"
                type="text"
                value={agentRole}
                onChange={(e) => setAgentRole(e.target.value)}
                placeholder="e.g. Compute Procurement"
                required
                className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-xs text-fg outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Keypair Generation & Wallet Association Mode Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-fg">
                Agent Wallet Provisioning
              </label>
              <div className="flex items-center gap-1.5 bg-card-muted p-0.5 rounded-lg border border-card-border">
                <button
                  type="button"
                  onClick={() => {
                    setWalletMode('generate');
                    if (!generatedPrivateKey) handleGenerateKeypair();
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                    walletMode === 'generate'
                      ? 'bg-card text-fg shadow-xs border border-card-border'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <Zap className="h-3 w-3 text-amber-500" />
                  <span>Generate Keypair</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWalletMode('import')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                    walletMode === 'import'
                      ? 'bg-card text-fg shadow-xs border border-card-border'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <Key className="h-3 w-3 text-primary" />
                  <span>Import Address</span>
                </button>
              </div>
            </div>

            {walletMode === 'generate' ? (
              <div className="rounded-2xl border border-card-border bg-card-muted/60 p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="agent-address-input" className="text-[11px] font-semibold text-fg">
                      Generated Agent Address (Monad EOA)
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateKeypair}
                      title="Regenerate new keypair"
                      className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary-hover font-medium cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Regenerate</span>
                    </button>
                  </div>
                  <input
                    id="agent-address-input"
                    type="text"
                    value={agentAddress}
                    readOnly
                    className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 font-mono text-xs text-fg outline-none select-all"
                  />
                </div>

                {/* Cryptographic Key Vault Card */}
                {generatedPrivateKey && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Key className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-[11px] font-bold text-amber-400">
                          Autonomous Agent Private Key
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setShowPrivateKey(!showPrivateKey)}
                          className="p-1 text-fg-muted hover:text-fg transition cursor-pointer rounded"
                          title={showPrivateKey ? 'Hide Private Key' : 'Show Private Key'}
                        >
                          {showPrivateKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyPrivateKey}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-card border border-card-border text-[10px] font-mono text-fg hover:border-primary transition cursor-pointer"
                        >
                          {copiedKey ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyEnv}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary text-white text-[10px] font-semibold hover:bg-primary-hover transition cursor-pointer shadow-xs"
                        >
                          {copiedEnv ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          <span>{copiedEnv ? 'Copied .env' : 'Copy .env'}</span>
                        </button>
                      </div>
                    </div>

                    <div className="font-mono text-[11px] bg-card/80 border border-card-border rounded-lg px-2.5 py-1.5 text-fg select-all break-all">
                      {showPrivateKey ? generatedPrivateKey : `${generatedPrivateKey.slice(0, 10)}••••••••••••••••••••••••••••••••••••••••••••••••${generatedPrivateKey.slice(-8)}`}
                    </div>

                    <div className="flex items-start gap-2 pt-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-fg-muted leading-relaxed">
                        <strong className="text-fg">Non-Custodial Safeguard:</strong> Derived client-side via Web Crypto. Never sent to any server. Copy this key into your bot's execution runtime (e.g. LangChain, ElizaOS, or Python worker).
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-1 border-t border-card-border/50">
                      <input
                        id="save-vault-checkbox"
                        type="checkbox"
                        checked={saveToVault}
                        onChange={(e) => setSaveToVault(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-card-border text-primary focus:ring-primary"
                      />
                      <label htmlFor="save-vault-checkbox" className="text-[10px] text-fg cursor-pointer select-none">
                        Save backup to this browser's local credentials vault
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="agent-address-input" className="text-xs font-semibold text-fg">
                    Agent Account Address
                  </label>
                  <span className="text-[11px] text-fg-subtle">Use an existing agent wallet</span>
                </div>
                <input
                  id="agent-address-input"
                  type="text"
                  value={agentAddress}
                  onChange={(e) => setAgentAddress(e.target.value)}
                  placeholder="0x..."
                  required
                  className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 font-mono text-xs text-fg outline-none focus:border-primary"
                />
              </div>
            )}
          </div>

          {/* Risk Invariant Controls */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-2xl border border-card-border bg-card-muted p-4">
            <div>
              <label htmlFor="max-per-tx-input" className="text-[11px] font-medium text-fg-muted">
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
                className="mt-1 w-full rounded-lg border border-card-border bg-card px-2 py-1 font-mono text-xs text-fg outline-none"
              />
            </div>

            <div>
              <label htmlFor="max-per-window-input" className="text-[11px] font-medium text-fg-muted">
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
                className="mt-1 w-full rounded-lg border border-card-border bg-card px-2 py-1 font-mono text-xs text-fg outline-none"
              />
            </div>

            <div>
              <label htmlFor="window-seconds-input" className="text-[11px] font-medium text-fg-muted">
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
                className="mt-1 w-full rounded-lg border border-card-border bg-card px-2 py-1 font-mono text-xs text-fg outline-none"
              />
            </div>

            <div>
              <label htmlFor="velocity-cap-input" className="text-[11px] font-medium text-fg-muted">
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
                className="mt-1 w-full rounded-lg border border-card-border bg-card px-2 py-1 font-mono text-xs text-fg outline-none"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <input
              id="whitelist-checkbox"
              type="checkbox"
              checked={whitelistEnabled}
              onChange={(e) => setWhitelistEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-card-border text-primary focus:ring-primary"
            />
            <label htmlFor="whitelist-checkbox" className="text-xs text-fg cursor-pointer">
              Enforce Merchant Whitelisting on Monad (Blocks unverified counterparty payments)
            </label>
          </div>

          {errorMessage && (
            <div className="flex items-center space-x-2 rounded-xl border border-danger/30 bg-danger-subtle p-3 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-card-border">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" leftIcon={<Plus className="h-4 w-4" />} loading={submitting} loadingLabel="Provisioning…">
              Provision & Commit Slot
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
