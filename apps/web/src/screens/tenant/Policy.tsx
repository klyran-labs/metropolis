import { useWallets } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { request, toUserFacingError, useAgentPolicy, useAgents, type PolicyUpdate } from "../../api";
import {
  AgentSelect,
  Badge,
  Button,
  Dialog,
  EmptyState,
  formatTokenAmount,
  Mono,
  RecordSummary,
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

  const publish = async () => {
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
        { method: "POST", body: JSON.stringify(draft) },
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
    } catch (error) {
      const safeError = toUserFacingError(error, "The policy change could not be completed.");
      setTransactionPhase("failed");
      setTransactionError(safeError);
      setMessage(safeError);
    } finally {
      setIsPublishing(false);
    }
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
                  <button
                    type="button"
                    className={`duration-chip ${draft.windowSeconds === 900 ? "active" : ""}`}
                    onClick={() => setDuration(900)}
                  >
                    15m
                  </button>
                  <button
                    type="button"
                    className={`duration-chip ${draft.windowSeconds === 3600 ? "active" : ""}`}
                    onClick={() => setDuration(3600)}
                  >
                    1h
                  </button>
                  <button
                    type="button"
                    className={`duration-chip ${draft.windowSeconds === 86400 ? "active" : ""}`}
                    onClick={() => setDuration(86400)}
                  >
                    24h
                  </button>
                  <span className="duration-epoch-label">
                    {draft.windowSeconds === 900
                      ? "15 mins"
                      : draft.windowSeconds === 3600
                      ? "1 hour"
                      : draft.windowSeconds === 86400
                      ? "24 hours"
                      : `${draft.windowSeconds}s epoch`}
                  </span>
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
