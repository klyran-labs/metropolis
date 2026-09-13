import React, { useState, useEffect } from 'react';
import { type Address, parseEther, isAddress } from 'viem';
import {
  X,
  Plus,
  Bot,
  AlertCircle,
  Cpu,
  Globe,
  Database,
  DollarSign,
  RotateCcw,
  ShieldCheck,
  Coins,
} from 'lucide-react';
import { type SpendPolicy } from '@agentguard/shared-types';
import { Button } from '../common/Button';
import { useDashboard } from '../../context/DashboardContext';
import { OPENSIGNER_SERVICE_URL } from '../../config/env';

interface AgentOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisterAgent: (input: {
    name: string;
    role: string;
    policy: SpendPolicy;
    privateKey?: `0x${string}`;
    openSignerWalletId?: string;
    signerType?: 'web_crypto' | 'opensigner' | 'imported';
    saveToVault?: boolean;
    architecture?: 'EOA' | 'ERC1271' | 'EIP7702' | 'TBA';
    securityTier?: 'STANDARD' | 'TEE_ENCLAVE';
    gasMode?: 'SELF_FUNDED' | 'PAYMASTER_SPONSORED';
    initialFundingWei?: bigint;
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

import { formatWeb3ErrorMessage, formatVaultErrorMessage } from '../../utils/errors';

export const AgentOnboardingModal: React.FC<AgentOnboardingModalProps> = ({
  isOpen,
  onClose,
  onRegisterAgent,
}) => {
  const { balanceMon, fundDevnetWallet, isLocalDevnet, refreshBalance } = useDashboard();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0);
  const [agentName, setAgentName] = useState(AGENT_TEMPLATES[0].name);
  const [agentRole, setAgentRole] = useState(AGENT_TEMPLATES[0].role);
  const [openSignerUrl] = useState(OPENSIGNER_SERVICE_URL);
  const [openSignerStatus, setOpenSignerStatus] = useState<'checking' | 'connected' | 'unreachable'>('checking');
  const [openSignerWalletId, setOpenSignerWalletId] = useState<string | null>(null);
  const [isProvisioningOpenSigner, setIsProvisioningOpenSigner] = useState(false);
  const [initialFundingMon, setInitialFundingMon] = useState(() => (parseFloat(balanceMon) >= 0.1 ? '0.1' : '0'));

  useEffect(() => {
    if (parseFloat(balanceMon) < 0.1 && initialFundingMon === '0.1') {
      setInitialFundingMon('0');
    }
  }, [balanceMon, initialFundingMon]);

  const [agentAddress, setAgentAddress] = useState<string>('');

  const [maxPerTx, setMaxPerTx] = useState(AGENT_TEMPLATES[0].defaultMaxPerTx);
  const [maxPerWindow, setMaxPerWindow] = useState(AGENT_TEMPLATES[0].defaultMaxPerWindow);
  const [windowSeconds, setWindowSeconds] = useState(AGENT_TEMPLATES[0].defaultWindowSeconds.toString());
  const [maxVelocity, setMaxVelocity] = useState(AGENT_TEMPLATES[0].defaultVelocity.toString());
  const [whitelistEnabled, setWhitelistEnabled] = useState(AGENT_TEMPLATES[0].whitelistEnabled);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [architecture, setArchitecture] = useState<'EOA' | 'ERC1271' | 'EIP7702' | 'TBA'>('EOA');
  const [paymasterGasless, setPaymasterGasless] = useState(false);
  const [enclaveAttestation, setEnclaveAttestation] = useState(false);
  const [permitAtomic, setPermitAtomic] = useState(true);

  // Check OpenSigner container health
  const checkOpenSignerHealth = async () => {
    try {
      setOpenSignerStatus('checking');
      const res = await fetch(`${openSignerUrl}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        if (data.service === 'agentguard-opensigner') {
          setOpenSignerStatus('connected');
          return true;
        }
      }
      setOpenSignerStatus('unreachable');
      return false;
    } catch {
      setOpenSignerStatus('unreachable');
      return false;
    }
  };

  // Provision sealed wallet directly inside OpenSigner enclave
  const handleProvisionViaOpenSigner = async (nameOverride?: string) => {
    try {
      setIsProvisioningOpenSigner(true);
      setErrorMessage(null);
      const res = await fetch(`${openSignerUrl}/api/v1/wallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: nameOverride || agentName.trim() || 'Autonomous Agent' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to provision sealed keypair in sovereign key vault.');
      }
      setAgentAddress(data.wallet.address);
      setOpenSignerWalletId(data.wallet.walletId);
      setOpenSignerStatus('connected');
      return data.wallet;
    } catch (err: any) {
      setErrorMessage(formatVaultErrorMessage(err));
      setOpenSignerStatus('unreachable');
      return null;
    } finally {
      setIsProvisioningOpenSigner(false);
    }
  };

  // Reset step and check health on modal open (do NOT generate wallet eagerly)
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      setErrorMessage(null);
      checkOpenSignerHealth();
    }
  }, [isOpen]);

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

  // Step 1 Validation & JIT Keypair Generation
  const handleNextFromStep1 = async () => {
    setErrorMessage(null);
    if (!agentName.trim()) {
      setErrorMessage('Please enter an agent display name.');
      return;
    }
    if (!agentRole.trim()) {
      setErrorMessage('Please enter an operational role.');
      return;
    }
    // Just-in-time generation if user hasn't clicked generate yet
    if (!agentAddress || !openSignerWalletId) {
      const wallet = await handleProvisionViaOpenSigner(agentName.trim());
      if (!wallet) return;
    }
    setCurrentStep(2);
  };

  // Step 2 Validation (Risk Guardrails)
  const handleNextFromStep2 = () => {
    setErrorMessage(null);
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
    setCurrentStep(3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    let targetAddress = agentAddress.trim();
    let sealedWalletId = openSignerWalletId;

    // If wallet not yet provisioned, implicitly provision right now
    if (!targetAddress || !sealedWalletId) {
      setSubmitting(true);
      try {
        const wallet = await handleProvisionViaOpenSigner();
        if (!wallet) {
          throw new Error('Sovereign key vault could not be reached. Please ensure the vault service is connected and running.');
        }
        targetAddress = wallet.address;
        sealedWalletId = wallet.walletId;
      } catch (err: any) {
        setErrorMessage(err?.message || 'Failed to auto-provision sealed wallet in sovereign key vault');
        setSubmitting(false);
        return;
      }
    }

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

    // Validate and parse initial funding amount if provided
    const fundAmount = parseFloat(initialFundingMon);
    if (!isNaN(fundAmount) && fundAmount > 0) {
      const userBal = parseFloat(balanceMon);
      if (!isNaN(userBal) && fundAmount > userBal) {
        setErrorMessage(`Insufficient wallet balance (${balanceMon} MON) to fund ${fundAmount} MON.`);
        return;
      }
    }
    const initialFundingWei = !isNaN(fundAmount) && fundAmount > 0 ? parseEther(initialFundingMon) : undefined;

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
        openSignerWalletId: sealedWalletId || undefined,
        signerType: 'opensigner',
        saveToVault: true,
        architecture,
        securityTier: 'TEE_ENCLAVE',
        gasMode: paymasterGasless ? 'PAYMASTER_SPONSORED' : 'SELF_FUNDED',
        initialFundingWei,
      });
      onClose();
    } catch (error: any) {
      setErrorMessage(formatWeb3ErrorMessage(error));
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
      <div className="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-3xl border border-card-border bg-card p-5 sm:p-7 shadow-2xl">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-5 top-5 rounded-full p-1.5 text-fg-muted hover:bg-card-muted hover:text-fg transition cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 pb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-subtle text-primary shrink-0">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 id="modal-title" className="text-base font-bold text-fg">
              Provision New Autonomous Agent
            </h2>
            <p className="text-xs text-fg-muted">
              Bind an isolated policy partition with autonomous spend guardrails on Monad.
            </p>
          </div>
        </div>

        {/* Stepper Progress Bar */}
        <div className="flex items-center justify-between border-y border-card-border py-2.5 my-3">
          <div className="flex items-center gap-2 sm:gap-3">
            {[
              { num: 1, label: 'Identity & Vault' },
              { num: 2, label: 'Risk Guardrails' },
              { num: 3, label: 'Settlement & Funding' },
            ].map((step, idx) => {
              const isActive = currentStep === step.num;
              const isPast = currentStep > step.num;
              return (
                <React.Fragment key={step.num}>
                  {idx > 0 && (
                    <div
                      className={`h-0.5 w-4 sm:w-8 transition-colors ${
                        isPast ? 'bg-primary' : 'bg-card-border'
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (step.num < currentStep) {
                        setErrorMessage(null);
                        setCurrentStep(step.num as any);
                      }
                    }}
                    disabled={step.num > currentStep}
                    className={`flex items-center gap-1.5 text-xs font-semibold transition ${
                      isActive
                        ? 'text-primary'
                        : isPast
                        ? 'text-fg cursor-pointer hover:text-primary'
                        : 'text-fg-subtle cursor-not-allowed'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                        isActive
                          ? 'bg-primary text-white shadow-xs'
                          : isPast
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'bg-card-muted text-fg-subtle border border-card-border'
                      }`}
                    >
                      {isPast ? '✓' : step.num}
                    </span>
                    <span className="hidden sm:inline">{step.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          <span className="text-[11px] font-mono text-fg-muted">
            Step {currentStep} of 3
          </span>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto pr-1 space-y-4">
          {/* STEP 1: Identity & Key Vault */}
          {currentStep === 1 && (
            <div className="space-y-4">
              {/* Template Selector Grid */}
              <div>
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

              {/* Name & Role */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

              {/* Sovereign Key Vault Provisioning Card */}
              <div className="rounded-2xl border border-card-border bg-card-muted/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-bold text-fg">Sovereign Key Vault</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        openSignerStatus === 'connected'
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                          : openSignerStatus === 'checking' || isProvisioningOpenSigner
                          ? 'bg-amber-400 animate-pulse'
                          : 'bg-red-400'
                      }`}
                    />
                    <span className="text-[10px] font-mono text-fg-muted">
                      {isProvisioningOpenSigner
                        ? 'Sealing Keypair...'
                        : openSignerStatus === 'connected'
                        ? 'Vault Connected'
                        : openSignerStatus === 'checking'
                        ? 'Connecting...'
                        : 'Vault Offline'}
                    </span>
                  </div>
                </div>

                {isProvisioningOpenSigner ? (
                  <div className="flex items-center gap-3 p-3.5 rounded-xl border border-card-border bg-card">
                    <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                    <div className="text-xs text-fg">
                      <span className="font-semibold">Provisioning Sealed Keypair in Enclave...</span>
                      <p className="text-[11px] text-fg-muted mt-0.5">
                        Generating entropy and sealing key with zero human or browser exposure
                      </p>
                    </div>
                  </div>
                ) : agentAddress && openSignerWalletId ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        Sealed Agent Address (Monad EOA)
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-fg-muted">
                          ID: {openSignerWalletId}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleProvisionViaOpenSigner(agentName.trim())}
                          title="Generate new sealed keypair"
                          className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary-hover font-medium cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Rotate</span>
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={agentAddress}
                      readOnly
                      className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 font-mono text-xs text-fg outline-none select-all"
                    />
                    <div className="flex items-start gap-2 pt-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-fg-muted leading-relaxed">
                        <strong className="text-fg">Implicit Enclave Sealing:</strong> The private key is cryptographically sealed in the sovereign AES-256-GCM vault and is never exposed to disk, human operators, or prompt injection.
                      </p>
                    </div>
                  </div>
                ) : openSignerStatus === 'unreachable' ? (
                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-card-border bg-card">
                    <div className="flex items-center gap-2.5">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="text-xs text-fg-muted">
                        Sovereign key vault service is unavailable. Connect the service to provision sealed keys.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        checkOpenSignerHealth().then((isUp) => {
                          if (isUp) handleProvisionViaOpenSigner(agentName.trim());
                        });
                      }}
                      className="text-xs font-semibold text-primary hover:text-primary-hover underline shrink-0 cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-card-border bg-card">
                    <div className="text-xs pr-2">
                      <div className="font-semibold text-fg">Sealed Keypair Required</div>
                      <p className="text-[11px] text-fg-muted">Generate a hardware-sealed keypair or continue to auto-provision.</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleProvisionViaOpenSigner(agentName.trim())}
                      leftIcon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
                    >
                      Generate Sealed Keypair
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Risk Guardrails */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                  Autonomous Spend Ceilings & Velocity
                </h3>
                <p className="text-xs text-fg-muted mt-0.5">
                  Configure real-time policy rules evaluated in sub-50µs by Monad Parallel EVM.
                </p>
              </div>

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

              <div className="flex items-center space-x-2 rounded-xl border border-card-border bg-card p-3">
                <input
                  id="whitelist-checkbox"
                  type="checkbox"
                  checked={whitelistEnabled}
                  onChange={(e) => setWhitelistEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-card-border text-primary focus:ring-primary"
                />
                <label htmlFor="whitelist-checkbox" className="text-xs text-fg cursor-pointer select-none">
                  Enforce Merchant Whitelisting on Monad (Blocks unverified counterparty payments)
                </label>
              </div>
            </div>
          )}

          {/* STEP 3: Settlement & Funding */}
          {currentStep === 3 && (
            <div className="space-y-4">
              {/* Architecture Selector */}
              <div className="rounded-2xl border border-card-border bg-card-muted/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-fg">Account Architecture & Signer Interface</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    Standards-Aligned
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'EOA', label: 'EOA Keypair', desc: 'Standard EIP-712' },
                    { id: 'ERC1271', label: 'ERC-1271', desc: 'Smart Contract' },
                    { id: 'EIP7702', label: 'EIP-7702', desc: 'Delegated EOA' },
                    { id: 'TBA', label: 'EIP-6551', desc: 'Token Bound TBA' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setArchitecture(item.id as any)}
                      className={`p-2 rounded-xl text-left border transition cursor-pointer ${
                        architecture === item.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-card-border bg-card text-fg-muted hover:text-fg'
                      }`}
                    >
                      <div className="text-[11px] font-bold">{item.label}</div>
                      <div className="text-[9px] text-fg-subtle">{item.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Feature Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-card-border/60">
                  <label className="flex items-center space-x-2 text-xs text-fg cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={paymasterGasless}
                      onChange={(e) => setPaymasterGasless(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-card-border text-primary focus:ring-primary"
                    />
                    <span className="text-[11px]">ERC-7677 Gasless Paymaster</span>
                  </label>

                  <label className="flex items-center space-x-2 text-xs text-fg cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={enclaveAttestation}
                      onChange={(e) => setEnclaveAttestation(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-card-border text-primary focus:ring-primary"
                    />
                    <span className="text-[11px]">Hardware TEE Enclave Attested</span>
                  </label>

                  <label className="flex items-center space-x-2 text-xs text-fg cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={permitAtomic}
                      onChange={(e) => setPermitAtomic(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-card-border text-primary focus:ring-primary"
                    />
                    <span className="text-[11px]">EIP-2612 Atomic Permit (1-Tx)</span>
                  </label>
                </div>
              </div>

              {/* Initial Agent Funding */}
              <div className="rounded-2xl border border-card-border bg-card-muted/50 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-amber-500" />
                    <span className="text-xs font-bold text-fg">Initial Agent Funding (Native MON)</span>
                  </div>
                  <span className="text-[11px] font-mono text-fg-muted">
                    Your Balance: <strong className="text-fg">{balanceMon} MON</strong>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      value={initialFundingMon}
                      onChange={(e) => setInitialFundingMon(e.target.value)}
                      placeholder="0.0"
                      className="w-full rounded-xl border border-card-border bg-card px-3 py-2 pr-14 font-mono text-xs text-fg outline-none focus:border-primary"
                    />
                    <span className="absolute right-3 top-2 text-[11px] font-mono text-fg-muted">MON</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {['0', '0.1', '0.5', '1.0', '2.5'].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setInitialFundingMon(val)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition border cursor-pointer ${
                          initialFundingMon === val
                            ? 'border-primary bg-primary text-white font-semibold'
                            : 'border-card-border bg-card text-fg-muted hover:text-fg'
                        }`}
                      >
                        {val === '0' ? 'None' : `${val}`}
                      </button>
                    ))}
                  </div>
                </div>

                {parseFloat(balanceMon) === 0 && (
                  <div className="flex items-center justify-between p-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-400">
                    <span>Connected account needs MON to pay network gas fees.</span>
                    {isLocalDevnet && (
                      <button
                        type="button"
                        onClick={async () => {
                          await fundDevnetWallet();
                          await refreshBalance();
                          setErrorMessage(null);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-[11px] transition cursor-pointer"
                      >
                        Claim Devnet Gas
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Summary Review Capsule */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span className="text-fg font-medium">Ready to commit to Monad Parallel EVM</span>
                </div>
                <div className="text-[11px] font-mono text-fg-muted">
                  Cap: <strong className="text-fg">{maxPerTx} MON</strong> | Window: <strong className="text-fg">{maxPerWindow} MON</strong>
                </div>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="rounded-xl border border-danger/30 bg-danger-subtle p-3 text-xs text-danger space-y-2">
              <div className="flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              {isLocalDevnet && errorMessage.includes('Insufficient MON') && (
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      await fundDevnetWallet();
                      await refreshBalance();
                      setErrorMessage(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-[11px] font-semibold transition cursor-pointer"
                  >
                    Claim Local Devnet Gas (100 MON)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Fixed Footer Navigation Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-card-border">
            <div>
              {currentStep > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setErrorMessage(null);
                    setCurrentStep((prev) => (prev - 1) as any);
                  }}
                  disabled={submitting || isProvisioningOpenSigner}
                >
                  ← Back
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {currentStep === 1 && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleNextFromStep1}
                  loading={isProvisioningOpenSigner}
                  loadingLabel="Sealing..."
                >
                  Continue to Risk Policy →
                </Button>
              )}

              {currentStep === 2 && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleNextFromStep2}
                >
                  Continue to Settlement →
                </Button>
              )}

              {currentStep === 3 && (
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  loading={submitting}
                  loadingLabel="Provisioning…"
                >
                  Provision & Commit Slot
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
