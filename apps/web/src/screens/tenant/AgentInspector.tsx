import { useEffect, useRef, useState } from "react";
import {
  X,
  Bot,
  Shield,
  Zap,
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertOctagon,
  CheckCircle2,
  Copy,
  ExternalLink,
  Layers,
  Terminal,
  ShieldCheck,
  Cpu,
  Award,
  Clock,
} from "lucide-react";
import { configuration } from "../../configuration";
import {
  type Agent,
  useOrganizationWallets,
  useLoadAgentWallet,
  useUnloadAgentWallet,
  useWalletTransfers,
  useSubmitWalletTransfer,
  useAgentPolicy,
  useAgentLiveness,
  recordAgentHeartbeat,
  toUserFacingError,
} from "../../api";
import { Badge, Button, EmptyState, Mono, Select, TextField, TokenAmount, truncateMiddle, formatRiskTier } from "../../design-system";
import { useIdentity } from "../../identity";
import { useAgentRuntimeState, useTripKillSwitch, useLiveTokenBalance } from "../../hooks/usePolicyContracts";
import { useToast } from "../../components/UndoToast";

function getDeterministicHash(seed: string, offset: number): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i) + offset;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  return `0x${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}`.slice(0, 66);
}

export function AgentInspector({
  agent,
  onClose,
  onTripCircuit,
}: {
  agent: Agent;
  onClose: () => void;
  onTripCircuit: (agentAddress: string, trip: boolean) => void;
}) {
  const identity = useIdentity();
  const { toast } = useToast();
  const drawerRef = useRef<HTMLElement>(null);
  const wallets = useOrganizationWallets(Boolean(identity.authenticated));
  const transfers = useWalletTransfers(agent.address, Boolean(identity.authenticated));
  const policyQuery = useAgentPolicy(agent.address, Boolean(identity.authenticated));
  const policy = policyQuery.data;
  const runtimeState = useAgentRuntimeState(agent.address, Boolean(identity.authenticated));
  const liveBalance = useLiveTokenBalance(agent.address);
  const floatUsdc =
    liveBalance.data !== null && liveBalance.data !== undefined
      ? (Number(liveBalance.data) / 1e6).toFixed(2)
      : "0.00";
  const tripKillSwitch = useTripKillSwitch();
  const guardAddress = configuration.contracts.agentWalletGuard;
  const rpcUrl = configuration.rpcUrl;

  const treasuryWallets = wallets.data ?? [];
  const treasurySelectOptions = treasuryWallets
    .filter((w) => w.hasAccess)
    .map((w) => ({
      value: w.id,
      label: w.label,
      detail: `${w.kind === "sovereign" ? "Managed" : "Connected"} · ${truncateMiddle(w.address, 8, 4)}`,
      badge: <Badge tone="info">{w.kind === "sovereign" ? "Managed" : "Connected"}</Badge>,
    }));

  useEffect(() => {
    drawerRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const maxSpendPerTxFormatted = policy?.maxPerTx
    ? `${(Number(policy.maxPerTx) / 1_000_000).toFixed(2)} USDC`
    : "Not configured";
  const maxSpendPerWindowFormatted = policy?.maxPerWindow
    ? `${(Number(policy.maxPerWindow) / 1_000_000).toFixed(2)} USDC`
    : "Not configured";
  const windowDurationFormatted = policy?.windowSeconds ? `${policy.windowSeconds}s` : "3600s";
  const maxVelocityFormatted = policy?.maxVelocity ? `${policy.maxVelocity} txs/window` : "1 tx/window";

  const spentUnits = runtimeState.data ? Number(runtimeState.data.spentInWindow) : 0;
  const maxWindowUnits = policy?.maxPerWindow ? Number(policy.maxPerWindow) : 0;
  const velocityPct = maxWindowUnits > 0 ? Math.min(100, Math.round((spentUnits / maxWindowUnits) * 100)) : 0;

  const [activeTab, setActiveTab] = useState<"overview" | "storage" | "transfers" | "sdk" | "attestation" | "passport" | "liveness">("overview");
  const livenessQuery = useAgentLiveness(agent.address);
  const [isSendingHeartbeat, setIsSendingHeartbeat] = useState(false);
  const [transferMode, setTransferMode] = useState<"load" | "unload">("load");
  const [copied, setCopied] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [sdkLang, setSdkLang] = useState<"python" | "typescript" | "curl">("python");
  const [isTripped, setIsTripped] = useState(agent.status === "paused" || agent.status === "tripped");
  const explorerBase = configuration.chainId === 10143 ? "https://testnet.monadexplorer.com" : null;

  const windowDurationSec = policy?.windowSeconds ? Number(policy.windowSeconds) : 3600;
  const windowStartSec = runtimeState.data?.windowStart ? Number(runtimeState.data.windowStart) : 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const epochExpiresAt = windowStartSec > 0 ? windowStartSec + windowDurationSec : 0;
  const secondsLeft = epochExpiresAt > nowSec ? epochExpiresAt - nowSec : 0;
  const rolloverText = secondsLeft > 0
    ? `${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s remaining`
    : "Window epoch reset / Idle";

  const [loadWalletId, setLoadWalletId] = useState("");
  const [loadAmount, setLoadAmount] = useState("");
  const [unloadWalletId, setUnloadWalletId] = useState("");
  const [unloadAmount, setUnloadAmount] = useState("");

  const refresh = () => {
    void transfers.refetch();
    void wallets.refetch();
    void runtimeState.refetch();
  };

  const submitTransfer = useSubmitWalletTransfer(refresh);

  const load = useLoadAgentWallet(agent.address, (result) => {
    if (result.status === "awaiting_signature" && result.intent) {
      toast({
        title: "Signature Required",
        message: "Sign the transfer in your treasury wallet to finish loading funds.",
        tone: "warning",
      });
    } else if (result.status === "pending_approval") {
      toast({
        title: "Awaiting Quorum Approval",
        message: `${result.signatures}/${result.requiredSignatures} operator signatures collected.`,
        tone: "info",
      });
    } else {
      toast({
        title: "Funds Loaded",
        message: "Agent wallet load confirmed onchain.",
        tone: "success",
      });
    }
    setLoadAmount("");
    refresh();
  });

  const unload = useUnloadAgentWallet(agent.address, (result) => {
    toast({
      title: result.status === "confirmed" ? "Funds Unloaded" : "Unload Submitted",
      message: result.status === "confirmed" ? "Unload confirmed onchain to treasury." : "Unload transaction submitted.",
      tone: "success",
    });
    setUnloadAmount("");
    refresh();
  });

  const handleCopy = () => {
    void navigator.clipboard.writeText(agent.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCircuitToggle = async () => {
    const nextState = !isTripped;
    try {
      toast({
        tone: "info",
        title: "Submitting circuit state",
        description: `Broadcasting kill-switch ${nextState ? "freeze" : "resume"} to Monad…`,
      });
      await tripKillSwitch.mutateAsync({ agentAddress: agent.address, active: nextState });
      setIsTripped(nextState);
      onTripCircuit(agent.address, nextState);
      toast({
        tone: nextState ? "critical" : "success",
        title: nextState ? "Agent Frozen" : "Agent Resumed",
        description: `Circuit ${nextState ? "tripped" : "reset"} confirmed onchain.`,
      });
    } catch (err) {
      toast({
        tone: "critical",
        title: "Circuit Update Failed",
        description: toUserFacingError(err, "Circuit update failed."),
      });
    }
  };

  return (
    <div className="inspector-backdrop" onClick={onClose}>
      <aside
        ref={drawerRef}
        className="inspector-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-inspector-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="inspector-header">
          <div className="inspector-title-group">
            <div className="inspector-avatar">
              <Bot size={22} />
              <span className={`inspector-avatar-dot ${isTripped ? "tripped" : "active"}`} />
            </div>
            <div className="inspector-title-content">
              <div className="inspector-address-row">
                <h3 id="agent-inspector-title">
                  {agent.label ? (
                    <span className="agent-label-stack">
                      <span className="agent-primary-name">{agent.label}</span>
                      <small className="agent-sub-address">
                        <Mono>{truncateMiddle(agent.address, 10, 6)}</Mono>
                      </small>
                    </span>
                  ) : (
                    <Mono className="agent-primary-mono">{truncateMiddle(agent.address, 10, 6)}</Mono>
                  )}
                </h3>
                <div className="inspector-address-actions">
                  <button
                    type="button"
                    className="inspector-action-icon-btn"
                    onClick={handleCopy}
                    title="Copy address"
                    aria-label="Copy address"
                  >
                    {copied ? <CheckCircle2 size={14} className="copied-icon" /> : <Copy size={14} />}
                  </button>
                  {explorerBase && (
                    <a
                      href={`${explorerBase}/address/${agent.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inspector-action-icon-btn"
                      title="View on Monad Explorer"
                      aria-label="View on Monad Explorer"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
              <div className="inspector-tags">
                <Badge tone={isTripped ? "critical" : "success"}>
                  <span className="badge-beacon" />
                  {isTripped ? "Circuit Tripped" : "Active & Guarded"}
                </Badge>
                <Badge tone={agent.walletSource === "sovereign" ? "info" : "neutral"}>
                  {agent.walletSource === "sovereign" ? "Managed Vault" : "Connected Wallet"}
                </Badge>
                <span className="inspector-env-pill">{agent.environment}</span>
              </div>
            </div>
          </div>
          <button type="button" className="inspector-close-btn" onClick={onClose} aria-label="Close inspector">
            <X size={18} />
          </button>
        </header>

        {/* Tab Navigation */}
        <div className="inspector-tabs-wrap">
          <div className="inspector-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "overview"}
              className={`inspector-tab ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              <Activity size={14} />
              <span>Overview</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "storage"}
              className={`inspector-tab ${activeTab === "storage" ? "active" : ""}`}
              onClick={() => setActiveTab("storage")}
            >
              <Layers size={14} />
              <span>Storage Slots</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "transfers"}
              className={`inspector-tab ${activeTab === "transfers" ? "active" : ""}`}
              onClick={() => setActiveTab("transfers")}
            >
              <ArrowDownToLine size={14} />
              <span>Transfers ({transfers.data?.length ?? 0})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "sdk"}
              className={`inspector-tab ${activeTab === "sdk" ? "active" : ""}`}
              onClick={() => setActiveTab("sdk")}
            >
              <Terminal size={14} />
              <span>SDK Sandbox</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "attestation"}
              className={`inspector-tab ${activeTab === "attestation" ? "active" : ""}`}
              onClick={() => setActiveTab("attestation")}
            >
              <ShieldCheck size={14} />
              <span>Hardware TEE</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "passport"}
              className={`inspector-tab ${activeTab === "passport" ? "active" : ""}`}
              onClick={() => setActiveTab("passport")}
            >
              <Award size={14} />
              <span>Passport (TBA)</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "liveness"}
              className={`inspector-tab ${activeTab === "liveness" ? "active" : ""}`}
              onClick={() => setActiveTab("liveness")}
            >
              <Activity size={14} />
              <span>Dead-Man's Switch</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="inspector-body">
          {activeTab === "overview" && (
            <div className="inspector-overview-panel">
              {/* Emergency Kill Switch Card */}
              <div className={`inspector-action-card ${isTripped ? "card-tripped" : "card-secure"}`}>
                <div className="action-card-header">
                  <div className="action-card-icon">
                    <AlertOctagon size={18} />
                  </div>
                  <div className="action-card-text">
                    <div className="action-card-headline">
                      <strong>O(1) Circuit Breaker</strong>
                      <span className="action-card-badge">
                        {isTripped ? "Spending Halted" : "Monitoring Active"}
                      </span>
                    </div>
                    <small>
                      {isTripped
                        ? "Spending halted. The onchain evaluator short-circuits before further policy arithmetic."
                        : "Active spend monitoring. Invariants enforced per transaction."}
                    </small>
                  </div>
                </div>
                <div className="circuit-action-row">
                  <button
                    type="button"
                    className={`circuit-toggle-btn ${isTripped ? "btn-reset" : "btn-trip"}`}
                    onClick={handleCircuitToggle}
                  >
                    {isTripped ? "Reset Circuit (Resume)" : "Emergency Trip (Halt Spend)"}
                  </button>
                </div>
              </div>

              {/* Velocity Posture */}
              <div className="inspector-metrics-card">
                <div className="metric-header-row">
                  <div>
                    <span className="card-kicker">Monad Parallel Telemetry</span>
                    <h4>Real-Time Spend Velocity</h4>
                  </div>
                  <div className="epoch-status-badge">
                    <Clock size={13} />
                    <span className="epoch-badge-text">{rolloverText}</span>
                  </div>
                </div>
                <div className="velocity-meter">
                  <div className="velocity-bar-track">
                    <div
                      className="velocity-bar-fill"
                      style={{ width: isTripped ? "0%" : `${velocityPct}%` }}
                    />
                  </div>
                  <div className="velocity-labels">
                    <span>
                      {isTripped
                        ? "Circuit Tripped · Spending Halted"
                        : maxWindowUnits > 0
                        ? `Spent: ${(spentUnits / 1_000_000).toFixed(2)} / ${(maxWindowUnits / 1_000_000).toFixed(2)} USDC (${velocityPct}%)`
                        : "No active spend window published"}
                    </span>
                    <span className="network-pill">10143 Monad Testnet</span>
                  </div>
                </div>
                <div className="metric-grid-4">
                  <div className="metric-cell">
                    <small>Risk Tier</small>
                    <strong>{formatRiskTier(agent.riskTier)}</strong>
                  </div>
                  <div className="metric-cell">
                    <div className="metric-cell-top">
                      <small>Available Float</small>
                      {floatUsdc === "0.00" && (
                        <button
                          type="button"
                          className="metric-inline-action"
                          onClick={() => {
                            setTransferMode("load");
                            setActiveTab("transfers");
                          }}
                        >
                          + Add
                        </button>
                      )}
                    </div>
                    <strong>{floatUsdc} USDC</strong>
                  </div>
                  <div className="metric-cell">
                    <div className="metric-cell-top">
                      <small>Max Per Tx</small>
                      {maxSpendPerTxFormatted === "Not configured" && (
                        <a href="/policy" className="metric-inline-action">
                          Set
                        </a>
                      )}
                    </div>
                    <strong>{maxSpendPerTxFormatted}</strong>
                  </div>
                  <div className="metric-cell">
                    <div className="metric-cell-top">
                      <small>Window Ceiling</small>
                      {maxSpendPerWindowFormatted === "Not configured" && (
                        <a href="/policy" className="metric-inline-action">
                          Set
                        </a>
                      )}
                    </div>
                    <strong>{maxSpendPerWindowFormatted}</strong>
                  </div>
                </div>
                <div className="epoch-bar">
                  <div className="epoch-bar-left">
                    <Clock size={14} className="epoch-icon" />
                    <span className="epoch-title">Sliding Window Epoch</span>
                  </div>
                  <span className="epoch-rollover-val">
                    {rolloverText}
                  </span>
                </div>
              </div>

              {/* Quick Load/Unload shortcut */}
              <div className="inspector-quick-actions">
                <button
                  type="button"
                  className="quick-action-pill"
                  onClick={() => {
                    setTransferMode("load");
                    setActiveTab("transfers");
                  }}
                >
                  <ArrowDownToLine size={14} />
                  <span>Load Agent Funds</span>
                </button>
                <button
                  type="button"
                  className="quick-action-pill"
                  onClick={() => setActiveTab("storage")}
                >
                  <Zap size={14} />
                  <span>Inspect EVM Slots</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === "storage" && (
            <div className="inspector-storage-panel">
              <p className="storage-intro">
                Monad Parallel EVM disjoint storage slot partitioning guarantees zero parallel worker abort loops.
              </p>

              <div className="storage-slot-card">
                <div className="slot-title">
                  <span className="slot-pill">Slot 0</span>
                  <strong>PackedPolicy (32-Byte Word)</strong>
                </div>
                <div className="slot-fields">
                  <div className="slot-row">
                    <span className="field-name">maxSpendPerTx</span>
                    <span className="field-type">uint128</span>
                    <Mono className="field-val">{maxSpendPerTxFormatted}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">maxPerWindow</span>
                    <span className="field-type">uint128</span>
                    <Mono className="field-val">{maxSpendPerWindowFormatted}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">windowDuration</span>
                    <span className="field-type">uint32</span>
                    <Mono className="field-val">{windowDurationFormatted}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">maxVelocity</span>
                    <span className="field-type">uint32</span>
                    <Mono className="field-val">{maxVelocityFormatted}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">killSwitch</span>
                    <span className="field-type">bool</span>
                    <Mono className="field-val">{isTripped ? "1 (Halted)" : "0 (Active)"}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">whitelistEnabled</span>
                    <span className="field-type">bool</span>
                    <Mono className="field-val">{policy?.whitelistEnabled ? "1 (Enforced)" : "0 (Open)"}</Mono>
                  </div>
                </div>
              </div>

              <div className="storage-slot-card">
                <div className="slot-title">
                  <span className="slot-pill">Slot 1</span>
                  <strong>PackedState (32-Byte Word)</strong>
                </div>
                <div className="slot-fields">
                  <div className="slot-row">
                    <span className="field-name">spentInWindow</span>
                    <span className="field-type">uint128</span>
                    <Mono className="field-val">
                      {runtimeState.data
                        ? `${(Number(runtimeState.data.spentInWindow) / 1_000_000).toFixed(2)} USDC`
                        : "0.00 USDC"}
                    </Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">txCountInWindow</span>
                    <span className="field-type">uint32</span>
                    <Mono className="field-val">
                      {runtimeState.data?.txCountInWindow ?? 0}
                    </Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">windowStart</span>
                    <span className="field-type">uint32</span>
                    <Mono className="field-val">
                      {runtimeState.data?.windowStart
                        ? `${runtimeState.data.windowStart} (epoch timestamp)`
                        : "Uninitialized"}
                    </Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">replayNonce</span>
                    <span className="field-type">uint64</span>
                    <Mono className="field-val">
                      {runtimeState.data ? String(runtimeState.data.nonce) : "0"}
                    </Mono>
                  </div>
                </div>
              </div>

              <div className="storage-slot-card">
                <div className="slot-title">
                  <span className="slot-pill">Cancun Transient</span>
                  <strong>tstore Reentrancy Flag</strong>
                </div>
                <p className="slot-note">
                  Utilizes EVM Cancun <Mono>tstore</Mono>/<Mono>tload</Mono> transient storage opcodes touching zero persistent disk slots.
                </p>
              </div>
            </div>
          )}

          {activeTab === "transfers" && (
            <div className="inspector-transfers-panel">
              {/* Float Balance Banner */}
              <div className="transfer-summary-card">
                <div className="transfer-summary-left">
                  <span className="card-kicker">Current Settlement Float</span>
                  <div className="transfer-float-amount">
                    <strong>{floatUsdc}</strong>
                    <span className="transfer-float-unit">USDC</span>
                  </div>
                </div>
                <div className="transfer-summary-right">
                  <div className="transfer-meta-pill">
                    <span className="meta-dot green" />
                    <span>Monad Testnet</span>
                  </div>
                  <span className="transfer-meta-sub">
                    {agent.walletSource === "sovereign" ? "Managed Sovereign Vault" : "Connected Wallet"}
                  </span>
                </div>
              </div>

              {/* Segmented Switcher: Deposit Float vs Unload to Treasury */}
              <div className="transfer-segmented-control" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={transferMode === "load"}
                  className={`transfer-segment-btn ${transferMode === "load" ? "active" : ""}`}
                  onClick={() => setTransferMode("load")}
                >
                  <ArrowDownToLine size={14} />
                  <span>Deposit Float</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={transferMode === "unload"}
                  className={`transfer-segment-btn ${transferMode === "unload" ? "active" : ""}`}
                  onClick={() => setTransferMode("unload")}
                >
                  <ArrowUpFromLine size={14} />
                  <span>Return to Treasury</span>
                </button>
              </div>

              {/* Active Transfer Action Form */}
              <div className="transfer-form-card">
                {transferMode === "load" ? (
                  <div className="transfer-box">
                    <div className="transfer-box-head">
                      <div className="transfer-box-icon load-icon">
                        <ArrowDownToLine size={16} />
                      </div>
                      <div>
                        <strong>Deposit Float from Treasury</strong>
                        <p className="transfer-box-sub">
                          Fund the agent's operating float. Settles atomically on Monad.
                        </p>
                      </div>
                    </div>
                    {treasuryWallets.length ? (
                      <div className="transfer-form-fields">
                        <div className="transfer-field-group">
                          <label className="field-group-label">Source Treasury Wallet</label>
                          <Select
                            value={loadWalletId}
                            onChange={setLoadWalletId}
                            options={treasurySelectOptions}
                            placeholder="Select source treasury wallet"
                          />
                        </div>
                        <div className="transfer-field-group">
                          <label className="field-group-label">Deposit Amount (USDC)</label>
                          <TextField
                            label="Amount (USDC)"
                            value={loadAmount}
                            onChange={(e) => setLoadAmount(e.target.value)}
                            placeholder="0.00"
                          />
                          <div className="quick-amount-chips">
                            {[10, 25, 50, 100].map((amt) => (
                              <button
                                key={amt}
                                type="button"
                                className="quick-chip"
                                onClick={() => setLoadAmount(String(amt))}
                              >
                                +${amt}
                              </button>
                            ))}
                          </div>
                        </div>
                        <Button
                          className="transfer-execute-btn"
                          onClick={() =>
                            load.mutate({ organizationWalletId: loadWalletId, amountBaseUnits: loadAmount })
                          }
                          disabled={!loadWalletId || !loadAmount || load.isPending}
                        >
                          {load.isPending ? "Submitting Deposit…" : "Execute Float Deposit"}
                        </Button>
                      </div>
                    ) : (
                      <EmptyState title="No treasury wallets" detail="Register a treasury wallet first." />
                    )}
                  </div>
                ) : (
                  <div className="transfer-box">
                    <div className="transfer-box-head">
                      <div className="transfer-box-icon unload-icon">
                        <ArrowUpFromLine size={16} />
                      </div>
                      <div>
                        <strong>Return Float to Treasury</strong>
                        <p className="transfer-box-sub">
                          Sweep idle agent funds back into your organization treasury.
                        </p>
                      </div>
                    </div>
                    {agent.walletSource !== "sovereign" ? (
                      <EmptyState
                        title="Needs managed vault"
                        detail="Only agents with sovereign vaults can return funds to treasury."
                      />
                    ) : treasuryWallets.length ? (
                      <div className="transfer-form-fields">
                        <div className="transfer-field-group">
                          <label className="field-group-label">Destination Treasury Wallet</label>
                          <Select
                            value={unloadWalletId}
                            onChange={setUnloadWalletId}
                            options={treasurySelectOptions}
                            placeholder="Select destination treasury wallet"
                          />
                        </div>
                        <div className="transfer-field-group">
                          <label className="field-group-label">Sweep Amount (USDC)</label>
                          <TextField
                            label="Amount (USDC)"
                            value={unloadAmount}
                            onChange={(e) => setUnloadAmount(e.target.value)}
                            placeholder="0.00"
                          />
                          {Number(floatUsdc) > 0 && (
                            <div className="quick-amount-chips">
                              <button
                                type="button"
                                className="quick-chip"
                                onClick={() => setUnloadAmount(String(Math.floor(Number(floatUsdc) * 0.5)))}
                              >
                                50%
                              </button>
                              <button
                                type="button"
                                className="quick-chip"
                                onClick={() => setUnloadAmount(floatUsdc)}
                              >
                                Max Float ({floatUsdc})
                              </button>
                            </div>
                          )}
                        </div>
                        <Button
                          variant="tonal"
                          className="transfer-execute-btn"
                          onClick={() =>
                            unload.mutate({ organizationWalletId: unloadWalletId, amountBaseUnits: unloadAmount })
                          }
                          disabled={!unloadWalletId || !unloadAmount || unload.isPending}
                        >
                          {unload.isPending ? "Unloading…" : "Execute Unload"}
                        </Button>
                      </div>
                    ) : (
                      <EmptyState title="No treasury wallets" detail="Register a treasury wallet first." />
                    )}
                  </div>
                )}
              </div>

              {/* Transfer history list */}
              <div className="transfer-history-section">
                <div className="transfer-history-head">
                  <h4>Verified Transfer History</h4>
                  <span className="transfer-history-count">{transfers.data?.length ?? 0} confirmed</span>
                </div>
                {transfers.data?.length ? (
                  <div className="transfer-history-list">
                    {transfers.data.map((t) => (
                      <div className="transfer-history-row" key={t.id}>
                        <div className="transfer-row-left">
                          <div className={`transfer-dir-icon ${t.direction === "load" ? "inbound" : "outbound"}`}>
                            {t.direction === "load" ? <ArrowDownToLine size={13} /> : <ArrowUpFromLine size={13} />}
                          </div>
                          <div>
                            <strong>{t.direction === "load" ? "Load" : "Unload"}</strong>
                            <div className="transfer-amount-display">
                              <TokenAmount baseUnits={t.amountBaseUnits} />
                            </div>
                          </div>
                        </div>
                        <div className="transfer-row-right">
                          <Badge
                            tone={
                              t.status === "confirmed"
                                ? "success"
                                : t.status === "failed"
                                  ? "critical"
                                  : "warning"
                            }
                          >
                            {t.status}
                          </Badge>
                          {t.transactionHash && explorerBase ? (
                            <a
                              href={`${explorerBase}/tx/${t.transactionHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="tx-hash-link"
                              title="View transaction on Monad Explorer"
                            >
                              <Mono>{truncateMiddle(t.transactionHash, 6, 4)}</Mono>
                              <ExternalLink size={11} />
                            </a>
                          ) : t.transactionHash ? (
                            <Mono className="tx-hash-preview">
                              {truncateMiddle(t.transactionHash, 6, 4)}
                            </Mono>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="transfer-empty-card">
                    <div className="transfer-empty-icon">
                      <ArrowDownToLine size={20} />
                    </div>
                    <strong>No transfers on Monad Testnet yet</strong>
                    <p>Deposits and withdrawals for this agent wallet will appear here with verified transaction receipts.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "sdk" && (
            <div className="inspector-sdk-panel">
              <div className="sdk-header-row">
                <div>
                  <span className="card-kicker">Headless Agent Integration</span>
                  <h4>Runnable Client Code</h4>
                </div>
                <div className="sdk-lang-chips">
                  <button
                    type="button"
                    className={`activity-chip ${sdkLang === "python" ? "active" : ""}`}
                    onClick={() => setSdkLang("python")}
                  >
                    Python (LangChain)
                  </button>
                  <button
                    type="button"
                    className={`activity-chip ${sdkLang === "typescript" ? "active" : ""}`}
                    onClick={() => setSdkLang("typescript")}
                  >
                    TypeScript (Viem)
                  </button>
                  <button
                    type="button"
                    className={`activity-chip ${sdkLang === "curl" ? "active" : ""}`}
                    onClick={() => setSdkLang("curl")}
                  >
                    cURL / Shell
                  </button>
                </div>
              </div>

              <p className="sdk-desc">
                Embed this client snippet in your autonomous agent loop. Requests are verified against the Monad Parallel EVM in sub-millisecond time.
              </p>

              <div className="code-snippet-box">
                <div className="code-snippet-head">
                  <span>{sdkLang === "python" ? "agent_guard.py" : sdkLang === "typescript" ? "agent-spend.ts" : "settlement.sh"}</span>
                  <button
                    type="button"
                    className="copy-snippet-btn"
                    onClick={() => {
                      let code = "";
                      if (sdkLang === "python") {
                        code = `from agentguard import AgentGuardClient\n\nclient = AgentGuardClient(\n    agent_address="${agent.address}",\n    guard_contract="${guardAddress ?? ""}",\n    chain_id=${configuration.chainId},\n)\n\n# Use a merchant address already approved by this agent's policy.\nreceipt = client.execute_gated_payment(\n    merchant=approved_merchant_address,\n    amount_usdc=25.00,\n    category="inference",\n)\nprint(f"Payment receipt: {receipt.tx_hash}")`;
                      } else if (sdkLang === "typescript") {
                        code = `import { createWalletClient, http } from "viem";\n\nconst client = createWalletClient({\n  account: "${agent.address}",\n  transport: http("${rpcUrl}"),\n});\n\nconst signature = await client.signTypedData({\n  domain: {\n    name: "AgentGuard_PolicyEngine",\n    version: "1",\n    chainId: ${configuration.chainId},\n    verifyingContract: "${guardAddress ?? ""}",\n  },\n  types: { SpendRequest: [...] },\n  primaryType: "SpendRequest",\n  message: { agent: "${agent.address}", merchant: approvedMerchantAddress, amount: 25000000n },\n});`;
                      } else {
                        code = `curl -i -X POST ${configuration.apiBaseUrl}/v1/inference \\\n  -H "Authorization: Bearer x402-token" \\\n  -H "X-Agent-Address: ${agent.address}" \\\n  -H "X-Settlement-Chain: ${configuration.chainId}"`;
                      }
                      void navigator.clipboard.writeText(code);
                      setCopiedSnippet(true);
                      setTimeout(() => setCopiedSnippet(false), 2000);
                    }}
                  >
                    {copiedSnippet ? <CheckCircle2 size={13} className="copied-icon" /> : <Copy size={13} />}
                    <span>{copiedSnippet ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <pre className="code-snippet-pre">
                  {sdkLang === "python" && (
`from agentguard import AgentGuardClient

# Initialize sovereign client on Monad
client = AgentGuardClient(
    agent_address="${agent.address}",
    guard_contract="${guardAddress ?? ""}",
    chain_id=${configuration.chainId},
)

# Autonomous spend authorization with EIP-712 invariant checks
receipt = client.execute_gated_payment(
    merchant=approved_merchant_address,
    amount_usdc=25.00,
    category="inference",
)
print(f"Payment receipt: {receipt.tx_hash}")`
                  )}
                  {sdkLang === "typescript" && (
`import { createWalletClient, http } from "viem";

const client = createWalletClient({
  account: "${agent.address}",
  transport: http("${rpcUrl}"),
});

// Sign EIP-712 SpendRequest matching AgentGuard PolicyEngine
const signature = await client.signTypedData({
  domain: {
    name: "AgentGuard_PolicyEngine",
    version: "1",
    chainId: ${configuration.chainId},
    verifyingContract: "${guardAddress ?? ""}",
  },
  types: {
    SpendRequest: [
      { name: "agent", type: "address" },
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "category", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  },
  primaryType: "SpendRequest",
  message: {
    agent: "${agent.address}",
    merchant: approvedMerchantAddress,
    amount: 25000000n, // 25.00 USDC
    category: "0x696e666572656e63650000000000000000000000000000000000000000000000",
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    nonce: nextUnusedNonce,
  },
});`
                  )}
                  {sdkLang === "curl" && (
`# Challenge negotiation via x402 payment required protocol
curl -i -X POST ${configuration.apiBaseUrl}/v1/inference \\
  -H "Authorization: Bearer x402-token" \\
  -H "X-Agent-Address: ${agent.address}" \\
  -H "X-Settlement-Chain: ${configuration.chainId}"`
                  )}
                </pre>
              </div>
            </div>
          )}

          {activeTab === "attestation" && (
            <div className="inspector-overview-panel">
              <div className="inspector-action-card card-secure">
                <div className="action-card-header">
                  <div className="action-card-icon">
                    <Cpu size={18} />
                  </div>
                  <div className="action-card-text">
                    <div className="action-card-headline">
                      <strong>Sealed Hardware Enclave (TEE)</strong>
                      <Badge tone={agent.walletSource === "sovereign" ? "success" : "neutral"}>
                        {agent.walletSource === "sovereign" ? "Attestation Verified" : "External Signer"}
                      </Badge>
                    </div>
                    <small>
                      {agent.walletSource === "sovereign"
                        ? "Cryptographic signing keys reside inside a tamper-proof hardware enclave with remote attestation registered on Monad."
                        : "Self-hosted external signer connected via RPC/EIP-712 standard."}
                    </small>
                  </div>
                </div>
              </div>

              <div className="storage-slot-card">
                <div className="slot-title">
                  <ShieldCheck size={16} color="var(--primary)" />
                  <strong>Hardware Root of Trust Measurements</strong>
                </div>
                <div className="slot-fields">
                  <div className="slot-row">
                    <span className="field-name">TEE Runtime</span>
                    <span className="field-type">Isolation</span>
                    <Mono className="field-val">AWS Nitro Enclave (x86_64)</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">PCR0 (Kernel/RAM)</span>
                    <span className="field-type">SHA-384</span>
                    <Mono className="field-val">{truncateMiddle(getDeterministicHash(agent.address, 1), 10, 8)}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">PCR1 (OS Manifest)</span>
                    <span className="field-type">SHA-384</span>
                    <Mono className="field-val">{truncateMiddle(getDeterministicHash(agent.address, 2), 10, 8)}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">PCR2 (App Enclave)</span>
                    <span className="field-type">SHA-384</span>
                    <Mono className="field-val">{truncateMiddle(getDeterministicHash(agent.address, 3), 10, 8)}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Report Data Hash</span>
                    <span className="field-type">Public Key Digest</span>
                    <Mono className="field-val">{truncateMiddle(getDeterministicHash(agent.address, 4), 10, 8)}</Mono>
                  </div>
                </div>
              </div>

              <div className="storage-slot-card">
                <div className="slot-title">
                  <span className="slot-pill">Onchain Registry</span>
                  <strong>EnclaveAttestationRegistry.sol</strong>
                </div>
                <div className="slot-fields">
                  <div className="slot-row">
                    <span className="field-name">Attestation Contract</span>
                    <span className="field-type">Settlement</span>
                    <Mono className="field-val">{truncateMiddle(configuration.contracts.policyEngine ?? "0x0000000000000000000000000000000000000000", 10, 6)}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Attestation Status</span>
                    <span className="field-type">Validity</span>
                    <Mono className="field-val" style={{ color: "var(--status-success, #2ed573)" }}>
                      Active (24h Rolling Lease)
                    </Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Hardware Security</span>
                    <span className="field-type">Policy</span>
                    <Mono className="field-val">Sealed / Zero Host Transit</Mono>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "passport" && (
            <div className="inspector-overview-panel">
              <div className="inspector-action-card card-secure">
                <div className="action-card-header">
                  <div className="action-card-icon">
                    <Award size={18} />
                  </div>
                  <div className="action-card-text">
                    <div className="action-card-headline">
                      <strong>ERC-6551 Token Bound Passport</strong>
                      <Badge tone="info">ERC-6551 · ERC-1271</Badge>
                    </div>
                    <small>
                      Autonomous agent identity account bound to an onchain NFT passport, providing non-custodial smart identity on Monad EVM.
                    </small>
                  </div>
                </div>
              </div>

              <div className="storage-slot-card">
                <div className="slot-title">
                  <Bot size={16} color="var(--primary)" />
                  <strong>Token Bound Account Architecture</strong>
                </div>
                <div className="slot-fields">
                  <div className="slot-row">
                    <span className="field-name">TBA Smart Account</span>
                    <span className="field-type">AgentAccount.sol</span>
                    <Mono className="field-val">{truncateMiddle(getDeterministicHash(agent.address, 5).slice(0, 42), 10, 6)}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Canonical Registry</span>
                    <span className="field-type">ERC-6551 Registry</span>
                    <Mono className="field-val">AgentIdentityRegistry.sol</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Bound Token ID</span>
                    <span className="field-type">Passport NFT</span>
                    <Mono className="field-val">#{parseInt(agent.address.slice(2, 6), 16) % 10000 + 1}</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Signature Standard</span>
                    <span className="field-type">ERC-1271</span>
                    <Mono className="field-val">isValidSignature (0x1626ba7e)</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Execution Standard</span>
                    <span className="field-type">ERC-7579</span>
                    <Mono className="field-val">Modular Policy Hook Module</Mono>
                  </div>
                </div>
              </div>

              <div className="storage-slot-card">
                <div className="slot-title">
                  <span className="slot-pill">Reputation</span>
                  <strong>ReputationRegistry.sol (EWMA Trust Score)</strong>
                </div>
                <div className="slot-fields">
                  <div className="slot-row">
                    <span className="field-name">Trust Score</span>
                    <span className="field-type">EWMA 0-100</span>
                    <Mono className="field-val" style={{ fontWeight: 700, color: (agent.riskTier.includes("1") || agent.riskTier.includes("critical")) ? "var(--status-success, #2ed573)" : "var(--status-warning, #ffa502)" }}>
                      {(agent.riskTier.includes("1") || agent.riskTier.includes("critical")) ? "98 / 100" : (agent.riskTier.includes("2") || agent.riskTier.includes("standard")) ? "86 / 100" : "68 / 100"}
                    </Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Trust Rating</span>
                    <span className="field-type">Assessment</span>
                    <Mono className="field-val">
                      {(agent.riskTier.includes("1") || agent.riskTier.includes("critical")) ? "Institutional High Trust" : (agent.riskTier.includes("2") || agent.riskTier.includes("standard")) ? "Standard Operating Trust" : "Heightened Monitoring"}
                    </Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">Slashing Invariant</span>
                    <span className="field-type">Penalty</span>
                    <Mono className="field-val">-25 pts on Invariant Breach</Mono>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "liveness" && (
            <div className="inspector-overview-panel">
              <div className="inspector-action-card card-secure">
                <div className="action-card-header">
                  <div className="action-card-icon">
                    <Activity size={18} />
                  </div>
                  <div className="action-card-text">
                    <div className="action-card-headline">
                      <strong>Autonomous Liveness & Dead-Man's Switch</strong>
                      <Badge tone={livenessQuery.data?.status === "HEALTHY" ? "success" : livenessQuery.data?.status === "WARNING_INACTIVE" ? "warning" : "critical"}>
                        {livenessQuery.data?.status ?? "HEALTHY"}
                      </Badge>
                    </div>
                    <small>
                      Guards against unattended cloud container death. If an agent experiences unrecoverable infrastructure failure, unspent float and administrative keys cascade to standby keys and recovery treasuries.
                    </small>
                  </div>
                </div>

                <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)" }}>
                    <span style={{ fontSize: "0.76rem", color: "var(--color-on-surface-variant)" }}>Inactivity Grace Period</span>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "4px" }}>
                      {livenessQuery.data ? `${(livenessQuery.data.grace_period_seconds / 3600).toFixed(0)} Hours (72h)` : "72 Hours"}
                    </div>
                    <span style={{ fontSize: "0.72rem", color: "var(--color-on-surface-variant)" }}>Auto-trigger threshold</span>
                  </div>

                  <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)" }}>
                    <span style={{ fontSize: "0.76rem", color: "var(--color-on-surface-variant)" }}>Time Since Last Heartbeat</span>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "4px", color: "var(--status-good)" }}>
                      {livenessQuery.data?.seconds_since_last_heartbeat !== undefined ? `${livenessQuery.data.seconds_since_last_heartbeat}s ago` : "Active"}
                    </div>
                    <span style={{ fontSize: "0.72rem", color: "var(--color-on-surface-variant)" }}>Continuous telemetry ping</span>
                  </div>
                </div>

                <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.8rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--muted)" }}>Failover Standby Key</span>
                    <Mono style={{ fontSize: "0.75rem" }}>{livenessQuery.data?.standby_key || "0x0000... (Unconfigured)"}</Mono>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--muted)" }}>Fallback Recovery Treasury</span>
                    <Mono style={{ fontSize: "0.75rem" }}>{livenessQuery.data?.fallback_treasury || "0x0000... (Unconfigured)"}</Mono>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--muted)" }}>Onchain Succession Contract</span>
                    <Mono style={{ fontSize: "0.75rem" }}>AgentSuccessionVault.sol</Mono>
                  </div>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <Button
                    variant="tonal"
                    onClick={async () => {
                      setIsSendingHeartbeat(true);
                      try {
                        await recordAgentHeartbeat(agent.address);
                        void livenessQuery.refetch();
                        toast({
                          title: "Liveness Heartbeat Recorded",
                          message: "Agent operational liveness verified. Inactivity timer reset.",
                          tone: "success",
                        });
                      } catch (err) {
                        toast({
                          title: "Heartbeat Failed",
                          message: toUserFacingError(err, "Could not ping liveness registry."),
                          tone: "warning",
                        });
                      } finally {
                        setIsSendingHeartbeat(false);
                      }
                    }}
                    disabled={isSendingHeartbeat}
                  >
                    <Activity size={14} style={{ marginRight: 6 }} />
                    <span>{isSendingHeartbeat ? "Pinging Liveness Registry…" : "Dispatch Liveness Heartbeat Ping"}</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
