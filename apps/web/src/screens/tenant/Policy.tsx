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
  ChevronDown,
  SlidersHorizontal,
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
import { reasonCodeLabel } from "../../copy";

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
    maxPerTx: "10",
    maxPerWindow: "100",
    windowSeconds: 3600,
    maxVelocity: 50,
  },
  {
    label: "Standard Autonomous",
    description: "Autonomous task execution ($50/tx, $500/hr)",
    maxPerTx: "50",
    maxPerWindow: "500",
    windowSeconds: 3600,
    maxVelocity: 20,
  },
  {
    label: "High-Volume Trader",
    description: "DeFi rebalancing & high-cadence bots ($250/tx, $2k/hr)",
    maxPerTx: "250",
    maxPerWindow: "2000",
    windowSeconds: 3600,
    maxVelocity: 100,
  },
  {
    label: "Low-Cost AI Agent",
    description: "Small, frequent AI calls ($0.10/tx, $1.50/hr, 10 tx/hr)",
    maxPerTx: "0.10",
    maxPerWindow: "1.50",
    windowSeconds: 3600,
    maxVelocity: 10,
  },
];

function parseBaseUnits(amountStr: string | number, decimals = 6): bigint {
  const str = String(amountStr ?? "0").trim();
  if (!str) return 0n;
  const [whole = "0", fraction = ""] = str.split(".");
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole || "0") * (10n ** BigInt(decimals)) + BigInt(padded);
}

function baseUnitsToDollars(val: string | number | bigint | null | undefined, decimals = 6): string {
  if (val === null || val === undefined || val === "") return "0";
  const str = String(val).trim();
  if (str.includes(".")) return str;
  const num = Number(str);
  if (isNaN(num) || num === 0) return "0";
  const float = num / (10 ** decimals);
  return Number(float.toFixed(decimals)).toString();
}

function formatUsdcAmount(amount: string | number): string {
  const float = typeof amount === "number" ? amount : parseFloat(amount || "0");
  if (isNaN(float) || float <= 0) return "$0.00 USDC";
  if (float < 0.01) {
    return `$${float.toFixed(6)} USDC`;
  }
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
  const [cloneSourceAgent, setCloneSourceAgent] = useState<string>("");

  const handleCopy = (address: string) => {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isPresetActive = (p: PolicyPreset) =>
    parseBaseUnits(draft.maxPerTx, 6) === parseBaseUnits(p.maxPerTx, 6) &&
    parseBaseUnits(draft.maxPerWindow, 6) === parseBaseUnits(p.maxPerWindow, 6) &&
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
        title: "Transaction checked",
        message: `This calls ${res.function_name}. Risk: ${res.risk_level === "critical" ? "high" : res.risk_level === "elevated" ? "some" : "low"}.`,
        tone: res.risk_level === "critical" ? "critical" : res.risk_level === "elevated" ? "warning" : "success",
      });
    } catch (err) {
      toast({
        title: "Couldn't check this transaction",
        message: toUserFacingError(err, "Try again with valid transaction data."),
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
    const maxTxUnits = parseBaseUnits(draft.maxPerTx || "0", 6);
    const maxWindowUnits = parseBaseUnits(draft.maxPerWindow || "0", 6);

    if (draft.killSwitch) {
      return {
        allowed: false,
        reasonCode: 4,
        title: "ERR_KILL_SWITCH_ACTIVE",
        description: "This agent is paused, so it can't spend right now.",
        remediation: "Turn off the pause switch above before testing a payment.",
      };
    }
    if (amountUnits <= 0n) {
      return {
        allowed: false,
        reasonCode: 9,
        title: "ERR_AMOUNT_ZERO",
        description: "Enter an amount greater than zero.",
        remediation: "Specify a positive USDC amount.",
      };
    }
    if (amountUnits > maxTxUnits) {
      return {
        allowed: false,
        reasonCode: 1,
        title: "ERR_MAX_PER_TX_EXCEEDED",
        description: `${amountFloat.toFixed(2)} USDC is over the per-transaction limit (${formatUsdcAmount(draft.maxPerTx)}).`,
        remediation: "Lower the amount, or raise the per-transaction limit above.",
      };
    }
    if (amountUnits > maxWindowUnits) {
      return {
        allowed: false,
        reasonCode: 2,
        title: "ERR_MAX_PER_WINDOW_EXCEEDED",
        description: `This would go over the spending limit for this period (${formatUsdcAmount(draft.maxPerWindow)}).`,
        remediation: "Lower the amount, or raise the period limit above.",
      };
    }
    if (draft.whitelistEnabled && dryRunMerchant === "unwhitelisted") {
      return {
        allowed: false,
        reasonCode: 5,
        title: "ERR_MERCHANT_NOT_WHITELISTED",
        description: "This merchant isn't on the approved list.",
        remediation: "Add this merchant in Merchant Directory, or turn off the approved-merchants requirement.",
      };
    }
    return {
      allowed: true,
      reasonCode: 0,
      title: "ERR_NONE",
      description: `This payment is within limits: up to ${formatUsdcAmount(draft.maxPerWindow)} per period, to an approved merchant.`,
      remediation: "This would go through right away.",
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

    const curMaxTxUnits = parseBaseUnits(baseUnitsToDollars(policy.data.maxPerTx as string | number), 6);
    const newMaxTxUnits = parseBaseUnits(draft.maxPerTx || "0", 6);
    if (curMaxTxUnits !== newMaxTxUnits) {
      const curMaxTx = Number(curMaxTxUnits) / 1e6;
      const newMaxTx = Number(newMaxTxUnits) / 1e6;
      const deltaPct = curMaxTx > 0 ? Math.round(((newMaxTx - curMaxTx) / curMaxTx) * 100) : 100;
      diffs.push({
        param: "Per-transaction limit",
        current: formatUsdcAmount(curMaxTx),
        draftVal: formatUsdcAmount(newMaxTx),
        deltaText: deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`,
        risk: deltaPct > 200 ? "high" : deltaPct > 50 ? "medium" : "low",
      });
    }

    const curMaxWinUnits = parseBaseUnits(baseUnitsToDollars(policy.data.maxPerWindow as string | number), 6);
    const newMaxWinUnits = parseBaseUnits(draft.maxPerWindow || "0", 6);
    if (curMaxWinUnits !== newMaxWinUnits) {
      const curMaxWin = Number(curMaxWinUnits) / 1e6;
      const newMaxWin = Number(newMaxWinUnits) / 1e6;
      const deltaPct = curMaxWin > 0 ? Math.round(((newMaxWin - curMaxWin) / curMaxWin) * 100) : 100;
      diffs.push({
        param: "Period limit",
        current: formatUsdcAmount(curMaxWin),
        draftVal: formatUsdcAmount(newMaxWin),
        deltaText: deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`,
        risk: deltaPct > 200 ? "high" : deltaPct > 50 ? "medium" : "low",
      });
    }

    if (Number(policy.data.windowSeconds ?? 3600) !== draft.windowSeconds) {
      diffs.push({
        param: "Period length",
        current: `${policy.data.windowSeconds ?? 3600}s`,
        draftVal: `${draft.windowSeconds}s`,
        deltaText: `${draft.windowSeconds - Number(policy.data.windowSeconds ?? 3600)}s`,
        risk: draft.windowSeconds < 900 ? "medium" : "low",
      });
    }

    if (Number(policy.data.maxVelocity ?? 1) !== draft.maxVelocity) {
      diffs.push({
        param: "Max payments per period",
        current: `${policy.data.maxVelocity ?? 1} txs`,
        draftVal: `${draft.maxVelocity} txs`,
        deltaText: `${draft.maxVelocity - Number(policy.data.maxVelocity ?? 1)} txs`,
        risk: draft.maxVelocity > 100 ? "high" : "low",
      });
    }

    if (policy.data.killSwitch !== draft.killSwitch) {
      diffs.push({
        param: "Spending",
        current: policy.data.killSwitch ? "Paused" : "Active",
        draftVal: draft.killSwitch ? "Paused" : "Active",
        deltaText: draft.killSwitch ? "Pause" : "Resume",
        risk: draft.killSwitch ? "high" : "low",
      });
    }

    if (policy.data.whitelistEnabled !== draft.whitelistEnabled) {
      diffs.push({
        param: "Approved merchants",
        current: policy.data.whitelistEnabled ? "Required" : "Open",
        draftVal: draft.whitelistEnabled ? "Required" : "Open",
        deltaText: draft.whitelistEnabled ? "Required" : "Open",
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
          maxPerTx: parsed.maxPerTx !== undefined ? baseUnitsToDollars(parsed.maxPerTx) : prev.maxPerTx,
          maxPerWindow: parsed.maxPerWindow !== undefined ? baseUnitsToDollars(parsed.maxPerWindow) : prev.maxPerWindow,
          windowSeconds: parsed.windowSeconds ?? prev.windowSeconds,
          maxVelocity: parsed.maxVelocity ?? prev.maxVelocity,
          whitelistEnabled: parsed.whitelistEnabled ?? prev.whitelistEnabled,
        }));
        setMessage("Filled in by the AI assistant. Review and publish when ready.");
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!policy.data) return;
    setDraft({
      maxPerTx: baseUnitsToDollars(policy.data.maxPerTx as string | number),
      maxPerWindow: baseUnitsToDollars(policy.data.maxPerWindow as string | number),
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
          maxPerTx: baseUnitsToDollars(res.maxPerTx),
          maxPerWindow: baseUnitsToDollars(res.maxPerWindow),
          windowSeconds: Number(res.windowSeconds ?? 3600),
          maxVelocity: Number(res.maxVelocity ?? 1),
          killSwitch: Boolean(res.killSwitch),
          whitelistEnabled: Boolean(res.whitelistEnabled),
        });
        toast({
          title: "Policy Configuration Replicated",
          message: `Copied spending rules from ${truncateMiddle(sourceAddr, 8, 4)}.`,
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
        maxPerTx: baseUnitsToDollars(policy.data.maxPerTx as string | number),
        maxPerWindow: baseUnitsToDollars(policy.data.maxPerWindow as string | number),
        windowSeconds: Number(policy.data.windowSeconds ?? 3600),
        maxVelocity: Number(policy.data.maxVelocity ?? 1),
        killSwitch: Boolean(policy.data.killSwitch),
        whitelistEnabled: Boolean(policy.data.whitelistEnabled),
      }
    : null;

  const changedFields = (Object.keys(draft) as Array<keyof PolicyUpdate>).filter(
    (key) => {
      if (!currentPolicy) return true;
      if (key === "maxPerTx" || key === "maxPerWindow") {
        return parseBaseUnits(draft[key], 6) !== parseBaseUnits(currentPolicy[key], 6);
      }
      return draft[key] !== currentPolicy[key];
    },
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
    const maxTx = parseFloat(draft.maxPerTx || "0");
    const maxWin = parseFloat(draft.maxPerWindow || "0");
    if (isNaN(maxTx) || maxTx < 0 || isNaN(maxWin) || maxWin < 0) {
      setMessage("Spend limits cannot be negative.");
      return;
    }
    setTransactionError("");
    setReviewOpen(true);
  };

  const handleDirectPublish = async () => {
    if (!agent) {
      setMessage("Select an agent before publishing a policy change.");
      return;
    }
    if (!Number.isFinite(draft.windowSeconds) || draft.windowSeconds < 1 || draft.maxVelocity < 1) {
      setMessage("Window duration and velocity must be positive values.");
      return;
    }
    const maxTx = parseFloat(draft.maxPerTx || "0");
    const maxWin = parseFloat(draft.maxPerWindow || "0");
    if (isNaN(maxTx) || maxTx < 0 || isNaN(maxWin) || maxWin < 0) {
      setMessage("Spend limits cannot be negative.");
      return;
    }
    try {
      await publish(draft);
    } catch {
      // safe error message is already handled inside publish
    }
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
      const onchainPayload: PolicyUpdate = {
        ...policyToWrite,
        maxPerTx: parseBaseUnits(policyToWrite.maxPerTx, 6).toString(),
        maxPerWindow: parseBaseUnits(policyToWrite.maxPerWindow, 6).toString(),
      };
      const prepared = await request<{ target: string; data: string }>(
        `/agents/${encodeURIComponent(agent)}/policy`,
        { method: "POST", body: JSON.stringify(onchainPayload) },
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
      console.error("Policy publish failed:", error);
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
          message: "The new rules are now live for everyone.",
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
        message: "Restored the previous spending rules.",
        tone: "critical",
      });
    } catch (err) {
      toast({
        title: "Rollback Failed",
        message: toUserFacingError(err, "Could not roll back. Try again."),
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
      message: "The staged change was cancelled. Nothing was changed.",
      tone: "info",
    });
  };

  return (
    <div className="stack">
      <header className="page-heading policy-clean-header">
        <div>
          <span className="eyebrow">Spending rules</span>
          <h1>Policy</h1>
          <p>
            Set spending limits and safety controls for your agents.
          </p>
        </div>
        <div className="page-heading-actions">
          <Link to="/app/simulator" className="control control-tonal">
            <PlayCircle size={14} />
            <span>Open "What-If" Simulator</span>
          </Link>
        </div>
      </header>

      {/* 2-Column Studio Grid */}
      <div className="policy-studio-grid">
        {/* Left Column: Authoring Form */}
        <Surface className="policy-editor-panel">
          <div className="section-heading" style={{ marginBottom: "16px" }}>
            <div>
              <h2>Spending rules</h2>
              <p>Set spending limits and safety controls for this agent.</p>
            </div>
            {draft.killSwitch ? (
              <Badge tone="critical">Paused</Badge>
            ) : (
              <Badge tone="success">Active</Badge>
            )}
          </div>

          <div className="policy-agent-section">
            <div className="policy-agent-row">
              <div className="policy-agent-select-wrap">
                <AgentSelect
                  label="Target Agent"
                  value={agent}
                  agents={agents.data ?? []}
                  onChange={(val) => setAgent(val)}
                />
              </div>

              {otherAgents.length > 0 && (
                <div className="policy-clone-wrap">
                  <select
                    className="clone-policy-select"
                    value={cloneSourceAgent}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCloneSourceAgent(val);
                      void handleCloneFromAgent(val);
                    }}
                  >
                    <option value="">Clone limits from…</option>
                    {otherAgents.map((a) => (
                      <option key={a.address} value={a.address}>
                        {a.label || truncateMiddle(a.address, 6, 4)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {selectedAgent && (
              <div className="selected-agent-meta">
                <div className="agent-meta-left">
                  <span className={`status-dot ${draft.killSwitch ? "dot-critical" : "dot-success"}`} />
                  <strong className="agent-meta-name">{selectedAgent.label || truncateMiddle(selectedAgent.address, 10, 6)}</strong>
                  <button
                    type="button"
                    className="agent-meta-copy"
                    onClick={() => handleCopy(selectedAgent.address)}
                    title="Copy agent address"
                  >
                    <Mono>{truncateMiddle(selectedAgent.address, 6, 4)}</Mono>
                    {copied ? <CheckCircle2 size={12} className="copied-icon" /> : <Copy size={12} />}
                  </button>
                </div>
                <div className="agent-meta-tags">
                  <Badge tone={draft.killSwitch ? "critical" : "success"}>
                    {draft.killSwitch ? "Paused" : "Active"}
                  </Badge>
                  <Badge tone="info">{formatRiskTier(selectedAgent.riskTier)}</Badge>
                  <span className="agent-meta-float">Float: ${floatUsdc} USDC</span>
                </div>
              </div>
            )}

            {/* Quick Role Presets */}
            <div className="policy-presets-bar">
              <span className="presets-bar-label">Presets:</span>
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
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="policy-form-container">
            <div className="policy-params-grid">
              {/* Field 1: Max Spend Per Tx */}
              <div className="policy-input-block">
                <TextField
                  label="Maximum per transaction ($ USDC)"
                  placeholder="0.00"
                  value={draft.maxPerTx}
                  onChange={(event) => setDraft({ ...draft, maxPerTx: event.target.value })}
                />
                <div className="policy-field-hint">
                  <span className="hint-val">
                    {formatUsdcAmount(draft.maxPerTx)}
                  </span>
                  <small className="hint-sub">Single payment ceiling</small>
                </div>
              </div>

              {/* Field 2: Max Spend Per Window */}
              <div className="policy-input-block">
                <TextField
                  label="Maximum per window ($ USDC)"
                  placeholder="0.00"
                  value={draft.maxPerWindow}
                  onChange={(event) => setDraft({ ...draft, maxPerWindow: event.target.value })}
                />
                <div className="policy-field-hint">
                  <span className="hint-val">
                    {formatUsdcAmount(draft.maxPerWindow)}
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
            {parseBaseUnits(draft.maxPerTx || "0", 6) > parseBaseUnits(draft.maxPerWindow || "0", 6) && (
              <div className="policy-invariant-warning-box">
                <div className="warning-content" style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <AlertTriangle size={18} style={{ color: "var(--status-warning, #f59e0b)", flexShrink: 0, marginTop: "2px" }} />
                  <div>
                    <strong style={{ fontSize: "0.85rem", color: "var(--on-surface)" }}>
                      Per-transaction limit is higher than the period limit
                    </strong>
                    <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                      The per-transaction limit ({formatUsdcAmount(draft.maxPerTx)}) is higher than the period limit ({formatUsdcAmount(draft.maxPerWindow)}), so payments above {formatUsdcAmount(draft.maxPerWindow)} will still be blocked.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="tonal"
                  style={{ marginTop: "8px", alignSelf: "flex-start", fontSize: "0.78rem" }}
                  onClick={() => setDraft((prev) => ({ ...prev, maxPerWindow: prev.maxPerTx }))}
                >
                  Match period limit to {formatUsdcAmount(draft.maxPerTx)}
                </Button>
              </div>
            )}

            {/* Plain-English Summary Note */}
            <div className="policy-summary-note">
              <Sparkles size={14} className="summary-note-icon" />
              <p style={{ margin: 0 }}>
                Lets <strong>{selectedAgent?.label || (agent ? truncateMiddle(agent, 8, 4) : "the selected agent")}</strong> spend up to <strong>{formatUsdcAmount(draft.maxPerTx)}</strong> per payment, and up to <strong>{formatUsdcAmount(draft.maxPerWindow)}</strong> every <strong>{formatWindowEpoch(draft.windowSeconds)}</strong> (max {draft.maxVelocity} payments){draft.whitelistEnabled ? ", only to approved merchants." : ", to any recipient."}
              </p>
            </div>

            {/* Safety & Execution Guards - Modern Switch Rows */}
            <div className="policy-guards-section">
              <div className={`policy-guard-row ${draft.killSwitch ? "is-tripped" : ""}`}>
                <div className="guard-row-content">
                  <div className="guard-row-title">
                    <AlertOctagon size={16} className={draft.killSwitch ? "text-critical" : "text-muted"} />
                    <strong>Pause this agent</strong>
                    <Badge tone={draft.killSwitch ? "critical" : "neutral"}>
                      {draft.killSwitch ? "Paused" : "Active"}
                    </Badge>
                  </div>
                  <p className="guard-row-caption">
                    {draft.killSwitch
                      ? "This agent can't spend right now."
                      : "Turn this on to immediately stop this agent from spending."}
                  </p>
                </div>
                <label className="modern-switch">
                  <input
                    type="checkbox"
                    checked={draft.killSwitch}
                    onChange={(event) => setDraft({ ...draft, killSwitch: event.target.checked })}
                  />
                  <span className="switch-slider" />
                </label>
              </div>

              <div className={`policy-guard-row ${draft.whitelistEnabled ? "is-whitelisted" : ""}`}>
                <div className="guard-row-content">
                  <div className="guard-row-title">
                    <ShieldCheck size={16} className={draft.whitelistEnabled ? "text-primary" : "text-muted"} />
                    <strong>Require approved merchants</strong>
                    <Badge tone={draft.whitelistEnabled ? "info" : "neutral"}>
                      {draft.whitelistEnabled ? "Required" : "Not required"}
                    </Badge>
                  </div>
                  <p className="guard-row-caption">
                    {draft.whitelistEnabled
                      ? "This agent can only pay merchants on the approved list."
                      : "This agent can pay any valid recipient."}
                  </p>
                </div>
                <label className="modern-switch">
                  <input
                    type="checkbox"
                    checked={draft.whitelistEnabled}
                    onChange={(event) => setDraft({ ...draft, whitelistEnabled: event.target.checked })}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>

            {/* Direct Action Bar */}
            <div className="policy-action-bar">
              <div className="policy-changes-status">
                {changedFields.length > 0 ? (
                  <span className="changes-tag pending">
                    <span className="status-dot dot-warning" />
                    <span>{changedFields.length} uncommitted {changedFields.length === 1 ? "change" : "changes"}</span>
                  </span>
                ) : (
                  <span className="changes-tag synced">
                    <span className="status-dot dot-success" />
                    <span>Matches the live rules</span>
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {changedFields.length > 0 && currentPolicy && (
                  <Button
                    type="button"
                    variant="text"
                    onClick={() => setDraft(currentPolicy)}
                    disabled={isPublishing}
                    style={{ fontSize: "0.82rem", color: "var(--muted)" }}
                  >
                    Reset
                  </Button>
                )}

                <Button
                  type="button"
                  variant="tonal"
                  onClick={reviewPolicy}
                  disabled={!agent || isPublishing}
                  style={{ fontSize: "0.84rem" }}
                >
                  <Scale size={14} style={{ marginRight: 6 }} />
                  <span>Review Diffs</span>
                </Button>

                <Button
                  onClick={handleDirectPublish}
                  disabled={!agent || isPublishing}
                  className="publish-policy-btn"
                >
                  <ShieldCheck size={16} />
                  <span>{isPublishing ? "Publishing…" : "Publish"}</span>
                </Button>
              </div>
            </div>

            {message && (
              <div className={`form-message-banner ${message.includes("confirmed") ? "banner-success" : ""}`} style={{ marginTop: "12px" }}>
                {message.includes("confirmed") ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                <span>{message}</span>
              </div>
            )}

            {/* Advanced Risk & Verification Drawer (Collapsible) */}
            <details className="policy-advanced-drawer">
              <summary className="policy-advanced-summary">
                <div className="policy-advanced-summary-left">
                  <SlidersHorizontal size={15} />
                  <span>Advanced tools</span>
                  <Badge tone="neutral">Test · Gradual rollout · Transaction details</Badge>
                </div>
                <ChevronDown size={16} className="policy-advanced-chevron" />
              </summary>
              <div className="policy-advanced-content">
                {/* Visual Policy Delta / Diff Analysis */}
            {policyDiff.length > 0 && (
              <div className="policy-diff-section">
                <div className="policy-dryrun-header">
                  <Scale size={18} />
                  <span>What's changing</span>
                  <Badge tone="info">{policyDiff.length} {policyDiff.length === 1 ? "change" : "changes"}</Badge>
                </div>
                <table className="policy-diff-table">
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Current</th>
                      <th>New</th>
                      <th>Change</th>
                      <th>Risk</th>
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
                <span>Test before you publish</span>
                <Badge tone={dryRunVerdict.allowed ? "success" : "critical"}>
                  {dryRunVerdict.allowed ? "Would go through" : "Would be blocked"}
                </Badge>
              </div>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Try a sample payment against these settings before you publish them.
              </p>
              <div className="policy-dryrun-inputs">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <TextField
                    label="Amount (USDC)"
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
                    label="Recipient"
                    value={dryRunMerchant}
                    onChange={(val) => setDryRunMerchant(val)}
                    options={[
                      { value: "whitelisted", label: "Approved merchant" },
                      { value: "unwhitelisted", label: "Unapproved address" },
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
                      {reasonCodeLabel(dryRunVerdict.title)}
                    </strong>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--on-surface-secondary)" }}>
                    {dryRunVerdict.description}
                  </p>
                  <small style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                    {dryRunVerdict.remediation}
                  </small>
                </div>
              </div>
            </div>

            {/* Canary Policy Deployment & Automated Rollback Guard */}
            <div className="policy-canary-section">
              <div className="policy-canary-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Gauge size={18} />
                  <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Gradual rollout</span>
                </div>
                {canaryDeployment ? (
                  <Badge tone={canaryDeployment.stage === "rolled_back" ? "critical" : canaryDeployment.stage === "promoted_100" ? "success" : "warning"}>
                    {canaryDeployment.trafficPct}% of traffic
                  </Badge>
                ) : (
                  <Badge tone="neutral">Not started</Badge>
                )}
              </div>

              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Roll out this change to a small share of traffic first, then expand once you're confident it's safe. If something looks wrong, roll back instantly.
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
                      <small className="muted-label">Problem rate</small>
                      <strong style={{ color: canaryDeployment.observedBreachRatePct > canaryDeployment.anomalyThresholdPct ? "var(--error)" : "var(--status-good)" }}>
                        {canaryDeployment.observedBreachRatePct.toFixed(1)}%
                      </strong>
                    </div>
                    <div className="canary-metric-box">
                      <small className="muted-label">Safety threshold</small>
                      <strong>{canaryDeployment.anomalyThresholdPct.toFixed(1)}%</strong>
                    </div>
                    <div className="canary-metric-box">
                      <small className="muted-label">Traffic on new rules</small>
                      <strong>{canaryDeployment.trafficPct}%</strong>
                    </div>
                  </div>

                  {/* Safety Alert if Breached */}
                  {canaryDeployment.observedBreachRatePct > canaryDeployment.anomalyThresholdPct && (
                    <div className="canary-breach-alert">
                      <AlertOctagon size={18} />
                      <div>
                        <strong>Unusual activity detected</strong>
                        <p style={{ margin: 0, fontSize: "0.78rem" }}>
                          The problem rate ({canaryDeployment.observedBreachRatePct}%) is above the safety threshold ({canaryDeployment.anomalyThresholdPct}%). Rolling back is recommended.
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
                            ? "Start with 10% of traffic"
                            : canaryDeployment.stage === "canary_10"
                              ? "Move to 25%"
                              : canaryDeployment.stage === "canary_25"
                                ? "Move to 50%"
                                : "Roll out to everyone"}
                        </span>
                      </Button>
                    )}

                    <Button
                      variant="filled"
                      className="control-critical"
                      onClick={handleEmergencyRollback}
                      disabled={isPublishing}
                      title="Instantly restore the previous settings"
                    >
                      <RotateCcw size={14} style={{ marginRight: 6 }} />
                      <span>{isPublishing ? "Rolling back…" : "Roll back now"}</span>
                    </Button>

                    <Button
                      variant="tonal"
                      onClick={handleCancelCanary}
                      disabled={isPublishing}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="canary-idle-banner">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                    <span style={{ fontSize: "0.82rem", color: "var(--on-surface-secondary)" }}>
                      Roll this change out gradually instead of publishing it to everyone at once.
                    </span>
                    <Button
                      variant="tonal"
                      onClick={handleInitCanary}
                      disabled={!agent || changedFields.length === 0}
                    >
                      <Gauge size={14} style={{ marginRight: 6 }} />
                      <span>Start gradual rollout (10%)</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Transaction details inspector */}
            <div className="policy-canary-section" style={{ marginTop: "16px" }}>
              <div className="policy-canary-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Code2 size={18} />
                  <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Transaction details</span>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Paste a transaction's raw data to see what it actually does before approving it.
              </p>

              <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "0.76rem", color: "var(--muted)", marginBottom: "4px", display: "block" }}>
                    Transaction data
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
                    <span>{isInspectingCalldata ? "Checking…" : "Check this transaction"}</span>
                  </Button>
                </div>

                {calldataResult && (
                  <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)", marginTop: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{calldataResult.function_name}</span>
                      <Badge tone={calldataResult.risk_level === "critical" ? "critical" : calldataResult.risk_level === "elevated" ? "warning" : "success"}>
                        {calldataResult.risk_level === "critical" ? "High risk" : calldataResult.risk_level === "elevated" ? "Some risk" : "Low risk"}
                      </Badge>
                    </div>

                    <div style={{ fontSize: "0.82rem", padding: "8px", borderRadius: "6px", background: "var(--surface-sunken)", marginBottom: "8px" }}>
                      <span>{calldataResult.clear_signing_summary}</span>
                    </div>

                    {calldataResult.fields.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.76rem" }}>
                        {calldataResult.fields.map((f, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", borderBottom: i < calldataResult.fields.length - 1 ? "1px solid var(--outline-soft)" : "none", padding: "4px 0" }}>
                            <span style={{ color: "var(--muted)" }}>{f.name}</span>
                            <Mono style={{ fontSize: "0.72rem" }}>{f.value}</Mono>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </details>
      </div>
    </Surface>

        {/* Right Column: Live Onchain State & Verification */}
        <div className="policy-state-column">
          <Surface className="policy-preview-card">
            <div className="preview-card-header">
              <div>
                <h3>Current spending rules</h3>
                <p>What's live right now</p>
              </div>
              <span className="live-status-pill">
                <span className="status-dot dot-success" />
                Live
              </span>
            </div>

            {policy.isError ? (
              <EmptyState title="Policy unavailable" detail="We couldn't load this agent's spending rules." />
            ) : policy.data ? (
              <div className="policy-live-summary">
                <div className="live-summary-row">
                  <span className="summary-row-label">Per transaction</span>
                  <Mono className="summary-row-val">
                    {(Number(policy.data.maxPerTx ?? 0) / 1_000_000).toFixed(2)} USDC
                  </Mono>
                </div>

                <div className="live-summary-row">
                  <span className="summary-row-label">Per period</span>
                  <Mono className="summary-row-val">
                    {(Number(policy.data.maxPerWindow ?? 0) / 1_000_000).toFixed(2)} USDC
                  </Mono>
                </div>

                <div className="live-summary-row">
                  <span className="summary-row-label">Period length</span>
                  <Mono className="summary-row-val">
                    {formatWindowEpoch(Number(policy.data.windowSeconds ?? 3600))}
                  </Mono>
                </div>

                <div className="live-summary-row">
                  <span className="summary-row-label">Max payments per period</span>
                  <Mono className="summary-row-val">{String(policy.data.maxVelocity ?? 1)} txs</Mono>
                </div>

                <div className="live-summary-divider" />

                <div className="live-summary-row">
                  <span className="summary-row-label">Spending</span>
                  <Badge tone={policy.data.killSwitch ? "critical" : "success"}>
                    {policy.data.killSwitch ? "Paused" : "Active"}
                  </Badge>
                </div>

                <div className="live-summary-row">
                  <span className="summary-row-label">Approved merchants</span>
                  <Badge tone={policy.data.whitelistEnabled ? "info" : "neutral"}>
                    {policy.data.whitelistEnabled ? "Required" : "Not required"}
                  </Badge>
                </div>

                <div className="live-summary-footer">
                  <Link to="/app/simulator" className="live-summary-sim-link">
                    <span>Test limits in Simulator</span>
                    <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No agent selected"
                detail="Choose an agent to view and update its spending limits."
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
        description="Confirm the new limits. Nothing changes until you approve in your wallet."
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
              if (key === "maxPerTx" || key === "maxPerWindow") return formatUsdcAmount(String(value ?? 0));
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
