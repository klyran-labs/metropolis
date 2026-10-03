import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Key,
  Layers,
  Lock,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { configuration, networkLabel } from "../configuration";
import { request, toUserFacingError, useOrganizationWallets, type Agent } from "../api";
import { Badge, Button, Mono, TextField, truncateMiddle } from "../design-system";
import { useToast } from "./UndoToast";

export interface AgentOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (agent: Agent) => void;
}

type Step = "identity" | "architecture" | "policy" | "complete";

interface WorkloadPreset {
  id: string;
  name: string;
  description: string;
  maxPerTx: string;
  maxPerWindow: string;
  windowSeconds: number;
  maxVelocity: number;
}

const WORKLOAD_PRESETS: WorkloadPreset[] = [
  {
    id: "micro-inference",
    name: "Micro Inference",
    description: "LLM completions, prompt execution & scraping",
    maxPerTx: "10.00",
    maxPerWindow: "100.00",
    windowSeconds: 3600,
    maxVelocity: 50,
  },
  {
    id: "standard-autonomous",
    name: "Standard Autonomous",
    description: "Multi-step tool calling and API orchestration",
    maxPerTx: "50.00",
    maxPerWindow: "500.00",
    windowSeconds: 3600,
    maxVelocity: 20,
  },
  {
    id: "high-volume-trader",
    name: "High-Volume Trader",
    description: "DeFi arbitrage, liquidity management & swaps",
    maxPerTx: "250.00",
    maxPerWindow: "2000.00",
    windowSeconds: 3600,
    maxVelocity: 100,
  },
];

export function AgentOnboardingModal({
  open,
  onClose,
  onSuccess,
}: AgentOnboardingModalProps) {
  const { toast } = useToast();
  const wallets = useOrganizationWallets(open);
  const treasuryWallets = wallets.data ?? [];

  const [step, setStep] = useState<Step>("identity");
  const [label, setLabel] = useState("");
  const [environment, setEnvironment] = useState<"production" | "staging" | "devnet">("production");
  const [workloadCategory, setWorkloadCategory] = useState("inference");
  const [walletSource, setWalletSource] = useState<"sovereign" | "tba" | "external">("sovereign");
  const [linkedTreasuryAddress, setLinkedTreasuryAddress] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("standard-autonomous");
  const [customMaxPerTx, setCustomMaxPerTx] = useState("50.00");
  const [customMaxPerWindow, setCustomMaxPerWindow] = useState("500.00");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdAgent, setCreatedAgent] = useState<Agent | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [snippetTab, setSnippetTab] = useState<"env" | "python" | "typescript">("env");

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep("identity");
    setLabel("");
    setEnvironment("production");
    setWalletSource("sovereign");
    setLinkedTreasuryAddress("");
    setSelectedPreset("standard-autonomous");
    setErrorMessage("");
    setCreatedAgent(null);
    setCopiedSnippet(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  if (!open) return null;

  const handleNextFromIdentity = () => {
    if (!label.trim()) {
      setErrorMessage("Please enter an agent label or purpose.");
      return;
    }
    setErrorMessage("");
    setStep("architecture");
  };

  const handleNextFromArchitecture = () => {
    if (walletSource === "external" && !linkedTreasuryAddress) {
      setErrorMessage("Please select a treasury wallet to link.");
      return;
    }
    setErrorMessage("");
    setStep("policy");
  };

  const handleProvision = async () => {
    setSubmitting(true);
    setErrorMessage("");

    try {
      const payload =
        walletSource === "sovereign"
          ? {
              walletSource: "sovereign",
              label: label.trim(),
              environment,
              riskTier: "tier2_standard",
            }
          : walletSource === "tba"
            ? {
                walletSource: "sovereign",
                label: `${label.trim()} [Identity wallet]`,
                environment,
                riskTier: "tier2_standard",
              }
            : {
                walletSource: "external",
                address: linkedTreasuryAddress,
                label: label.trim(),
                environment,
                riskTier: "tier2_standard",
              };

      const result = await request<Agent>("/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setCreatedAgent(result);
      setStep("complete");
      toast({
        title: "Autonomous Agent Provisioned",
        message: `Agent ${truncateMiddle(result.address, 8, 4)} is registered and policy-active.`,
        tone: "success",
      });
      if (onSuccess) onSuccess(result);
    } catch (err) {
      setErrorMessage(toUserFacingError(err, "The autonomous agent could not be provisioned."));
    } finally {
      setSubmitting(false);
    }
  };

  const activePreset = WORKLOAD_PRESETS.find((p) => p.id === selectedPreset);

  const getEnvSnippet = () => {
    const agentAddr = createdAgent?.address ?? "0xYourAgentAddress";
    const guardAddr = configuration.contracts.agentWalletGuard ?? "0xAgentWalletGuardAddress";
    const rpc = configuration.rpcUrl || "http://127.0.0.1:8545";
    return `# AgentGuard Autonomous Agent Credentials
AGENT_SIGNER_ADDRESS=${agentAddr}
AGENT_GUARD_CONTRACT=${guardAddr}
MONAD_RPC_URL=${rpc}
MONAD_CHAIN_ID=${configuration.chainId}
AGENT_ENVIRONMENT=${environment}
AGENT_RISK_TIER=tier2_standard
`;
  };

  const getPythonSnippet = () => {
    const agentAddr = createdAgent?.address ?? "0xYourAgentAddress";
    const guardAddr = configuration.contracts.agentWalletGuard ?? "0xAgentWalletGuardAddress";
    return `from agentguard import AgentGuardClient, SpendRequest

client = AgentGuardClient(
    agent_address="${agentAddr}",
    guard_contract="${guardAddr}",
    rpc_url="${configuration.rpcUrl || "http://127.0.0.1:8545"}"
)

# Execute authorized x402 payment
receipt = client.settle_spend(
    merchant="0xa978bd5e4e...b464",
    amount_usdc=4.50,
    category="inference"
)
print("Payment confirmed:", receipt.transaction_hash)
`;
  };

  const getTypeScriptSnippet = () => {
    const agentAddr = createdAgent?.address ?? "0xYourAgentAddress";
    const guardAddr = configuration.contracts.agentWalletGuard ?? "0xAgentWalletGuardAddress";
    return `import { AgentGuardClient } from "@agentguard/sdk";

const client = new AgentGuardClient({
  agentAddress: "${agentAddr}",
  guardAddress: "${guardAddr}",
  rpcUrl: "${configuration.rpcUrl || "http://127.0.0.1:8545"}"
});

const receipt = await client.settleSpend({
  merchant: "0xa978bd5e4e...b464",
  amountUsdc: 4.50,
  category: "inference"
});
console.log("Receipt:", receipt.transactionHash);
`;
  };

  const handleCopyCode = () => {
    const code =
      snippetTab === "env"
        ? getEnvSnippet()
        : snippetTab === "python"
          ? getPythonSnippet()
          : getTypeScriptSnippet();
    void navigator.clipboard?.writeText(code);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== "complete") onClose();
      }}
    >
      <div
        className="modal-window agent-onboarding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-onboarding-title"
        ref={modalRef}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-text">
            <span className="modal-eyebrow">Fleet Governance · {networkLabel}</span>
            <h2 id="agent-onboarding-title">Provision Autonomous Agent</h2>
            <p>Create an agent with its own wallet and spending limits.</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stepper Indicator */}
        <div className="onboarding-stepper" role="tablist" aria-label="Provisioning steps">
          <div className={`stepper-step ${step === "identity" ? "active" : "completed"}`}>
            <span className="step-num">1</span>
            <span className="step-label">Identity</span>
          </div>
          <div className="stepper-line" />
          <div className={`stepper-step ${step === "architecture" ? "active" : step === "policy" || step === "complete" ? "completed" : ""}`}>
            <span className="step-num">2</span>
            <span className="step-label">Custody</span>
          </div>
          <div className="stepper-line" />
          <div className={`stepper-step ${step === "policy" ? "active" : step === "complete" ? "completed" : ""}`}>
            <span className="step-num">3</span>
            <span className="step-label">Policy</span>
          </div>
          <div className="stepper-line" />
          <div className={`stepper-step ${step === "complete" ? "active" : ""}`}>
            <span className="step-num">4</span>
            <span className="step-label">Deploy</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {errorMessage && (
            <div className="modal-error-banner" role="alert">
              <Shield size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* STEP 1: IDENTITY */}
          {step === "identity" && (
            <div className="step-container">
              <div className="form-group">
                <TextField
                  label="Agent Label or Identity"
                  placeholder="e.g. Research Assistant"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="input-group-label">Deployment Environment</label>
                <div className="radio-pill-group" role="radiogroup" aria-label="Environment">
                  {(["production", "staging", "devnet"] as const).map((env) => (
                    <button
                      key={env}
                      type="button"
                      role="radio"
                      aria-checked={environment === env}
                      className={`radio-pill ${environment === env ? "active" : ""}`}
                      onClick={() => setEnvironment(env)}
                    >
                      {env === "production" ? "Production" : env === "staging" ? "Staging" : "Devnet"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="input-group-label">Workload Category</label>
                <div className="workload-grid">
                  {[
                    { id: "inference", label: "LLM & Micro Inference", icon: <Cpu size={16} /> },
                    { id: "defi", label: "DeFi & Trading", icon: <Zap size={16} /> },
                    { id: "procurement", label: "Procurement & B2B", icon: <Wallet size={16} /> },
                    { id: "telemetry", label: "Oracle & Telemetry", icon: <Layers size={16} /> },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`workload-card ${workloadCategory === cat.id ? "active" : ""}`}
                      onClick={() => setWorkloadCategory(cat.id)}
                    >
                      <div className="workload-icon">{cat.icon}</div>
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: ARCHITECTURE & CUSTODY */}
          {step === "architecture" && (
            <div className="step-container">
              <div className="custody-options">
                <button
                  type="button"
                  className={`custody-card ${walletSource === "sovereign" ? "active" : ""}`}
                  onClick={() => setWalletSource("sovereign")}
                >
                  <div className="custody-head">
                    <div className="custody-icon accent-blue">
                      <Sparkles size={18} />
                    </div>
                    <div className="custody-title">
                      <strong>Secure wallet (hosted for you)</strong>
                      <span className="custody-tag">Recommended</span>
                    </div>
                  </div>
                  <p>
                    Autonomous private key is generated client-side and sealed inside a dedicated sovereign key vault.
                    Keys never touch the cloud or central servers.
                  </p>
                </button>

                <button
                  type="button"
                  className={`custody-card ${walletSource === "tba" ? "active" : ""}`}
                  onClick={() => setWalletSource("tba")}
                >
                  <div className="custody-head">
                    <div className="custody-icon accent-purple">
                      <ShieldCheck size={18} />
                    </div>
                    <div className="custody-title">
                      <strong>Agent identity wallet</strong>
                      <span className="custody-tag">Token Bound</span>
                    </div>
                  </div>
                  <p>
                    Binds the agent to a deterministic Token Bound Account (TBA) on Monad. Transfers of the passport NFT
                    seamlessly transfer fleet ownership.
                  </p>
                </button>

                <button
                  type="button"
                  className={`custody-card ${walletSource === "external" ? "active" : ""}`}
                  onClick={() => setWalletSource("external")}
                >
                  <div className="custody-head">
                    <div className="custody-icon accent-amber">
                      <Wallet size={18} />
                    </div>
                    <div className="custody-title">
                      <strong>Connected Treasury Multi-Sig</strong>
                      <span className="custody-tag">Enterprise Quorum</span>
                    </div>
                  </div>
                  <p>
                    Links directly to an existing organization multi-operator treasury wallet, requiring quorum approvals
                    for reloads and policy elevations.
                  </p>
                </button>
              </div>

              {walletSource === "external" && (
                <div className="treasury-select-box">
                  <label className="input-group-label">Select Organization Treasury Wallet</label>
                  {treasuryWallets.length > 0 ? (
                    <div className="treasury-options-list">
                      {treasuryWallets.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          className={`treasury-option ${linkedTreasuryAddress.toLowerCase() === w.address.toLowerCase() ? "active" : ""}`}
                          onClick={() => setLinkedTreasuryAddress(w.address)}
                        >
                          <div className="treasury-option-meta">
                            <strong>{w.label}</strong>
                            <Mono>{truncateMiddle(w.address, 10, 6)}</Mono>
                          </div>
                          <Badge tone="info">{w.kind === "sovereign" ? "Managed" : "Connected"}</Badge>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="modal-inline-empty">
                      <span>No treasury wallets registered yet. You can register one in the Treasury tab first.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: POLICY GUARDRAILS */}
          {step === "policy" && (
            <div className="step-container">
              <label className="input-group-label">Select Initial Spend Guardrail Preset</label>
              <div className="preset-grid">
                {WORKLOAD_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preset-card ${selectedPreset === preset.id ? "active" : ""}`}
                    onClick={() => {
                      setSelectedPreset(preset.id);
                      setCustomMaxPerTx(preset.maxPerTx);
                      setCustomMaxPerWindow(preset.maxPerWindow);
                    }}
                  >
                    <div className="preset-card-head">
                      <strong>{preset.name}</strong>
                      <span className="preset-badge">${preset.maxPerTx} / tx</span>
                    </div>
                    <p>{preset.description}</p>
                    <div className="preset-metrics">
                      <span>Window: ${preset.maxPerWindow} / hr</span>
                      <span>Velocity: {preset.maxVelocity} txs/window</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="policy-custom-row">
                <TextField
                  label="Max Spend Per Transaction (USDC)"
                  value={customMaxPerTx}
                  onChange={(e) => setCustomMaxPerTx(e.target.value)}
                />
                <TextField
                  label="Max Hourly Window Ceiling (USDC)"
                  value={customMaxPerWindow}
                  onChange={(e) => setCustomMaxPerWindow(e.target.value)}
                />
              </div>

              <div className="policy-assurance-note">
                <ShieldCheck size={16} />
                <span>
                  All spend thresholds will be verified onchain in $O(1)$ time by Monad Parallel EVM PolicyEngine.
                  Emergency kill switch is available 24/7.
                </span>
              </div>
            </div>
          )}

          {/* STEP 4: DEPLOY & COMPLETE */}
          {step === "complete" && createdAgent && (
            <div className="step-container complete-container">
              <div className="complete-hero">
                <div className="complete-icon">
                  <CheckCircle2 size={36} />
                </div>
                <h3>Autonomous Agent Provisioned</h3>
                <p>
                  Agent <Mono>{truncateMiddle(createdAgent.address, 10, 6)}</Mono> is registered and ready for execution.
                </p>
              </div>

              <div className="snippet-box">
                <div className="snippet-tabs">
                  <button
                    type="button"
                    className={`snippet-tab ${snippetTab === "env" ? "active" : ""}`}
                    onClick={() => setSnippetTab("env")}
                  >
                    .env Credentials
                  </button>
                  <button
                    type="button"
                    className={`snippet-tab ${snippetTab === "python" ? "active" : ""}`}
                    onClick={() => setSnippetTab("python")}
                  >
                    Python SDK
                  </button>
                  <button
                    type="button"
                    className={`snippet-tab ${snippetTab === "typescript" ? "active" : ""}`}
                    onClick={() => setSnippetTab("typescript")}
                  >
                    TypeScript SDK
                  </button>

                  <button
                    type="button"
                    className="snippet-copy-btn"
                    onClick={handleCopyCode}
                    title="Copy to clipboard"
                  >
                    {copiedSnippet ? <Check size={14} className="copy-success" /> : <Copy size={14} />}
                    <span>{copiedSnippet ? "Copied" : "Copy"}</span>
                  </button>
                </div>

                <pre className="snippet-code">
                  <code>
                    {snippetTab === "env"
                      ? getEnvSnippet()
                      : snippetTab === "python"
                        ? getPythonSnippet()
                        : getTypeScriptSnippet()}
                  </code>
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          {step === "identity" && (
            <>
              <Button variant="text" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleNextFromIdentity}>
                <span>Next: Key Custody</span>
                <ArrowRight size={14} />
              </Button>
            </>
          )}

          {step === "architecture" && (
            <>
              <Button variant="text" onClick={() => setStep("identity")}>
                <ArrowLeft size={14} />
                <span>Back</span>
              </Button>
              <Button onClick={handleNextFromArchitecture}>
                <span>Next: Spend Policy</span>
                <ArrowRight size={14} />
              </Button>
            </>
          )}

          {step === "policy" && (
            <>
              <Button variant="text" onClick={() => setStep("architecture")}>
                <ArrowLeft size={14} />
                <span>Back</span>
              </Button>
              <Button onClick={() => void handleProvision()} disabled={submitting}>
                <Sparkles size={14} />
                <span>{submitting ? "Creating agent…" : "Provision Agent"}</span>
              </Button>
            </>
          )}

          {step === "complete" && (
            <Button onClick={onClose}>
              <Check size={14} />
              <span>Done</span>
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
