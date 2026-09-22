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
  toUserFacingError,
} from "../../api";
import { Badge, Button, EmptyState, Mono, TextField, TokenAmount, truncateMiddle } from "../../design-system";
import { useIdentity } from "../../identity";
import { useAgentRuntimeState, useTripKillSwitch } from "../../hooks/usePolicyContracts";

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
  const drawerRef = useRef<HTMLElement>(null);
  const wallets = useOrganizationWallets(Boolean(identity.authenticated));
  const transfers = useWalletTransfers(agent.address, Boolean(identity.authenticated));
  const policyQuery = useAgentPolicy(agent.address, Boolean(identity.authenticated));
  const policy = policyQuery.data;
  const runtimeState = useAgentRuntimeState(agent.address, Boolean(identity.authenticated));
  const tripKillSwitch = useTripKillSwitch();
  const guardAddress = configuration.contracts.agentWalletGuard;
  const rpcUrl = configuration.rpcUrl;

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

  const [activeTab, setActiveTab] = useState<"overview" | "storage" | "transfers" | "sdk">("overview");
  const [copied, setCopied] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [sdkLang, setSdkLang] = useState<"python" | "typescript" | "curl">("python");
  const [isTripped, setIsTripped] = useState(agent.status === "paused" || agent.status === "tripped");

  const [loadWalletId, setLoadWalletId] = useState("");
  const [loadAmount, setLoadAmount] = useState("");
  const [unloadWalletId, setUnloadWalletId] = useState("");
  const [unloadAmount, setUnloadAmount] = useState("");
  const [message, setMessage] = useState("");

  const refresh = () => {
    void transfers.refetch();
    void wallets.refetch();
    void runtimeState.refetch();
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

  const handleCircuitToggle = async () => {
    const nextState = !isTripped;
    try {
      setMessage(`Broadcasting kill-switch ${nextState ? "freeze" : "resume"} to Monad…`);
      await tripKillSwitch.mutateAsync({ agentAddress: agent.address, active: nextState });
      setIsTripped(nextState);
      onTripCircuit(agent.address, nextState);
      setMessage(`Circuit ${nextState ? "tripped" : "reset"} confirmed onchain.`);
    } catch (err) {
      setMessage(toUserFacingError(err, "Circuit update failed."));
    }
  };

  const treasuryWallets = wallets.data ?? [];

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
            </div>
            <div>
              <div className="inspector-address-row">
                <h3 id="agent-inspector-title"><Mono>{truncateMiddle(agent.address, 10, 6)}</Mono></h3>
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
          <button
            type="button"
            className={`inspector-tab ${activeTab === "sdk" ? "active" : ""}`}
            onClick={() => setActiveTab("sdk")}
          >
            <Terminal size={14} />
            SDK Sandbox
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
                        ? "Spending halted. The onchain evaluator short-circuits before further policy arithmetic."
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
                    <strong>400ms block cadence</strong>
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
        </div>
      </aside>
    </div>
  );
}
