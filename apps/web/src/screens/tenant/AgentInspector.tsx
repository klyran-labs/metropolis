import { useEffect, useRef, useState } from "react";
import {
  X,
  Bot,
  Shield,
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertOctagon,
  CheckCircle2,
  Copy,
  ExternalLink,
  Terminal,
  ShieldCheck,
  Cpu,
  Award,
  Clock,
  ChevronDown,
  ChevronUp,
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
import {
  Badge,
  Button,
  EmptyState,
  Mono,
  Select,
  Tabs,
  tabPanelProps,
  TextField,
  Tooltip,
  TokenAmount,
  truncateMiddle,
  formatRiskTier,
  type TabItem,
} from "../../design-system";
import { walletSourceLabel, trustScoreLabel } from "../../copy";
import { useIdentity } from "../../identity";
import { useAgentReputation, useAgentRuntimeState, useTripKillSwitch, useLiveTokenBalance } from "../../hooks/usePolicyContracts";
import { useToast } from "../../components/UndoToast";

type InspectorTab = "overview" | "wallet" | "security" | "health" | "integrate";

const TAB_ITEMS: TabItem[] = [
  { key: "overview", label: "Overview", icon: <Activity size={14} /> },
  { key: "wallet", label: "Wallet", icon: <ArrowDownToLine size={14} /> },
  { key: "security", label: "Security", icon: <ShieldCheck size={14} /> },
  { key: "health", label: "Health", icon: <Clock size={14} /> },
  { key: "integrate", label: "Integrate", icon: <Terminal size={14} /> },
];

export function AgentInspector({
  agent,
  onClose,
  onTripCircuit,
  onPrevAgent,
  onNextAgent,
  currentIndex,
  totalCount,
}: {
  agent: Agent;
  onClose: () => void;
  onTripCircuit: (agentAddress: string, trip: boolean) => void;
  onPrevAgent?: () => void;
  onNextAgent?: () => void;
  currentIndex?: number;
  totalCount?: number;
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
  const reputation = useAgentReputation(agent.address, Boolean(identity.authenticated));
  const tripKillSwitch = useTripKillSwitch();
  const guardAddress = configuration.contracts.agentWalletGuard;
  const rpcUrl = configuration.rpcUrl;

  const treasuryWallets = wallets.data ?? [];
  const treasurySelectOptions = treasuryWallets
    .filter((w) => w.hasAccess)
    .map((w) => ({
      value: w.id,
      label: w.label,
      detail: `${walletSourceLabel(w.kind)} · ${truncateMiddle(w.address, 8, 4)}`,
      badge: <Badge tone="info">{w.kind === "sovereign" ? "Secure" : "Connected"}</Badge>,
    }));

  useEffect(() => {
    drawerRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "") || Boolean(target?.isContentEditable);
      if (isInput) return;

      if ((event.key === "j" || event.key === "ArrowDown") && onNextAgent) {
        event.preventDefault();
        onNextAgent();
      } else if ((event.key === "k" || event.key === "ArrowUp") && onPrevAgent) {
        event.preventDefault();
        onPrevAgent();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onNextAgent, onPrevAgent]);

  const maxSpendPerTxFormatted = policy?.maxPerTx
    ? `${(Number(policy.maxPerTx) / 1_000_000).toFixed(2)} USDC`
    : "Not set";
  const maxSpendPerWindowFormatted = policy?.maxPerWindow
    ? `${(Number(policy.maxPerWindow) / 1_000_000).toFixed(2)} USDC`
    : "Not set";

  const spentUnits = runtimeState.data ? Number(runtimeState.data.spentInWindow) : 0;
  const maxWindowUnits = policy?.maxPerWindow ? Number(policy.maxPerWindow) : 0;
  const velocityPct = maxWindowUnits > 0 ? Math.min(100, Math.round((spentUnits / maxWindowUnits) * 100)) : 0;

  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");
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
    ? `Resets in ${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`
    : "Resets now";

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
        title: "Signature needed",
        message: "Approve the transfer in your treasury wallet to finish adding funds.",
        tone: "warning",
      });
    } else if (result.status === "pending_approval") {
      toast({
        title: "Waiting on approvals",
        message: `${result.signatures}/${result.requiredSignatures} approvals collected.`,
        tone: "info",
      });
    } else {
      toast({
        title: "Funds added",
        message: "The agent's wallet has been topped up.",
        tone: "success",
      });
    }
    setLoadAmount("");
    refresh();
  });

  const unload = useUnloadAgentWallet(agent.address, (result) => {
    toast({
      title: result.status === "confirmed" ? "Funds withdrawn" : "Withdrawal submitted",
      message: result.status === "confirmed" ? "Sent back to your treasury." : "The withdrawal is on its way.",
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
        title: nextState ? "Pausing agent…" : "Resuming agent…",
        description: nextState ? "Stopping this agent from spending." : "Letting this agent spend again.",
      });
      await tripKillSwitch.mutateAsync({ agentAddress: agent.address, active: nextState });
      setIsTripped(nextState);
      onTripCircuit(agent.address, nextState);
      toast({
        tone: nextState ? "critical" : "success",
        title: nextState ? "Agent paused" : "Agent resumed",
        description: nextState ? "This agent can no longer spend." : "This agent can spend again.",
      });
    } catch (err) {
      toast({
        tone: "critical",
        title: "Couldn't update agent",
        description: toUserFacingError(err, "That action failed. Try again."),
      });
    }
  };

  const createdOn = new Date(agent.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

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
                      title="View transaction history"
                      aria-label="View transaction history"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
              <div className="inspector-tags">
                <Badge tone={isTripped ? "critical" : "success"}>
                  <span className="badge-beacon" />
                  {isTripped ? "Paused" : "Active"}
                </Badge>
                <Badge tone={agent.walletSource === "sovereign" ? "info" : "neutral"}>
                  {walletSourceLabel(agent.walletSource)}
                </Badge>
                <span className="inspector-env-pill">{agent.environment}</span>
              </div>
            </div>
          </div>
          {totalCount !== undefined && currentIndex !== undefined && (
            <div className="drawer-cycle-controls" aria-label="Cycle agents">
              <button
                type="button"
                className="drawer-cycle-btn"
                onClick={onPrevAgent}
                disabled={!onPrevAgent}
                title="Previous agent (K or ↑)"
                aria-label="Previous agent"
              >
                <ChevronUp size={14} />
              </button>
              <span className="drawer-cycle-counter">
                {currentIndex + 1} / {totalCount}
              </span>
              <button
                type="button"
                className="drawer-cycle-btn"
                onClick={onNextAgent}
                disabled={!onNextAgent}
                title="Next agent (J or ↓)"
                aria-label="Next agent"
              >
                <ChevronDown size={14} />
              </button>
              <span className="drawer-cycle-kbd">J/K</span>
            </div>
          )}
          <button type="button" className="inspector-close-btn" onClick={onClose} aria-label="Close inspector">
            <X size={18} />
          </button>
        </header>

        {/* Tab Navigation */}
        <div className="inspector-tabs-wrap">
          <Tabs
            items={TAB_ITEMS}
            active={activeTab}
            idPrefix="inspector"
            label="Agent details"
            onChange={(key) => setActiveTab(key as InspectorTab)}
          />
        </div>

        {/* Tab Content */}
        <div className="inspector-body">
          {activeTab === "overview" && (
            <div className="inspector-overview-panel" {...tabPanelProps("inspector", "overview", activeTab)}>
              {/* Pause / resume */}
              <div className={`inspector-action-card ${isTripped ? "card-tripped" : "card-secure"}`}>
                <div className="action-card-header">
                  <div className="action-card-icon">
                    <AlertOctagon size={18} />
                  </div>
                  <div className="action-card-text">
                    <div className="action-card-headline">
                      <strong>Spending</strong>
                      <span className="action-card-badge">{isTripped ? "Paused" : "Active"}</span>
                    </div>
                    <small>
                      {isTripped
                        ? "This agent can't spend while paused."
                        : "Every payment is checked against this agent's spending rules before it goes through."}
                    </small>
                  </div>
                </div>
                <div className="circuit-action-row">
                  <button
                    type="button"
                    className={`circuit-toggle-btn ${isTripped ? "btn-reset" : "btn-trip"}`}
                    onClick={handleCircuitToggle}
                  >
                    {isTripped ? "Resume agent" : "Pause agent"}
                  </button>
                </div>
              </div>

              {/* Spending this period */}
              <div className="inspector-metrics-card">
                <div className="metric-header-row">
                  <div>
                    <span className="card-kicker">Spending</span>
                    <h4>This period</h4>
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
                        ? "Paused — can't spend"
                        : maxWindowUnits > 0
                        ? `Spent ${(spentUnits / 1_000_000).toFixed(2)} of ${(maxWindowUnits / 1_000_000).toFixed(2)} USDC (${velocityPct}%)`
                        : "No spending limit set yet"}
                    </span>
                  </div>
                </div>
                <div className="metric-grid-4">
                  <div className="metric-cell">
                    <small>Risk tier</small>
                    <strong>{formatRiskTier(agent.riskTier)}</strong>
                  </div>
                  <div className="metric-cell">
                    <div className="metric-cell-top">
                      <small>Balance</small>
                      {floatUsdc === "0.00" && (
                        <button
                          type="button"
                          className="metric-inline-action"
                          onClick={() => {
                            setTransferMode("load");
                            setActiveTab("wallet");
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
                      <small>Per-payment limit</small>
                      {maxSpendPerTxFormatted === "Not set" && (
                        <a href="/policy" className="metric-inline-action">
                          Set
                        </a>
                      )}
                    </div>
                    <strong>{maxSpendPerTxFormatted}</strong>
                  </div>
                  <div className="metric-cell">
                    <div className="metric-cell-top">
                      <small>Period limit</small>
                      {maxSpendPerWindowFormatted === "Not set" && (
                        <a href="/policy" className="metric-inline-action">
                          Set
                        </a>
                      )}
                    </div>
                    <strong>{maxSpendPerWindowFormatted}</strong>
                  </div>
                </div>
              </div>

              {/* Quick actions */}
              <div className="inspector-quick-actions">
                <button
                  type="button"
                  className="quick-action-pill"
                  onClick={() => {
                    setTransferMode("load");
                    setActiveTab("wallet");
                  }}
                >
                  <ArrowDownToLine size={14} />
                  <span>Add funds</span>
                </button>
                <button
                  type="button"
                  className="quick-action-pill"
                  onClick={() => setActiveTab("security")}
                >
                  <ShieldCheck size={14} />
                  <span>View security</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === "wallet" && (
            <div className="inspector-transfers-panel" {...tabPanelProps("inspector", "wallet", activeTab)}>
              {/* Balance Banner */}
              <div className="transfer-summary-card">
                <div className="transfer-summary-left">
                  <span className="card-kicker">Balance</span>
                  <div className="transfer-float-amount">
                    <strong>{floatUsdc}</strong>
                    <span className="transfer-float-unit">USDC</span>
                  </div>
                </div>
                <div className="transfer-summary-right">
                  <div className="transfer-meta-pill">
                    <span className="meta-dot green" />
                    <span>Live</span>
                  </div>
                  <span className="transfer-meta-sub">{walletSourceLabel(agent.walletSource)}</span>
                </div>
              </div>

              {/* Segmented Switcher: Add funds vs Withdraw */}
              <div className="transfer-segmented-control" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={transferMode === "load"}
                  className={`transfer-segment-btn ${transferMode === "load" ? "active" : ""}`}
                  onClick={() => setTransferMode("load")}
                >
                  <ArrowDownToLine size={14} />
                  <span>Add funds</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={transferMode === "unload"}
                  className={`transfer-segment-btn ${transferMode === "unload" ? "active" : ""}`}
                  onClick={() => setTransferMode("unload")}
                >
                  <ArrowUpFromLine size={14} />
                  <span>Withdraw</span>
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
                        <strong>Add funds from treasury</strong>
                        <p className="transfer-box-sub">
                          Move money from your treasury into this agent's wallet.
                        </p>
                      </div>
                    </div>
                    {treasuryWallets.length ? (
                      <div className="transfer-form-fields">
                        <div className="transfer-field-group">
                          <label className="field-group-label">From</label>
                          <Select
                            value={loadWalletId}
                            onChange={setLoadWalletId}
                            options={treasurySelectOptions}
                            placeholder="Choose a treasury wallet"
                          />
                        </div>
                        <div className="transfer-field-group">
                          <label className="field-group-label">Amount (USDC)</label>
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
                          {load.isPending ? "Adding funds…" : "Add funds"}
                        </Button>
                      </div>
                    ) : (
                      <EmptyState kind="wallet" title="No treasury wallets yet" detail="Add a treasury wallet first." tone="info" />
                    )}
                  </div>
                ) : (
                  <div className="transfer-box">
                    <div className="transfer-box-head">
                      <div className="transfer-box-icon unload-icon">
                        <ArrowUpFromLine size={16} />
                      </div>
                      <div>
                        <strong>Withdraw to treasury</strong>
                        <p className="transfer-box-sub">
                          Move money from this agent's wallet back to your treasury.
                        </p>
                      </div>
                    </div>
                    {agent.walletSource !== "sovereign" ? (
                      <EmptyState kind="wallet"
                        title="Needs a secure wallet"
                        detail="Only agents with a secure, hosted wallet can send funds back to treasury."
                        tone="info"
                      />
                    ) : treasuryWallets.length ? (
                      <div className="transfer-form-fields">
                        <div className="transfer-field-group">
                          <label className="field-group-label">To</label>
                          <Select
                            value={unloadWalletId}
                            onChange={setUnloadWalletId}
                            options={treasurySelectOptions}
                            placeholder="Choose a treasury wallet"
                          />
                        </div>
                        <div className="transfer-field-group">
                          <label className="field-group-label">Amount (USDC)</label>
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
                                Max ({floatUsdc})
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
                          {unload.isPending ? "Withdrawing…" : "Withdraw"}
                        </Button>
                      </div>
                    ) : (
                      <EmptyState kind="wallet" title="No treasury wallets yet" detail="Add a treasury wallet first." tone="info" />
                    )}
                  </div>
                )}
              </div>

              {/* Transfer history list */}
              <div className="transfer-history-section">
                <div className="transfer-history-head">
                  <h4>Transfer history</h4>
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
                            <strong>{t.direction === "load" ? "Added" : "Withdrew"}</strong>
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
                              title="View transaction"
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
                    <strong>No transfers yet</strong>
                    <p>Deposits and withdrawals will show up here.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "security" && (
            <div className="inspector-overview-panel" {...tabPanelProps("inspector", "security", activeTab)}>
              <div className="inspector-action-card card-secure">
                <div className="action-card-header">
                  <div className="action-card-icon">
                    <Cpu size={18} />
                  </div>
                  <div className="action-card-text">
                    <div className="action-card-headline">
                      <strong>Hardware security</strong>
                      <Badge tone={agent.walletSource === "sovereign" ? "success" : "neutral"}>
                        {agent.walletSource === "sovereign" ? "Verified" : "Not applicable"}
                      </Badge>
                    </div>
                    <small>
                      {agent.walletSource === "sovereign" ? (
                        <>
                          This agent's signing keys live in tamper-proof hardware we can cryptographically verify.{" "}
                          <Tooltip label="We check a cryptographic proof from the hardware manufacturer that the signing environment hasn't been tampered with.">
                            <span className="inline-help">What does this mean?</span>
                          </Tooltip>
                        </>
                      ) : (
                        "This agent uses its own wallet or signer that you manage directly."
                      )}
                    </small>
                  </div>
                </div>
              </div>

              <div className="inspector-action-card card-secure">
                <div className="action-card-header">
                  <div className="action-card-icon">
                    <Award size={18} />
                  </div>
                  <div className="action-card-text">
                    <div className="action-card-headline">
                      <strong>Agent identity</strong>
                    </div>
                    <small>
                      Each agent has its own secure identity, so it can act independently without sharing your main account.
                    </small>
                  </div>
                </div>
                <div className="metric-grid-4" style={{ marginTop: "var(--space-16)" }}>
                  <div className="metric-cell">
                    <small>Wallet</small>
                    <Mono>{truncateMiddle(agent.address, 8, 4)}</Mono>
                  </div>
                  <div className="metric-cell">
                    <small>Created</small>
                    <strong>{createdOn}</strong>
                  </div>
                  <div className="metric-cell">
                    <small>Trust score</small>
                    <strong>{trustScoreLabel(reputation.data?.scorePercent)}</strong>
                  </div>
                  {reputation.data && (
                    <div className="metric-cell">
                      <small>Payment history</small>
                      <strong>
                        {reputation.data.settledCount} settled
                        {reputation.data.disputedCount > 0 ? ` · ${reputation.data.disputedCount} disputed` : ""}
                      </strong>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "health" && (
            <div className="inspector-overview-panel" {...tabPanelProps("inspector", "health", activeTab)}>
              <div className="inspector-action-card card-secure">
                <div className="action-card-header">
                  <div className="action-card-icon">
                    <Activity size={18} />
                  </div>
                  <div className="action-card-text">
                    <div className="action-card-headline">
                      <strong>Health check</strong>
                      <Badge tone={!livenessQuery.data ? "neutral" : livenessQuery.data.status === "HEALTHY" ? "success" : livenessQuery.data.status === "WARNING_INACTIVE" ? "warning" : "critical"}>
                        {!livenessQuery.data ? "Checking…" : livenessQuery.data.status === "HEALTHY" ? "Healthy" : "Needs attention"}
                      </Badge>
                    </div>
                    <small>
                      If this agent goes quiet for too long, we automatically pause it and move its funds to your recovery treasury.
                    </small>
                  </div>
                </div>

                <div className="metric-grid-4" style={{ marginTop: "var(--space-16)" }}>
                  <div className="metric-cell">
                    <small>Auto-pause after</small>
                    <strong>{livenessQuery.data ? `${(livenessQuery.data.grace_period_seconds / 3600).toFixed(0)}h of inactivity` : "—"}</strong>
                  </div>
                  <div className="metric-cell">
                    <small>Last seen</small>
                    <strong>
                      {livenessQuery.data?.seconds_since_last_heartbeat !== undefined
                        ? `${livenessQuery.data.seconds_since_last_heartbeat}s ago`
                        : "—"}
                    </strong>
                  </div>
                  {livenessQuery.data?.fallback_treasury && (
                    <div className="metric-cell">
                      <small>Recovery wallet</small>
                      <Mono style={{ fontSize: "var(--text-sm)" }}>
                        {truncateMiddle(livenessQuery.data.fallback_treasury, 6, 4)}
                      </Mono>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: "var(--space-16)" }}>
                  <Button
                    variant="tonal"
                    onClick={async () => {
                      setIsSendingHeartbeat(true);
                      try {
                        await recordAgentHeartbeat(agent.address);
                        void livenessQuery.refetch();
                        toast({
                          title: "Health check sent",
                          message: "This agent is confirmed active.",
                          tone: "success",
                        });
                      } catch (err) {
                        toast({
                          title: "Couldn't send health check",
                          message: toUserFacingError(err, "Try again in a moment."),
                          tone: "warning",
                        });
                      } finally {
                        setIsSendingHeartbeat(false);
                      }
                    }}
                    disabled={isSendingHeartbeat}
                  >
                    <Activity size={14} style={{ marginRight: 6 }} />
                    <span>{isSendingHeartbeat ? "Sending…" : "Send health check now"}</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "integrate" && (
            <div className="inspector-sdk-panel" {...tabPanelProps("inspector", "integrate", activeTab)}>
              <div className="sdk-header-row">
                <div>
                  <span className="card-kicker">Developers</span>
                  <h4>Connect this agent</h4>
                </div>
                <div className="sdk-lang-chips">
                  <button
                    type="button"
                    className={`activity-chip ${sdkLang === "python" ? "active" : ""}`}
                    onClick={() => setSdkLang("python")}
                  >
                    Python
                  </button>
                  <button
                    type="button"
                    className={`activity-chip ${sdkLang === "typescript" ? "active" : ""}`}
                    onClick={() => setSdkLang("typescript")}
                  >
                    TypeScript
                  </button>
                  <button
                    type="button"
                    className={`activity-chip ${sdkLang === "curl" ? "active" : ""}`}
                    onClick={() => setSdkLang("curl")}
                  >
                    cURL
                  </button>
                </div>
              </div>

              <p className="sdk-desc">
                Use this code to let your agent make payments automatically, within the limits you've set.
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
                <pre className="code-snippet-pre" tabIndex={0} aria-label="Code sample">
                  {sdkLang === "python" && (
`from agentguard import AgentGuardClient

client = AgentGuardClient(
    agent_address="${agent.address}",
    guard_contract="${guardAddress ?? ""}",
    chain_id=${configuration.chainId},
)

# Checked automatically against this agent's spending rules
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

// Sign the payment request so it can be verified
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
`# Payment handshake
curl -i -X POST ${configuration.apiBaseUrl}/v1/inference \\
  -H "Authorization: Bearer x402-token" \\
  -H "X-Agent-Address: ${agent.address}" \\
  -H "X-Settlement-Chain: ${configuration.chainId}"`
                  )}
                </pre>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
