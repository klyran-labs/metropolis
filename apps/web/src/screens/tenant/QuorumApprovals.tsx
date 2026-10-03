import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  ShieldAlert,
  CheckCircle2,
  AlertOctagon,
  UsersRound,
  Clock,
  ArrowRight,
  Sparkles,
  Bot,
  Wallet,
  CheckCheck,
  XCircle,
  ExternalLink,
  Copy,
  ShieldCheck,
} from "lucide-react";
import {
  useAgents,
  useOrganizationWallets,
  useApproveWalletTransfer,
  useSubmitWalletTransfer,
  useWalletTransfers,
  type WalletTransfer,
  type Agent,
} from "../../api";
import { AgentSelect, Badge, Button, EmptyState, Mono, Surface, TokenAmount, truncateMiddle, formatRiskTier } from "../../design-system";
import { useIdentity } from "../../identity";
import { useLiveTokenBalance } from "../../hooks/usePolicyContracts";
import type { OrganizationWallet } from "../../api";

function MultisigWalletRow({ wallet }: { wallet: OrganizationWallet }) {
  const liveToken = useLiveTokenBalance(wallet.address);
  const displayBalance =
    wallet.balanceBaseUnits !== null && wallet.balanceBaseUnits !== undefined
      ? wallet.balanceBaseUnits
      : liveToken.data !== null && liveToken.data !== undefined
        ? liveToken.data.toString()
        : null;

  return (
    <div key={wallet.id} className="entity-row">
      <div className="agent-ident-cell">
        <Wallet size={15} />
        <strong>{wallet.label}</strong>
      </div>
      <Mono>{truncateMiddle(wallet.address, 10, 6)}</Mono>
      <Badge tone="info">Needs {wallet.approvalThreshold} signatures</Badge>
      <TokenAmount baseUnits={displayBalance} />
      <Link to="/app/treasury" className="remediation-btn">
        <span>Manage</span>
        <ArrowRight size={13} />
      </Link>
    </div>
  );
}

export function QuorumApprovals() {
  const identity = useIdentity();
  const agentsQuery = useAgents(Boolean(identity.authenticated));
  const walletsQuery = useOrganizationWallets(Boolean(identity.authenticated));
  const agents = agentsQuery.data ?? [];
  const wallets = walletsQuery.data ?? [];

  const [selectedAgentAddress, setSelectedAgentAddress] = useState<string>(agents[0]?.address ?? "");
  const transfersQuery = useWalletTransfers(
    selectedAgentAddress || (agents[0]?.address ?? ""),
    Boolean(identity.authenticated && (selectedAgentAddress || agents[0]?.address)),
  );

  const [actionMessage, setActionMessage] = useState("");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const refresh = () => {
    void transfersQuery.refetch();
    void walletsQuery.refetch();
  };

  const approveMutation = useApproveWalletTransfer(() => {
    setActionMessage("Approved.");
    refresh();
    setTimeout(() => setActionMessage(""), 5000);
  });

  const submitMutation = useSubmitWalletTransfer(() => {
    setActionMessage("Submitted.");
    refresh();
    setTimeout(() => setActionMessage(""), 5000);
  });

  const pendingTransfers = useMemo(() => {
    return (transfersQuery.data ?? []).filter(
      (t) => t.status === "pending_approval" || t.status === "pending",
    );
  }, [transfersQuery.data]);

  const multisigWallets = wallets.filter((w) => w.approvalThreshold > 1);

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Approvals</h1>
          <p>Transfers that need more than one signature.</p>
        </div>
      </header>

      {/* Quorum Overview Metric Row */}
      <div className="stat-row">
        <Surface className="stat-tile-custom">
          <div className="stat-tile-top">
            <span className="stat-label">Waiting for approval</span>
            <UsersRound size={18} className="accent-blue" />
          </div>
          <strong className="stat-value">{pendingTransfers.length}</strong>
          <small className="stat-sub">Need a signature</small>
        </Surface>

        <Surface className="stat-tile-custom">
          <div className="stat-tile-top">
            <span className="stat-label">Multi-approval wallets</span>
            <ShieldAlert size={18} className="accent-amber" />
          </div>
          <strong className="stat-value">{multisigWallets.length}</strong>
          <small className="stat-sub">Need more than one signature</small>
        </Surface>

        <Surface className="stat-tile-custom">
          <div className="stat-tile-top">
            <span className="stat-label">Signed securely</span>
            <Sparkles size={18} className="accent-aqua" />
          </div>
          <strong className="stat-value">Always</strong>
          <small className="stat-sub">Every approval is cryptographically verified</small>
        </Surface>
      </div>

      {actionMessage && (
        <Surface className="transfer-message-banner">
          <CheckCircle2 size={16} />
          <span>{actionMessage}</span>
        </Surface>
      )}

      {/* Pending Approvals Section */}
      <Surface>
        <div className="section-heading">
          <h2>Pending approvals</h2>
          {agents.length > 0 && (
            <div className="quorum-agent-filter-inline">
              <AgentSelect
                label="Filter by agent"
                value={selectedAgentAddress || (agents[0]?.address ?? "")}
                agents={agents}
                onChange={(val) => setSelectedAgentAddress(val)}
              />
            </div>
          )}
        </div>

        {pendingTransfers.length > 0 ? (
          <div className="entity-list">
            {pendingTransfers.map((item) => (
              <div key={item.id} className="quorum-intent-card">
                <div className="quorum-card-head">
                  <div className="quorum-type-badge">
                    <Bot size={15} />
                    <span>{item.direction === "load" ? "Add funds" : "Withdraw"}</span>
                  </div>
                  <Badge tone="warning">Needs approval</Badge>
                </div>

                <div className="quorum-card-body">
                  <div className="quorum-field">
                    <small>Wallet</small>
                    <strong>{item.walletLabel}</strong>
                    <div className="address-copy-group">
                      <Mono>{truncateMiddle(item.walletAddress, 8, 4)}</Mono>
                      <button
                        type="button"
                        className={`inline-copy-btn table-copy-btn ${copiedText === item.walletAddress ? "copied-active" : ""}`}
                        onClick={() => handleCopy(item.walletAddress)}
                        title="Copy wallet address"
                        aria-label="Copy wallet address"
                      >
                        {copiedText === item.walletAddress ? (
                          <>
                            <CheckCircle2 size={12} className="copied-icon" />
                            <span className="copied-pill-text">Copied</span>
                          </>
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="quorum-field">
                    <small>Amount</small>
                    <TokenAmount baseUnits={item.amountBaseUnits} />
                  </div>

                  <div className="quorum-field">
                    <small>Requested by</small>
                    <Mono>{truncateMiddle(item.initiatedBySubject, 10, 6)}</Mono>
                  </div>
                </div>

                <div className="quorum-card-actions">
                  <Button
                    variant="filled"
                    onClick={() => approveMutation.mutate(item.id)}
                    disabled={approveMutation.isPending}
                  >
                    <CheckCheck size={14} />
                    <span>{approveMutation.isPending ? "Approving…" : "Approve"}</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing needs approval"
            detail="Transfers that need more than one signature will show up here."
            action={
              <Link to="/app/simulator">
                <Button variant="tonal">
                  <ShieldCheck size={14} style={{ marginRight: 6 }} /> Try the simulator
                </Button>
              </Link>
            }
          />
        )}
      </Surface>

      {/* Multi-Sig Wallets Configuration */}
      <Surface>
        <div className="section-heading">
          <h2>Multi-approval wallets</h2>
        </div>

        {multisigWallets.length > 0 ? (
          <div className="entity-list">
            {multisigWallets.map((w) => (
              <MultisigWalletRow key={w.id} wallet={w} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No multi-approval wallets yet"
            detail="Require more than one signature for large transfers by setting this up on a treasury wallet."
            action={
              <Link to="/app/treasury">
                <Button variant="filled">
                  <ArrowRight size={14} style={{ marginRight: 6 }} /> Set up in Treasury
                </Button>
              </Link>
            }
          />
        )}
      </Surface>
    </div>
  );
}
