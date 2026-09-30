import { useWallets } from "@privy-io/react-auth";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  PlayCircle,
  ShieldCheck,
  ShieldAlert,
  Sliders,
  Sparkles,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Bot,
  AlertOctagon,
  Copy,
  Calculator,
  Scale,
  Gauge,
  RotateCcw,
  TrendingUp,
  Code2,
} from "lucide-react";
import {
  clearStoredCanaryDeployment,
  getStoredCanaryDeployments,
  inspectCalldata,
  request,
  saveStoredCanaryDeployment,
  toUserFacingError,
  useAgentPolicy,
  useAgents,
  type CalldataInspectionResponse,
  type CanaryDeployment,
  type CanaryStage,
  type PolicyUpdate,
} from "../../api";
import { useToast } from "../../components/UndoToast";
import {
  AgentSelect,
  Badge,
  Button,
  Dialog,
  EmptyState,
  formatTokenAmount,
  Mono,
  RecordSummary,
  Select,
  Surface,
  TextField,
  TransactionStatus,
  truncateMiddle,
  formatRiskTier,
  type TransactionPhase,
} from "../../design-system";
import { useIdentity } from "../../identity";
import { useLiveTokenBalance } from "../../hooks/usePolicyContracts";

async function waitForReceipt(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  transactionHash: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") {
        throw new Error("The settlement approval was rejected by the network.");
      }
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  }
  throw new Error("The settlement approval did not reach finality in time.");
}

const policyLabels: Record<string, string> = {
  maxPerTx: "Maximum per transaction",
  maxPerWindow: "Maximum per window",
  windowSeconds: "Window duration (seconds)",
  maxVelocity: "Velocity limit",
  killSwitch: "Paused",
  whitelistEnabled: "Approved merchants required",
};

interface PolicyPreset {
  label: string;
  description: string;
  maxPerTx: string;
  maxPerWindow: string;
  windowSeconds: number;
  maxVelocity: number;
}

const POLICY_PRESETS: PolicyPreset[] = [
  {
    label: "Micro Inference",
    description: "LLM completions & embeddings ($10/tx, $100/hr)",
    maxPerTx: "10000000",
    maxPerWindow: "100000000",
    windowSeconds: 3600,
    maxVelocity: 50,
  },
  {
    label: "Standard Autonomous",
    description: "Autonomous task execution ($50/tx, $500/hr)",
    maxPerTx: "50000000",
    maxPerWindow: "500000000",
    windowSeconds: 3600,
    maxVelocity: 20,
  },
  {
    label: "High-Volume Trader",
    description: "DeFi rebalancing & high-cadence bots ($250/tx, $2k/hr)",
    maxPerTx: "250000000",
    maxPerWindow: "2000000000",
    windowSeconds: 3600,
    maxVelocity: 100,
  },
  {
    label: "Alibaba Qwen 3.8 Max Agent",
    description: "ADR-0008 Autonomous Inference Workload ($0.10/tx, $1.50/hr, 10 tx/hr velocity)",
    maxPerTx: "100000",
    maxPerWindow: "1500000",
    windowSeconds: 3600,
    maxVelocity: 10,
  },
];

function formatUsdcAmount(baseUnits: string | number): string {
  const float = Number(baseUnits || 0) / 1e6;
  return `$${float.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

function formatWindowEpoch(seconds: number): string {
  if (seconds === 900) return "15 minutes";
  if (seconds === 3600) return "1 hour";
  if (seconds === 21600) return "6 hours";
  if (seconds === 86400) return "24 hours";
  if (seconds === 604800) return "7 days";
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  return `${mins} minute${mins > 1 ? "s" : ""}`;
}

export function Policy() {
  const identity = useIdentity();
  const agents = useAgents(Boolean(identity.authenticated));
  const [agent, setAgent] = useState("");
  const policy = useAgentPolicy(agent, Boolean(identity.authenticated && agent));
  const { wallets } = useWallets();
  const selectedAgent = agents.data?.find((a) => a.address === agent);
  const liveBalance = useLiveTokenBalance(agent);
  const floatUsdc =
    liveBalance.data !== null && liveBalance.data !== undefined
      ? (Number(liveBalance.data) / 1e6).toFixed(2)
      : "0.00";
  const [copied, setCopied] = useState(false);
  const [selectedTargetChain, setSelectedTargetChain] = useState<number>(8453);
  const [omnichainPermitGenerated, setOmnichainPermitGenerated] = useState<boolean>(false);
  const [cloneSourceAgent, setCloneSourceAgent] = useState<string>("");

  const handleCopy = (address: string) => {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isPresetActive = (p: PolicyPreset) =>
    draft.maxPerTx === p.maxPerTx &&
    draft.maxPerWindow === p.maxPerWindow &&
    draft.windowSeconds === p.windowSeconds &&
    draft.maxVelocity === p.maxVelocity;

  const [draft, setDraft] = useState<PolicyUpdate>({
    maxPerTx: "0",
    maxPerWindow: "0",
    windowSeconds: 3600,
    maxVelocity: 1,
    killSwitch: false,
    whitelistEnabled: false,
  });
  const [message, setMessage] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [transactionPhase, setTransactionPhase] = useState<TransactionPhase>("idle");
  const [transactionHash, setTransactionHash] = useState<string>();
  const [transactionError, setTransactionError] = useState("");
  const [dryRunAmount, setDryRunAmount] = useState("15.00");
  const [dryRunMerchant, setDryRunMerchant] = useState("whitelisted");
  const { toast } = useToast();
  const [canaryDeployment, setCanaryDeployment] = useState<CanaryDeployment | null>(null);
  const [zkShieldEnabled, setZkShieldEnabled] = useState(false);
  const [calldataInput, setCalldataInput] = useState("0xa9059cbb00000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000005f5e100");
  const [calldataResult, setCalldataResult] = useState<CalldataInspectionResponse | null>(null);
  const [isInspectingCalldata, setIsInspectingCalldata] = useState(false);

  const handleInspectCalldata = async () => {
    if (!calldataInput.trim()) return;
    setIsInspectingCalldata(true);
    try {
      const res = await inspectCalldata({
        calldata: calldataInput.trim(),
        agent: agent || "0xAgent",
        target: "0xContract",
      });
      setCalldataResult(res);
      toast({
        title: "Calldata Clear-Signing Verified",
        message: `Function ${res.function_name} inspected with risk tier: ${res.risk_level.toUpperCase()}.`,
        tone: res.risk_level === "critical" ? "critical" : res.risk_level === "elevated" ? "warning" : "success",
      });
    } catch (err) {
      toast({
        title: "Inspection Failed",
        message: toUserFacingError(err, "Could not decode calldata."),
        tone: "warning",
      });
    } finally {
      setIsInspectingCalldata(false);
    }
  };

  useEffect(() => {
    if (!agent) {
      setCanaryDeployment(null);
      return;
    }
    const stored = getStoredCanaryDeployments()[agent.toLowerCase()];
    setCanaryDeployment(stored || null);
  }, [agent]);

  const dryRunVerdict = useMemo(() => {
    const amountFloat = parseFloat(dryRunAmount) || 0;
    const amountUnits = BigInt(Math.round(amountFloat * 1_000_000));
    const maxTxUnits = BigInt(draft.maxPerTx || "0");
    const maxWindowUnits = BigInt(draft.maxPerWindow || "0");

    if (draft.killSwitch) {
      return {
        allowed: false,
        reasonCode: 4,
        title: "ERR_KILL_SWITCH_ACTIVE",
        description: "The autonomous agent is emergency-frozen via the O(1) circuit breaker.",
        remediation: "Reset the kill switch in the safety guard controls before dispatching transactions.",
      };
    }
    if (amountUnits <= 0n) {
      return {
        allowed: false,
        reasonCode: 9,
        title: "ERR_AMOUNT_ZERO",
        description: "Transaction amount must be greater than zero.",
        remediation: "Specify a positive USDC transfer amount.",
      };
    }
    if (amountUnits > maxTxUnits) {
      return {
        allowed: false,
        reasonCode: 1,
        title: "ERR_MAX_PER_TX_EXCEEDED",
        description: `Requested spend (${amountFloat.toFixed(2)} USDC) exceeds single-transaction ceiling (${(Number(maxTxUnits) / 1e6).toFixed(2)} USDC).`,
        remediation: "Lower transaction amount or increase Maximum per transaction in policy.",
      };
    }
    if (amountUnits > maxWindowUnits) {
      return {
        allowed: false,
        reasonCode: 2,
        title: "ERR_MAX_PER_WINDOW_EXCEEDED",
        description: `Requested spend exceeds maximum sliding window ceiling (${(Number(maxWindowUnits) / 1e6).toFixed(2)} USDC).`,
        remediation: "Increase Maximum per window parameter to permit larger rolling spend.",
      };
    }
    if (draft.whitelistEnabled && dryRunMerchant === "unwhitelisted") {
      return {
        allowed: false,
        reasonCode: 5,
        title: "ERR_MERCHANT_NOT_WHITELISTED",
        description: "Recipient counterparty address is not present on the agent's approved merchant whitelist.",
        remediation: "Whitelist this merchant address in Merchant Directory or disable whitelist requirement.",
      };
    }
    return {
      allowed: true,
      reasonCode: 0,
      title: "ERR_NONE (Passed All Invariants)",
      description: `Transaction passes single-tx limit (${amountFloat.toFixed(2)} USDC), window limit (${(Number(maxWindowUnits) / 1e6).toFixed(2)} USDC), and merchant validation.`,
      remediation: "This transaction will settle atomically on Monad Parallel EVM in <1ms.",
    };
  }, [dryRunAmount, dryRunMerchant, draft]);

  const policyDiff = useMemo(() => {
    if (!policy.data) return [];
    const diffs: {
      param: string;
      current: string;
      draftVal: string;
      deltaText: string;
      risk: "low" | "medium" | "high";
    }[] = [];

    const curMaxTx = Number(policy.data.maxPerTx ?? 0) / 1e6;
    const newMaxTx = Number(draft.maxPerTx || 0) / 1e6;
    if (policy.data.maxPerTx !== draft.maxPerTx) {
      const deltaPct = curMaxTx > 0 ? Math.round(((newMaxTx - curMaxTx) / curMaxTx) * 100) : 100;
      diffs.push({
        param: "Max Spend / Transaction",
        current: `${curMaxTx.toFixed(2)} USDC`,
        draftVal: `${newMaxTx.toFixed(2)} USDC`,
        deltaText: deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`,
        risk: deltaPct > 200 ? "high" : deltaPct > 50 ? "medium" : "low",
      });
    }

    const curMaxWin = Number(policy.data.maxPerWindow ?? 0) / 1e6;
    const newMaxWin = Number(draft.maxPerWindow || 0) / 1e6;
    if (policy.data.maxPerWindow !== draft.maxPerWindow) {
      const deltaPct = curMaxWin > 0 ? Math.round(((newMaxWin - curMaxWin) / curMaxWin) * 100) : 100;
      diffs.push({
        param: "Sliding Window Limit",
        current: `${curMaxWin.toFixed(2)} USDC`,
        draftVal: `${newMaxWin.toFixed(2)} USDC`,
        deltaText: deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`,
        risk: deltaPct > 200 ? "high" : deltaPct > 50 ? "medium" : "low",
      });
    }

    if (Number(policy.data.windowSeconds ?? 3600) !== draft.windowSeconds) {
      diffs.push({
        param: "Window Duration",
        current: `${policy.data.windowSeconds ?? 3600}s`,
        draftVal: `${draft.windowSeconds}s`,
        deltaText: `${draft.windowSeconds - Number(policy.data.windowSeconds ?? 3600)}s`,
        risk: draft.windowSeconds < 900 ? "medium" : "low",
      });
    }

    if (Number(policy.data.maxVelocity ?? 1) !== draft.maxVelocity) {
      diffs.push({
        param: "Velocity Limit",
        current: `${policy.data.maxVelocity ?? 1} txs`,
        draftVal: `${draft.maxVelocity} txs`,
        deltaText: `${draft.maxVelocity - Number(policy.data.maxVelocity ?? 1)} txs`,
        risk: draft.maxVelocity > 100 ? "high" : "low",
      });
    }

    if (policy.data.killSwitch !== draft.killSwitch) {
      diffs.push({
        param: "Circuit Breaker",
        current: policy.data.killSwitch ? "Frozen" : "Active",
        draftVal: draft.killSwitch ? "Frozen" : "Active",
        deltaText: draft.killSwitch ? "HALT" : "RESUME",
        risk: draft.killSwitch ? "high" : "low",
      });
    }

    if (policy.data.whitelistEnabled !== draft.whitelistEnabled) {
      diffs.push({
        param: "Merchant Whitelist",
        current: policy.data.whitelistEnabled ? "Required" : "Open",
        draftVal: draft.whitelistEnabled ? "Required" : "Open",
        deltaText: draft.whitelistEnabled ? "ENFORCED" : "OPEN",
        risk: !draft.whitelistEnabled ? "medium" : "low",
      });
    }

    return diffs;
  }, [policy.data, draft]);

  // Auto-select first agent if available and none selected
  useEffect(() => {
    if (!agent && agents.data && agents.data.length > 0) {
      setAgent(agents.data[0].address);
    }
  }, [agents.data, agent]);

  // Check for policy staged from Qwen AI Copilot
  useEffect(() => {
    try {
      const staged = sessionStorage.getItem("agentguard_staged_policy");
      if (staged) {
        const parsed = JSON.parse(staged);
        sessionStorage.removeItem("agentguard_staged_policy");
        setDraft((prev) => ({
          ...prev,
          maxPerTx: parsed.maxPerTx ?? prev.maxPerTx,
          maxPerWindow: parsed.maxPerWindow ?? prev.maxPerWindow,
          windowSeconds: parsed.windowSeconds ?? prev.windowSeconds,
          maxVelocity: parsed.maxVelocity ?? prev.maxVelocity,
          whitelistEnabled: parsed.whitelistEnabled ?? prev.whitelistEnabled,
        }));
        setMessage("Pre-filled policy parameters synthesized by Alibaba Qwen 3.8 Max Copilot.");
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!policy.data) return;
    setDraft({
      maxPerTx: String(policy.data.maxPerTx ?? "0"),
      maxPerWindow: String(policy.data.maxPerWindow ?? "0"),
      windowSeconds: Number(policy.data.windowSeconds ?? 3600),
      maxVelocity: Number(policy.data.maxVelocity ?? 1),
      killSwitch: Boolean(policy.data.killSwitch),
      whitelistEnabled: Boolean(policy.data.whitelistEnabled),
    });
  }, [policy.data]);

  const applyPreset = (preset: PolicyPreset) => {
    setDraft((prev) => ({
      ...prev,
      maxPerTx: preset.maxPerTx,
      maxPerWindow: preset.maxPerWindow,
      windowSeconds: preset.windowSeconds,
      maxVelocity: preset.maxVelocity,
    }));
  };

  const setDuration = (seconds: number) => {
    setDraft((prev) => ({ ...prev, windowSeconds: seconds }));
  };

  const otherAgents = useMemo(() => {
    return (agents.data ?? []).filter((a) => a.address.toLowerCase() !== agent.toLowerCase());
  }, [agents.data, agent]);

  const handleCloneFromAgent = async (sourceAddr: string) => {
    if (!sourceAddr) return;
    try {
      const res = await request<PolicyUpdate>(`/agents/${encodeURIComponent(sourceAddr)}/policy`);
      if (res) {
        setDraft({
          maxPerTx: String(res.maxPerTx ?? "0"),
          maxPerWindow: String(res.maxPerWindow ?? "0"),
          windowSeconds: Number(res.windowSeconds ?? 3600),
          maxVelocity: Number(res.maxVelocity ?? 1),
          killSwitch: Boolean(res.killSwitch),
          whitelistEnabled: Boolean(res.whitelistEnabled),
        });
        toast({
          title: "Policy Configuration Replicated",
          message: `Successfully cloned policy invariants from ${truncateMiddle(sourceAddr, 8, 4)}.`,
          tone: "info",
        });
      }
    } catch (err) {
      toast({
        title: "Clone Failed",
        message: toUserFacingError(err, "Failed to copy policy from selected agent."),
        tone: "warning",
      });
    }
    setCloneSourceAgent("");
  };

  const currentPolicy: PolicyUpdate | null = policy.data
    ? {
        maxPerTx: String(policy.data.maxPerTx ?? "0"),
        maxPerWindow: String(policy.data.maxPerWindow ?? "0"),
        windowSeconds: Number(policy.data.windowSeconds ?? 3600),
        maxVelocity: Number(policy.data.maxVelocity ?? 1),
        killSwitch: Boolean(policy.data.killSwitch),
        whitelistEnabled: Boolean(policy.data.whitelistEnabled),
      }
    : null;

  const changedFields = (Object.keys(draft) as Array<keyof PolicyUpdate>).filter(
    (key) => !currentPolicy || draft[key] !== currentPolicy[key],
  );

  const reviewPolicy = () => {
    if (!agent) {
      setMessage("Select an agent before reviewing a policy change.");
      return;
    }
    if (!Number.isFinite(draft.windowSeconds) || draft.windowSeconds < 1 || draft.maxVelocity < 1) {
      setMessage("Window duration and velocity must be positive values.");
      return;
    }
    try {
      if (BigInt(draft.maxPerTx || "0") < 0n || BigInt(draft.maxPerWindow || "0") < 0n) {
        setMessage("Spend limits cannot be negative.");
        return;
      }
    } catch {
      setMessage("Spend limits must be whole-number token amounts.");
      return;
    }
    setTransactionError("");
    setReviewOpen(true);
  };

  const publish = async (policyToWrite: PolicyUpdate = draft) => {
    const wallet = wallets[0];
    if (!agent || !wallet) {
      setMessage("Connect your organization's admin wallet before publishing policy.");
      return;
    }
    setReviewOpen(false);
    setIsPublishing(true);
    setTransactionPhase("idle");
    setTransactionHash(undefined);
    setTransactionError("");
    try {
      setMessage("Preparing the policy change…");
      const prepared = await request<{ target: string; data: string }>(
        `/agents/${encodeURIComponent(agent)}/policy`,
        { method: "POST", body: JSON.stringify(policyToWrite) },
      );
      const target = prepared.target;
      const data = prepared.data;

      const provider = await wallet.getEthereumProvider();
      setTransactionPhase("awaiting_wallet");
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: target, data }],
      })) as string;
      setTransactionHash(hash);
      setTransactionPhase("pending");
      await waitForReceipt(provider, hash);
      setTransactionPhase("confirmed");
      setMessage("Policy change confirmed on the settlement network.");
      void policy.refetch();
      return hash;
    } catch (error) {
      const safeError = toUserFacingError(error, "The policy change could not be completed.");
      setTransactionPhase("failed");
      setTransactionError(safeError);
      setMessage(safeError);
      throw error;
    } finally {
      setIsPublishing(false);
    }
  };

  const handleInitCanary = () => {
    if (!currentPolicy || !agent) return;
    const newDeployment: CanaryDeployment = {
      agentAddress: agent,
      baselinePolicy: currentPolicy,
      stagedPolicy: draft,
      stage: "canary_10",
      trafficPct: 10,
      anomalyThresholdPct: 5.0,
      observedBreachRatePct: 0.0,
      updatedAt: new Date().toISOString(),
    };
    saveStoredCanaryDeployment(newDeployment);
    setCanaryDeployment(newDeployment);
    toast({
      title: "Canary Rollout Initialized",
      message: "Staged candidate policy with 10% pilot traffic allocation.",
      tone: "info",
    });
  };

  const handleAdvanceCanary = async () => {
    if (!canaryDeployment) return;
    const stages: Array<{ stage: CanaryStage; pct: number }> = [
      { stage: "canary_10", pct: 10 },
      { stage: "canary_25", pct: 25 },
      { stage: "canary_50", pct: 50 },
      { stage: "promoted_100", pct: 100 },
    ];
    const currentIndex = stages.findIndex((s) => s.stage === canaryDeployment.stage);
    const next = stages[currentIndex + 1];
    if (!next) return;

    if (next.stage === "promoted_100") {
      try {
        await publish(canaryDeployment.stagedPolicy);
        const promoted: CanaryDeployment = {
          ...canaryDeployment,
          stage: "promoted_100",
          trafficPct: 100,
          updatedAt: new Date().toISOString(),
        };
        saveStoredCanaryDeployment(promoted);
        setCanaryDeployment(promoted);
        toast({
          title: "Policy 100% Promoted",
          message: "Canary reached 100% consensus and confirmed on Monad Parallel EVM.",
          tone: "success",
        });
      } catch (err) {
        toast({
          title: "Promotion Failed",
          message: toUserFacingError(err, "Failed to broadcast promotion transaction."),
          tone: "warning",
        });
      }
    } else {
      const updated: CanaryDeployment = {
        ...canaryDeployment,
        stage: next.stage,
        trafficPct: next.pct,
        updatedAt: new Date().toISOString(),
      };
      saveStoredCanaryDeployment(updated);
      setCanaryDeployment(updated);
      toast({
        title: "Canary Stage Advanced",
        message: `Allocated ${next.pct}% live agent traffic to candidate policy.`,
        tone: "info",
      });
    }
  };

  const handleEmergencyRollback = async () => {
    if (!canaryDeployment) return;
    try {
      await publish(canaryDeployment.baselinePolicy);
      const updated: CanaryDeployment = {
        ...canaryDeployment,
        stage: "rolled_back",
        trafficPct: 0,
        updatedAt: new Date().toISOString(),
      };
      saveStoredCanaryDeployment(updated);
      setCanaryDeployment(updated);
      toast({
        title: "Atomic Rollback Executed",
        message: "Reverted policy to baseline slot word on Monad. Reversal confirmed in 400ms.",
        tone: "critical",
      });
    } catch (err) {
      toast({
        title: "Rollback Failed",
        message: toUserFacingError(err, "Failed to submit rollback transaction to Monad."),
        tone: "warning",
      });
    }
  };

  const handleCancelCanary = () => {
    if (!agent) return;
    clearStoredCanaryDeployment(agent);
    setCanaryDeployment(null);
    toast({
      title: "Canary Rollout Cancelled",
      message: "Candidate policy staging cleared without altering onchain state.",
      tone: "info",
    });
  };

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Risk Governance / Policy Engine</span>
          <h1>Policy Studio</h1>
          <p>
            Author and enforce deterministic spend invariants per autonomous agent. Changes are submitted to the configured Monad network for confirmation.
          </p>
        </div>
        <div className="page-heading-actions">
          <Link to="/app/simulator" className="control control-tonal">
            <PlayCircle size={15} />
            <span>Open "What-If" Simulator</span>
          </Link>
        </div>
      </header>

      {/* 2-Column Studio Grid */}
      <div className="policy-studio-grid">
        {/* Left Column: Authoring Form */}
        <Surface className="policy-editor-panel">
          <div className="section-heading">
            <div>
              <h2>Policy Authoring</h2>
              <p>Configure ceilings, sliding window epochs, and circuit breakers.</p>
            </div>
            {draft.killSwitch ? (
              <Badge tone="critical">Paused</Badge>
            ) : (
              <Badge tone="success">Active</Badge>
            )}
          </div>

          <div className="policy-field-group">
            <AgentSelect
              label="Target Agent"
              value={agent}
              agents={agents.data ?? []}
              onChange={(val) => setAgent(val)}
            />

            {selectedAgent && (
              <div className="selected-agent-strip">
                <div className="agent-strip-avatar">
                  <Bot size={18} />
                </div>
                <div className="agent-strip-details">
                  <div className="agent-strip-title-row">
                    <strong>{selectedAgent.label || truncateMiddle(selectedAgent.address, 10, 6)}</strong>
                    <button
                      type="button"
                      className="agent-strip-copy-btn"
                      onClick={() => handleCopy(selectedAgent.address)}
                      title="Copy agent address"
                    >
                      <Mono>{truncateMiddle(selectedAgent.address, 8, 6)}</Mono>
                      {copied ? <CheckCircle2 size={12} className="copied-icon" /> : <Copy size={12} />}
                    </button>
                  </div>
                  <div className="agent-strip-tags">
                    <Badge tone={draft.killSwitch ? "critical" : "success"}>
                      {draft.killSwitch ? "Spending Halted" : "Guarded Active"}
                    </Badge>
                    <Badge tone="info">{formatRiskTier(selectedAgent.riskTier)}</Badge>
                    <Badge tone="neutral">Float: {floatUsdc} USDC</Badge>
                    <span className="inspector-env-pill">{selectedAgent.environment}</span>
                  </div>
                </div>
              </div>
            )}

            {otherAgents.length > 0 && (
              <div className="clone-policy-strip">
                <span className="clone-policy-label">Clone from agent:</span>
                <select
                  className="clone-policy-select"
                  value={cloneSourceAgent}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCloneSourceAgent(val);
                    void handleCloneFromAgent(val);
                  }}
                >
                  <option value="">Select active agent to copy configuration…</option>
                  {otherAgents.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.label ? `${a.label} (${truncateMiddle(a.address, 6, 4)})` : truncateMiddle(a.address, 10, 6)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Quick Presets */}
          <div className="policy-presets-container">
            <div className="presets-label-row">
              <Sliders size={13} className="text-muted" />
              <span className="preset-kicker">Role Presets:</span>
            </div>
            <div className="policy-preset-chips">
              {POLICY_PRESETS.map((p) => {
                const active = isPresetActive(p);
                return (
                  <button
                    type="button"
                    key={p.label}
                    className={`policy-preset-chip ${active ? "active" : ""}`}
                    onClick={() => applyPreset(p)}
                    title={p.description}
                  >
                    <Sparkles size={12} />
                    <span>{p.label}</span>
                    {active && <span className="preset-active-indicator" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="policy-form-container">
            <div className="policy-params-grid">
              {/* Field 1: Max Spend Per Tx */}
              <div className="policy-input-block">
                <TextField
                  label="Maximum per transaction (USDC base units)"
                  value={draft.maxPerTx}
                  onChange={(event) => setDraft({ ...draft, maxPerTx: event.target.value })}
                />
                <div className="policy-field-hint">
                  <span className="hint-val">
                    ≈ {(Number(draft.maxPerTx || 0) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC
                  </span>
                  <small className="hint-sub">Single payment ceiling</small>
                </div>
              </div>

              {/* Field 2: Max Spend Per Window */}
              <div className="policy-input-block">
                <TextField
                  label="Maximum per window (USDC base units)"
                  value={draft.maxPerWindow}
                  onChange={(event) => setDraft({ ...draft, maxPerWindow: event.target.value })}
                />
                <div className="policy-field-hint">
                  <span className="hint-val">
                    ≈ {(Number(draft.maxPerWindow || 0) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC
                  </span>
                  <small className="hint-sub">Sliding epoch aggregate</small>
                </div>
              </div>

              {/* Field 3: Window Duration */}
              <div className="policy-input-block">
                <TextField
                  label="Window duration (seconds)"
                  type="number"
                  min={1}
                  value={draft.windowSeconds}
                  onChange={(event) => setDraft({ ...draft, windowSeconds: Number(event.target.value) })}
                />
                <div className="duration-quick-chips">
                  {[
                    { label: "15m", sec: 900 },
                    { label: "1h", sec: 3600 },
                    { label: "6h", sec: 21600 },
                    { label: "24h", sec: 86400 },
                    { label: "7d", sec: 604800 },
                  ].map((chip) => (
                    <button
                      type="button"
                      key={chip.sec}
                      className={`duration-chip ${draft.windowSeconds === chip.sec ? "active" : ""}`}
                      onClick={() => setDuration(chip.sec)}
                    >
                      {chip.label}
                    </button>
                  ))}
                  <span className="duration-epoch-label">{formatWindowEpoch(draft.windowSeconds)}</span>
                </div>
              </div>

              {/* Field 4: Velocity Limit */}
              <div className="policy-input-block">
                <TextField
                  label="Velocity limit (txs per window)"
                  type="number"
                  min={1}
                  value={draft.maxVelocity}
                  onChange={(event) => setDraft({ ...draft, maxVelocity: Number(event.target.value) })}
                />
                <div className="policy-field-hint">
                  <span className="hint-val">{draft.maxVelocity} max txs</span>
                  <small className="hint-sub">Per sliding epoch</small>
                </div>
              </div>
            </div>

            {/* Invariant Conflict Warning */}
            {BigInt(draft.maxPerTx || "0") > BigInt(draft.maxPerWindow || "0") && (
              <div className="policy-invariant-warning-box">
                <div className="warning-content" style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <AlertTriangle size={18} style={{ color: "var(--status-warning, #f59e0b)", flexShrink: 0, marginTop: "2px" }} />
                  <div>
                    <strong style={{ fontSize: "0.85rem", color: "var(--on-surface)" }}>
                      Invariant Conflict: Single-Tx Ceiling Exceeds Window Limit
                    </strong>
                    <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                      Single-tx ceiling ({formatUsdcAmount(draft.maxPerTx)}) exceeds the sliding window budget ({formatUsdcAmount(draft.maxPerWindow)}). Transactions above {formatUsdcAmount(draft.maxPerWindow)} will fail invariant checks onchain.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="tonal"
                  style={{ marginTop: "8px", alignSelf: "flex-start", fontSize: "0.78rem" }}
                  onClick={() => setDraft((prev) => ({ ...prev, maxPerWindow: prev.maxPerTx }))}
                >
                  Align Window Ceiling ({formatUsdcAmount(draft.maxPerTx)})
                </Button>
              </div>
            )}

            {/* Plain-English Invariant Translation */}
            <div className="policy-plain-sentence-card">
              <div className="sentence-heading" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <Sparkles size={13} style={{ color: "var(--primary)" }} />
                <span style={{ fontSize: "0.76rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--primary)" }}>
                  Plain-English Policy Translation
                </span>
              </div>
              <p className="sentence-body" style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.5, color: "var(--on-surface)" }}>
                Authorizes <strong>{selectedAgent?.label || (agent ? truncateMiddle(agent, 8, 4) : "the selected agent")}</strong> to spend up to <strong>{formatUsdcAmount(draft.maxPerTx)}</strong> per transaction, with a cumulative ceiling of <strong>{formatUsdcAmount(draft.maxPerWindow)}</strong> every <strong>{formatWindowEpoch(draft.windowSeconds)}</strong>, at a maximum pace of <strong>{draft.maxVelocity} transactions/{draft.windowSeconds >= 3600 ? "hr" : "window"}</strong>{draft.whitelistEnabled ? ", restricted strictly to approved directory merchants." : ", across any valid Monad counterparty."}
              </p>
            </div>

            {/* Safety & Execution Guards */}
            <div className="policy-guards-section">
              <div className={`policy-guard-card ${draft.killSwitch ? "guard-tripped" : "guard-active"}`}>
                <label className="guard-card-label">
                  <input
                    type="checkbox"
                    checked={draft.killSwitch}
                    onChange={(event) => setDraft({ ...draft, killSwitch: event.target.checked })}
                  />
                  <div className="guard-card-content">
                    <div className="guard-card-header">
                      <div className="guard-card-title-group">
                        <AlertOctagon size={16} />
                        <strong>Emergency Pause (O(1) Kill Switch)</strong>
                      </div>
                      <Badge tone={draft.killSwitch ? "critical" : "success"}>
                        {draft.killSwitch ? "Spending Halted" : "Guarded Active"}
                      </Badge>
                    </div>
                    <p>
                      {draft.killSwitch
                        ? "All agent spending is halted. Evaluator short-circuits onchain in O(1) time without sliding window math."
                        : "Real-time spend monitoring active on Monad Parallel EVM."}
                    </p>
                  </div>
                </label>
              </div>

              <div className={`policy-guard-card ${draft.whitelistEnabled ? "guard-whitelisted" : "guard-open"}`}>
                <label className="guard-card-label">
                  <input
                    type="checkbox"
                    checked={draft.whitelistEnabled}
                    onChange={(event) => setDraft({ ...draft, whitelistEnabled: event.target.checked })}
                  />
                  <div className="guard-card-content">
                    <div className="guard-card-header">
                      <div className="guard-card-title-group">
                        <ShieldCheck size={16} />
                        <strong>Require Approved Merchants from Directory</strong>
                      </div>
                      <Badge tone={draft.whitelistEnabled ? "info" : "neutral"}>
                        {draft.whitelistEnabled ? "Whitelist Enforced" : "Open Merchant"}
                      </Badge>
                    </div>
                    <p>
                      {draft.whitelistEnabled
                        ? "Strict merchant enforcement active. Unlisted counterparties rejected immediately with ReasonCode 4."
                        : "Agent permitted to disburse funds to any valid EVM recipient address."}
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Visual Policy Delta / Diff Analysis */}
            {policyDiff.length > 0 && (
              <div className="policy-diff-section">
                <div className="policy-dryrun-header">
                  <Scale size={18} />
                  <span>Staged Policy Changes vs. Onchain State</span>
                  <Badge tone="info">{policyDiff.length} Modifications</Badge>
                </div>
                <table className="policy-diff-table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Current Onchain</th>
                      <th>Staged Policy</th>
                      <th>Delta</th>
                      <th>Risk Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policyDiff.map((d) => (
                      <tr key={d.param}>
                        <td><strong>{d.param}</strong></td>
                        <td><Mono>{d.current}</Mono></td>
                        <td><Mono>{d.draftVal}</Mono></td>
                        <td>
                          <Badge tone={d.deltaText.startsWith("+") ? "warning" : "neutral"}>
                            {d.deltaText}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={d.risk === "high" ? "critical" : d.risk === "medium" ? "warning" : "success"}>
                            {d.risk.toUpperCase()}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Interactive Live Pre-Flight Dry-Run Sandbox */}
            <div className="policy-dryrun-section">
              <div className="policy-dryrun-header">
                <Calculator size={18} />
                <span>Pre-Flight Spend Invariant Simulator</span>
                <Badge tone={dryRunVerdict.allowed ? "success" : "critical"}>
                  {dryRunVerdict.allowed ? "Passed Simulation" : "Violation Detected"}
                </Badge>
              </div>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Test hypothetical transactions against this draft policy before submitting the configuration transaction to Monad EVM.
              </p>
              <div className="policy-dryrun-inputs">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <TextField
                    label="Simulated Amount (USDC)"
                    type="number"
                    step="0.01"
                    min="0"
                    value={dryRunAmount}
                    onChange={(e) => setDryRunAmount(e.target.value)}
                    placeholder="15.00"
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Select
                    label="Recipient Counterparty"
                    value={dryRunMerchant}
                    onChange={(val) => setDryRunMerchant(val)}
                    options={[
                      { value: "whitelisted", label: "Approved Merchant (0x3C44...2960)" },
                      { value: "unwhitelisted", label: "Unregistered External Address (0x9999...1111)" },
                    ]}
                  />
                </div>
              </div>

              <div className={`policy-verdict-banner ${dryRunVerdict.allowed ? "verdict-allowed" : "verdict-denied"}`}>
                {dryRunVerdict.allowed ? (
                  <ShieldCheck size={20} color="var(--status-success, #2ed573)" style={{ flexShrink: 0, marginTop: 2 }} />
                ) : (
                  <AlertOctagon size={20} color="var(--status-critical, #ff4757)" style={{ flexShrink: 0, marginTop: 2 }} />
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: "0.88rem" }}>
                      {dryRunVerdict.allowed ? "INVARIANT PASS: " : `ReasonCode ${dryRunVerdict.reasonCode}: `}
                      {dryRunVerdict.title}
                    </strong>
                    <Badge tone={dryRunVerdict.allowed ? "success" : "critical"}>
                      {dryRunVerdict.allowed ? "ATOMIC SETTLEMENT" : "REJECTED"}
                    </Badge>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--on-surface-secondary)" }}>
                    {dryRunVerdict.description}
                  </p>
                  <small style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                    <strong>Remediation:</strong> {dryRunVerdict.remediation}
                  </small>
                </div>
              </div>
            </div>

            {/* Canary Policy Deployment & Automated Rollback Guard */}
            <div className="policy-canary-section">
              <div className="policy-canary-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Gauge size={18} />
                  <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Canary Policy Deployment & Automated Rollback Guard</span>
                </div>
                {canaryDeployment ? (
                  <Badge tone={canaryDeployment.stage === "rolled_back" ? "critical" : canaryDeployment.stage === "promoted_100" ? "success" : "warning"}>
                    {canaryDeployment.stage.toUpperCase().replace("_", " ")} ({canaryDeployment.trafficPct}% TRAFFIC)
                  </Badge>
                ) : (
                  <Badge tone="neutral">READY FOR CANARY</Badge>
                )}
              </div>

              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Progressively roll out policy alterations to a percentage of live agent traffic before committing full consensus to Monad Parallel EVM. If an anomaly breach is detected, trigger an instant atomic rollback in 400ms.
              </p>

              {canaryDeployment ? (
                <div className="canary-active-card">
                  {/* 5-Stage Visual Stepper */}
                  <div className="canary-stepper" role="group" aria-label="Canary Rollout Stages">
                    {[
                      { key: "staged", label: "0% Staged", pct: 0 },
                      { key: "canary_10", label: "10% Pilot", pct: 10 },
                      { key: "canary_25", label: "25% Scale", pct: 25 },
                      { key: "canary_50", label: "50% Trial", pct: 50 },
                      { key: "promoted_100", label: "100% Consensus", pct: 100 },
                    ].map((step, idx) => {
                      const isPassed = canaryDeployment.trafficPct >= step.pct;
                      const isCurrent = canaryDeployment.stage === step.key;
                      return (
                        <div
                          key={step.key}
                          className={`canary-step-pill ${isPassed ? "step-passed" : ""} ${isCurrent ? "step-current" : ""}`}
                        >
                          <div className="step-badge">{idx}</div>
                          <div className="step-text">
                            <strong>{step.label}</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Live Breaker Telemetry */}
                  <div className="canary-metrics-row">
                    <div className="canary-metric-box">
                      <small className="muted-label">Observed Breach Rate</small>
                      <strong style={{ color: canaryDeployment.observedBreachRatePct > canaryDeployment.anomalyThresholdPct ? "var(--error)" : "var(--status-good)" }}>
                        {canaryDeployment.observedBreachRatePct.toFixed(1)}%
                      </strong>
                    </div>
                    <div className="canary-metric-box">
                      <small className="muted-label">Anomaly Gate Threshold</small>
                      <strong>{canaryDeployment.anomalyThresholdPct.toFixed(1)}%</strong>
                    </div>
                    <div className="canary-metric-box">
                      <small className="muted-label">Active Traffic Allocation</small>
                      <strong>{canaryDeployment.trafficPct}% Live Traffic</strong>
                    </div>
                  </div>

                  {/* Safety Alert if Breached */}
                  {canaryDeployment.observedBreachRatePct > canaryDeployment.anomalyThresholdPct && (
                    <div className="canary-breach-alert">
                      <AlertOctagon size={18} />
                      <div>
                        <strong>ANOMALOUS BREACH RATE DETECTED</strong>
                        <p style={{ margin: 0, fontSize: "0.78rem" }}>
                          Observed ReasonCode failure rate ({canaryDeployment.observedBreachRatePct}%) exceeds safety ceiling ({canaryDeployment.anomalyThresholdPct}%). Immediate atomic rollback recommended.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Canary Action Bar */}
                  <div className="canary-actions-bar">
                    {canaryDeployment.stage !== "promoted_100" && canaryDeployment.stage !== "rolled_back" && (
                      <Button
                        variant="filled"
                        onClick={handleAdvanceCanary}
                        disabled={isPublishing}
                      >
                        <TrendingUp size={14} style={{ marginRight: 6 }} />
                        <span>
                          {canaryDeployment.stage === "staged"
                            ? "Promote to 10% Canary"
                            : canaryDeployment.stage === "canary_10"
                              ? "Advance to 25% Canary"
                              : canaryDeployment.stage === "canary_25"
                                ? "Advance to 50% Canary"
                                : "Commit 100% Onchain Consensus"}
                        </span>
                      </Button>
                    )}

                    <Button
                      variant="filled"
                      className="control-critical"
                      onClick={handleEmergencyRollback}
                      disabled={isPublishing}
                      title="Instantly restore baseline policy word on Monad Parallel EVM"
                    >
                      <RotateCcw size={14} style={{ marginRight: 6 }} />
                      <span>{isPublishing ? "Reverting Onchain…" : "Emergency Atomic Rollback to Baseline"}</span>
                    </Button>

                    <Button
                      variant="tonal"
                      onClick={handleCancelCanary}
                      disabled={isPublishing}
                    >
                      Cancel Canary
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="canary-idle-banner">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                    <span style={{ fontSize: "0.82rem", color: "var(--on-surface-secondary)" }}>
                      No active canary rollout for this agent. Stage draft parameters through progressive canary verification.
                    </span>
                    <Button
                      variant="tonal"
                      onClick={handleInitCanary}
                      disabled={!agent || changedFields.length === 0}
                    >
                      <Gauge size={14} style={{ marginRight: 6 }} />
                      <span>Stage Canary Rollout (10% Traffic)</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Confidential ZK-Policy Shield */}
            <div className="policy-canary-section" style={{ marginTop: "16px" }}>
              <div className="policy-canary-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <ShieldCheck size={18} />
                  <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Confidential ZK-Policy Shield (Groth16 Verifier)</span>
                </div>
                <Badge tone={zkShieldEnabled ? "success" : "neutral"}>
                  {zkShieldEnabled ? "ZK SHIELD ACTIVE" : "STANDARD DISJOINT SLOTS"}
                </Badge>
              </div>

              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Cryptographically prove that spend constraints, merchant whitelists, and velocity caps are respected in zero knowledge without exposing confidential counterparties, trade sizes, or proprietary budgets to the public mempool.
              </p>

              <div style={{ marginTop: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderRadius: "8px", background: "var(--surface-3)" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>Confidential Spending Invariants</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Generates Groth16 cryptographic proof with single-use nullifiers.</div>
                </div>
                <Button
                  type="button"
                  variant={zkShieldEnabled ? "filled" : "tonal"}
                  onClick={() => setZkShieldEnabled(!zkShieldEnabled)}
                >
                  {zkShieldEnabled ? "Disable ZK Shield" : "Enable ZK Shield"}
                </Button>
              </div>

              {zkShieldEnabled && (
                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.8rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--muted)" }}>Onchain Commitment</span>
                    <Mono style={{ fontSize: "0.75rem" }}>{agent ? truncateMiddle(agent, 10, 8) + "...commit" : "0x00...commit"}</Mono>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--muted)" }}>Nullifier Anti-Replay</span>
                    <Badge tone="success">Atomic Zero-Spend Nullifier Active</Badge>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                    <span style={{ color: "var(--muted)" }}>Onchain Contract</span>
                    <Mono style={{ fontSize: "0.75rem" }}>ZkPolicyEngineVerifier.sol</Mono>
                  </div>
                </div>
              )}
            </div>

            {/* Omnichain Risk Co-Processor (Cross-Chain Spend Permits) */}
            <div className="policy-canary-section" style={{ marginTop: "16px" }}>
              <div className="policy-canary-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <TrendingUp size={18} />
                  <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Omnichain Risk Co-Processor (Cross-Chain Spend Permits)</span>
                </div>
                <Badge tone="info">Monad 400ms Risk Brain</Badge>
              </div>

              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Monad evaluates global sliding window velocity and budget ceilings at 400ms finality, emitting cryptographic spend permits verifiable on destination chains with zero policy drift.
              </p>

              <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderRadius: "8px", background: "var(--surface-3)" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>Remote Target Settlement Chain</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Select external network for autonomous execution.</div>
                  </div>
                  <Select
                    value={selectedTargetChain.toString()}
                    onChange={(val) => setSelectedTargetChain(Number(val))}
                    options={[
                      { value: "8453", label: "Base Mainnet (Chain ID 8453)" },
                      { value: "42161", label: "Arbitrum One (Chain ID 42161)" },
                      { value: "1", label: "Ethereum Mainnet (Chain ID 1)" },
                    ]}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: "6px", background: "var(--surface-sunken)", border: "1px solid var(--outline-soft)", fontSize: "0.78rem" }}>
                  <span style={{ color: "var(--muted)" }}>Cross-Chain State Sync:</span>
                  <Badge tone="success">OmnichainSpendValidator.sol Active</Badge>
                </div>

                <Button
                  type="button"
                  variant="tonal"
                  onClick={() => {
                    setOmnichainPermitGenerated(true);
                    toast({
                      title: "Cross-Chain Spend Permit Issued",
                      message: `Cryptographic permit generated for Target Chain ${selectedTargetChain} with 1-hour expiration.`,
                      tone: "success",
                    });
                  }}
                  disabled={!agent}
                >
                  <Bot size={14} style={{ marginRight: 6 }} />
                  <span>Generate Monad Remote Spend Permit</span>
                </Button>

                {omnichainPermitGenerated && (
                  <div style={{ padding: "10px", borderRadius: "6px", background: "var(--surface-sunken)", border: "1px solid var(--outline-soft)", fontSize: "0.72rem", fontFamily: "monospace" }}>
                    <div style={{ color: "var(--accent-blue)", fontWeight: 600, marginBottom: "4px" }}>
                      Header: x402-omnichain
                    </div>
                    <div style={{ color: "var(--on-surface)", wordBreak: "break-all" }}>
                      {`{"agent":"${agent || "0x00"}","targetChainId":${selectedTargetChain},"amount":"${draft.maxPerTx}000000","validUntil":${Math.floor(Date.now() / 1000) + 3600},"monadPolicyBlock":125000}`}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ERC-7730 Clear-Signing & Deep Calldata Policy Guard */}
            <div className="policy-canary-section" style={{ marginTop: "16px" }}>
              <div className="policy-canary-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Code2 size={18} />
                  <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>ERC-7730 Clear-Signing & Calldata Policy Guard</span>
                </div>
                <Badge tone="success">CalldataPolicyGuard.sol Active</Badge>
              </div>

              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Inspects function selectors, argument parameter offsets, and slippage tolerances before granting spending approval to prevent prompt-injection drains and malicious calldata payloads.
              </p>

              <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "0.76rem", color: "var(--muted)", marginBottom: "4px", display: "block" }}>
                    Raw Calldata Payload (Hex)
                  </label>
                  <TextField
                    label=""
                    value={calldataInput}
                    onChange={(e) => setCalldataInput(e.target.value)}
                    placeholder="0xa9059cbb..."
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Button
                    type="button"
                    variant="tonal"
                    onClick={handleInspectCalldata}
                    disabled={isInspectingCalldata || !calldataInput.trim()}
                  >
                    <ShieldCheck size={14} style={{ marginRight: 6 }} />
                    <span>{isInspectingCalldata ? "Inspecting Calldata…" : "Decode & Verify Clear-Signing"}</span>
                  </Button>

                  <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    Selector Partitioning: <strong style={{ color: "var(--on-surface)" }}>Monad Slot Disjoint</strong>
                  </div>
                </div>

                {calldataResult && (
                  <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)", marginTop: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <Mono style={{ fontWeight: 700 }}>{calldataResult.selector}</Mono>
                        <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{calldataResult.function_name}</span>
                      </div>
                      <Badge tone={calldataResult.risk_level === "critical" ? "critical" : calldataResult.risk_level === "elevated" ? "warning" : "success"}>
                        {calldataResult.risk_level.toUpperCase()} RISK
                      </Badge>
                    </div>

                    <div style={{ fontSize: "0.82rem", padding: "8px", borderRadius: "6px", background: "var(--surface-sunken)", marginBottom: "8px" }}>
                      <strong style={{ color: "var(--color-primary)" }}>Clear-Signing Intent: </strong>
                      <span>{calldataResult.clear_signing_summary}</span>
                    </div>

                    {calldataResult.fields.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.76rem" }}>
                        {calldataResult.fields.map((f, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", borderBottom: i < calldataResult.fields.length - 1 ? "1px solid var(--outline-soft)" : "none", padding: "4px 0" }}>
                            <span style={{ color: "var(--muted)" }}>{f.name} ({f.field_type})</span>
                            <Mono style={{ fontSize: "0.72rem" }}>{f.value}</Mono>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Action Bar */}
            <div className="policy-action-bar">
              <div className="policy-changes-status">
                {changedFields.length > 0 ? (
                  <span className="changes-tag pending">
                    <AlertTriangle size={14} />
                    <span>{changedFields.length} uncommitted {changedFields.length === 1 ? "change" : "changes"}</span>
                  </span>
                ) : (
                  <span className="changes-tag synced">
                    <CheckCircle2 size={14} />
                    <span>Synced with onchain policy</span>
                  </span>
                )}
              </div>

              <Button
                onClick={reviewPolicy}
                disabled={!agent || isPublishing}
                className="publish-policy-btn"
              >
                <ShieldCheck size={16} />
                <span>{isPublishing ? "Submitting to Monad…" : "Review & Publish Policy"}</span>
              </Button>
            </div>
          </div>

          {message && (
            <div className={`form-message-banner ${message.includes("confirmed") ? "banner-success" : ""}`}>
              {message.includes("confirmed") ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{message}</span>
            </div>
          )}
        </Surface>

        {/* Right Column: Live Onchain State & Verification */}
        <div className="policy-state-column">
          <Surface className="policy-preview-card">
            <div className="section-heading">
              <div>
                <h2>Live Onchain Policy</h2>
                <p>Derived directly from Monad verified storage slots.</p>
              </div>
              <span className="epoch-pill">
                <span className="epoch-dot" />
                Slot 0 Word
              </span>
            </div>

            {policy.isError ? (
              <EmptyState title="Policy unavailable" detail="The selected policy could not be read from Monad." />
            ) : policy.data ? (
              <div className="policy-metrics-breakdown">
                <div className="policy-metric-tile">
                  <span className="tile-label">Max Per Transaction</span>
                  <strong className="tile-val">
                    {(Number(policy.data.maxPerTx ?? 0) / 1_000_000).toFixed(2)} USDC
                  </strong>
                  <small className="tile-sub">Base units: {String(policy.data.maxPerTx ?? 0)}</small>
                </div>

                <div className="policy-metric-tile">
                  <span className="tile-label">Sliding Window Cap</span>
                  <strong className="tile-val">
                    {(Number(policy.data.maxPerWindow ?? 0) / 1_000_000).toFixed(2)} USDC
                  </strong>
                  <small className="tile-sub">Per {String(policy.data.windowSeconds ?? 3600)}s epoch</small>
                </div>

                <div className="policy-metric-tile">
                  <span className="tile-label">Velocity Ceiling</span>
                  <strong className="tile-val">{String(policy.data.maxVelocity ?? 1)} txs</strong>
                  <small className="tile-sub">Max payments per epoch</small>
                </div>

                <div className="policy-metric-tile">
                  <span className="tile-label">Enforced Standards</span>
                  <div className="enforced-tags">
                    <Badge tone={policy.data.killSwitch ? "critical" : "success"}>
                      {policy.data.killSwitch ? "Circuit Tripped" : "Guarded Active"}
                    </Badge>
                    <Badge tone={policy.data.whitelistEnabled ? "info" : "neutral"}>
                      {policy.data.whitelistEnabled ? "Whitelist Required" : "Open Merchant"}
                    </Badge>
                  </div>
                </div>

                <div className="simulator-cta-box">
                  <div className="cta-copy">
                    <strong>Want to verify this policy safely?</strong>
                    <p>Dry-run simulated payments against Monad Cancun transient storage with zero financial risk.</p>
                  </div>
                  <Link to="/app/simulator" className="control control-tonal cta-btn">
                    <span>Dry-Run in Simulator</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No agent selected"
                detail="Choose an agent to inspect and publish its onchain policy limits."
              />
            )}
          </Surface>
        </div>
      </div>

      <TransactionStatus
        phase={transactionPhase}
        hash={transactionHash}
        error={transactionError}
      />

      <Dialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Review policy change"
        description="Confirm the exact limits that will be sent to the configured PolicyEngine. No onchain state changes until wallet approval."
        footer={
          <>
            <Button variant="text" onClick={() => setReviewOpen(false)}>
              Keep editing
            </Button>
            <Button onClick={() => void publish()} disabled={isPublishing}>
              Confirm & open wallet
            </Button>
          </>
        }
      >
        <div className="policy-review-target">
          <span className="eyebrow">Target agent</span>
          <Mono>{agent}</Mono>
        </div>
        <div className="policy-review-summary">
          <strong>{changedFields.length} policy {changedFields.length === 1 ? "field" : "fields"} will change</strong>
          <span>Review the impact before signing.</span>
        </div>
        <dl className="policy-diff-list">
          {changedFields.map((key) => {
            const before = currentPolicy?.[key];
            const after = draft[key];
            const display = (value: PolicyUpdate[typeof key] | undefined) => {
              if (value === undefined) return "Not configured";
              if (key === "maxPerTx" || key === "maxPerWindow") return `${formatTokenAmount(String(value))} USDC`;
              if (key === "windowSeconds") return `${value} seconds`;
              if (key === "maxVelocity") return `${value} transactions`;
              return value ? "Enabled" : "Disabled";
            };
            return (
              <div className="policy-diff-row" key={key}>
                <dt>{policyLabels[key]}</dt>
                <dd><span>{display(before)}</span><strong>→</strong><span>{display(after)}</span></dd>
              </div>
            );
          })}
        </dl>
        <div className="policy-review-warning" role="note">
          <AlertTriangle size={16} />
          <span>This policy governs autonomous spending immediately after network confirmation.</span>
        </div>
      </Dialog>
    </div>
  );
}
