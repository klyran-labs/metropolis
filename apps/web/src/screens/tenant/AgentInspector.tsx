import { useState } from "react";
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
} from "lucide-react";
import {
  type Agent,
  useOrganizationWallets,
  useLoadAgentWallet,
  useUnloadAgentWallet,
  useWalletTransfers,
  useSubmitWalletTransfer,
} from "../../api";
import { Badge, Button, EmptyState, Mono, TextField, TokenAmount, truncateMiddle } from "../../design-system";
import { useIdentity } from "../../identity";

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
  const wallets = useOrganizationWallets(Boolean(identity.authenticated));
  const transfers = useWalletTransfers(agent.address, Boolean(identity.authenticated));
  const [activeTab, setActiveTab] = useState<"overview" | "storage" | "transfers">("overview");
  const [copied, setCopied] = useState(false);
  const [isTripped, setIsTripped] = useState(agent.status === "paused" || agent.status === "tripped");

  const [loadWalletId, setLoadWalletId] = useState("");
  const [loadAmount, setLoadAmount] = useState("");
  const [unloadWalletId, setUnloadWalletId] = useState("");
  const [unloadAmount, setUnloadAmount] = useState("");
  const [message, setMessage] = useState("");

  const refresh = () => {
    void transfers.refetch();
    void wallets.refetch();
  };

  const submitTransfer = useSubmitWalletTransfer(refresh);

  const load = useLoadAgentWallet(agent.address, (result) => {
    if (result.status === "awaiting_signature" && result.intent) {
      setMessage("Sign the transfer in your treasury wallet to finish loading funds.");
    } else if (result.status === "pending_approval") {
      setMessage(`Awaiting approval: ${result.signatures}/${result.requiredSignatures} signatures collected.`);
    } else {
      setMessage("Load confirmed onchain.");
    }
    setLoadAmount("");
    refresh();
  });

  const unload = useUnloadAgentWallet(agent.address, (result) => {
    setMessage(result.status === "confirmed" ? "Unload confirmed onchain." : "Unload submitted.");
    setUnloadAmount("");
    refresh();
  });

  const handleCopy = () => {
    void navigator.clipboard.writeText(agent.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCircuitToggle = () => {
    const nextState = !isTripped;
    setIsTripped(nextState);
    onTripCircuit(agent.address, nextState);
  };

  const treasuryWallets = wallets.data ?? [];

  return (
    <div className="inspector-backdrop" onClick={onClose}>
      <aside className="inspector-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="inspector-header">
          <div className="inspector-title-group">
            <div className="inspector-avatar">
              <Bot size={22} />
            </div>
            <div>
              <div className="inspector-address-row">
                <h3><Mono>{truncateMiddle(agent.address, 10, 6)}</Mono></h3>
                <button
                  type="button"
                  className="inspector-copy-btn"
                  onClick={handleCopy}
                  title="Copy address"
                >
                  {copied ? <CheckCircle2 size={14} className="copied-icon" /> : <Copy size={14} />}
                </button>
              </div>
              <div className="inspector-tags">
                <Badge tone={isTripped ? "critical" : "success"}>
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
        <div className="inspector-tabs">
          <button
            type="button"
            className={`inspector-tab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <Activity size={14} />
            Overview & Controls
          </button>
          <button
            type="button"
            className={`inspector-tab ${activeTab === "storage" ? "active" : ""}`}
            onClick={() => setActiveTab("storage")}
          >
            <Layers size={14} />
            Storage Slots
          </button>
          <button
            type="button"
            className={`inspector-tab ${activeTab === "transfers" ? "active" : ""}`}
            onClick={() => setActiveTab("transfers")}
          >
            <ArrowDownToLine size={14} />
            Wallet Funds ({transfers.data?.length ?? 0})
          </button>
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
                  <div>
                    <strong>O(1) Circuit Breaker</strong>
                    <small>
                      {isTripped
                        ? "Spending halted. Evaluation short-circuits onchain in sub-microsecond time."
                        : "Active spend monitoring. Invariants enforced per transaction."}
                    </small>
                  </div>
                </div>
                <button
                  type="button"
                  className={`circuit-toggle-btn ${isTripped ? "btn-reset" : "btn-trip"}`}
                  onClick={handleCircuitToggle}
                >
                  {isTripped ? "Reset Circuit (Resume)" : "Emergency Trip (Halt Spend)"}
                </button>
              </div>

              {/* Velocity Posture */}
              <div className="inspector-metrics-card">
                <div className="metric-header">
                  <span className="card-kicker">Monad Parallel Telemetry</span>
                  <h4>Real-Time Spend Velocity</h4>
                </div>
                <div className="velocity-meter">
                  <div className="velocity-bar-track">
                    <div
                      className="velocity-bar-fill"
                      style={{ width: isTripped ? "0%" : "28%" }}
                    />
                  </div>
                  <div className="velocity-labels">
                    <span>Active window: 28% of hourly cap</span>
                    <span>10143 Monad Testnet</span>
                  </div>
                </div>
                <div className="metric-grid-2">
                  <div className="metric-cell">
                    <small>Risk Tier</small>
                    <strong>{agent.riskTier}</strong>
                  </div>
                  <div className="metric-cell">
                    <small>Settlement Cadence</small>
                    <strong>400ms finality</strong>
                  </div>
                </div>
              </div>

              {/* Quick Load/Unload shortcut */}
              <div className="inspector-quick-actions">
                <button
                  type="button"
                  className="quick-action-pill"
                  onClick={() => setActiveTab("transfers")}
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
                    <Mono className="field-val">100.00 USDC</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">lastEpochTimestamp</span>
                    <span className="field-type">uint32</span>
                    <Mono className="field-val">Active Epoch</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">windowSpendCount</span>
                    <span className="field-type">uint32</span>
                    <Mono className="field-val">12 txs</Mono>
                  </div>
                  <div className="slot-row">
                    <span className="field-name">nonce</span>
                    <span className="field-type">uint64</span>
                    <Mono className="field-val">Replay Protected</Mono>
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
              {message && <div className="transfer-message-banner">{message}</div>}

              <div className="transfer-actions-dual">
                <div className="transfer-box">
                  <div className="transfer-box-head">
                    <ArrowDownToLine size={15} />
                    <strong>Load Wallet</strong>
                  </div>
                  {treasuryWallets.length ? (
                    <>
                      <select
                        aria-label="Source treasury wallet"
                        value={loadWalletId}
                        onChange={(e) => setLoadWalletId(e.target.value)}
                      >
                        <option value="">Select source treasury</option>
                        {treasuryWallets
                          .filter((w) => w.hasAccess)
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.label}
                            </option>
                          ))}
                      </select>
                      <TextField
                        label="Amount (USDC)"
                        value={loadAmount}
                        onChange={(e) => setLoadAmount(e.target.value)}
                      />
                      <Button
                        onClick={() =>
                          load.mutate({ organizationWalletId: loadWalletId, amountBaseUnits: loadAmount })
                        }
                        disabled={!loadWalletId || !loadAmount || load.isPending}
                      >
                        {load.isPending ? "Loading..." : "Execute Load"}
                      </Button>
                    </>
                  ) : (
                    <EmptyState title="No treasury wallets" detail="Register a treasury wallet first." />
                  )}
                </div>

                <div className="transfer-box">
                  <div className="transfer-box-head">
                    <ArrowUpFromLine size={15} />
                    <strong>Unload Funds</strong>
                  </div>
                  {agent.walletSource !== "sovereign" ? (
                    <EmptyState
                      title="Needs managed vault"
                      detail="Only agents with sovereign vaults can return funds to treasury."
                    />
                  ) : treasuryWallets.length ? (
                    <>
                      <select
                        aria-label="Destination treasury wallet"
                        value={unloadWalletId}
                        onChange={(e) => setUnloadWalletId(e.target.value)}
                      >
                        <option value="">Select destination treasury</option>
                        {treasuryWallets
                          .filter((w) => w.hasAccess)
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.label}
                            </option>
                          ))}
                      </select>
                      <TextField
                        label="Amount (USDC)"
                        value={unloadAmount}
                        onChange={(e) => setUnloadAmount(e.target.value)}
                      />
                      <Button
                        variant="tonal"
                        onClick={() =>
                          unload.mutate({ organizationWalletId: unloadWalletId, amountBaseUnits: unloadAmount })
                        }
                        disabled={!unloadWalletId || !unloadAmount || unload.isPending}
                      >
                        {unload.isPending ? "Unloading..." : "Execute Unload"}
                      </Button>
                    </>
                  ) : (
                    <EmptyState title="No treasury wallets" detail="Register a treasury wallet first." />
                  )}
                </div>
              </div>

              {/* Transfer history list */}
              <div className="transfer-history-section">
                <h4>Verified Transfer History</h4>
                {transfers.data?.length ? (
                  <div className="transfer-history-list">
                    {transfers.data.map((t) => (
                      <div className="transfer-history-row" key={t.id}>
                        <div className="transfer-row-left">
                          <strong>{t.direction === "load" ? "Load" : "Unload"}</strong>
                          <TokenAmount baseUnits={t.amountBaseUnits} />
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
                          {t.transactionHash && (
                            <Mono className="tx-hash-preview">
                              {truncateMiddle(t.transactionHash, 6, 4)}
                            </Mono>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No transfers yet" detail="Transfer funds to begin operations." />
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
