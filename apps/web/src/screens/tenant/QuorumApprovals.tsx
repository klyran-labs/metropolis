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
import { Badge, Button, EmptyState, Mono, Surface, TokenAmount, truncateMiddle } from "../../design-system";
import { useIdentity } from "../../identity";

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
    setActionMessage("Approval signature registered onchain.");
    refresh();
    setTimeout(() => setActionMessage(""), 5000);
  });

  const submitMutation = useSubmitWalletTransfer(() => {
    setActionMessage("Transaction hash submitted for confirmation.");
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
          <span className="eyebrow">Governance / Dual-Control Quorum</span>
          <h1>Spending Quorum & Escalation Center</h1>
          <p>
            Review and co-sign high-value autonomous transactions and treasury transfers requiring multi-operator consensus.
          </p>
        </div>
      </header>

      {/* Quorum Overview Metric Row */}
      <div className="stat-row">
        <Surface className="stat-tile-custom">
          <div className="stat-tile-top">
            <span className="stat-label">Pending Escalations</span>
            <UsersRound size={18} className="accent-blue" />
          </div>
          <strong className="stat-value">{pendingTransfers.length}</strong>
          <small className="stat-sub">Requiring operator signatures</small>
        </Surface>

        <Surface className="stat-tile-custom">
          <div className="stat-tile-top">
            <span className="stat-label">Multi-Sig Wallets</span>
            <ShieldAlert size={18} className="accent-amber" />
          </div>
          <strong className="stat-value">{multisigWallets.length}</strong>
          <small className="stat-sub">Threshold &gt; 1 required</small>
        </Surface>

        <Surface className="stat-tile-custom">
          <div className="stat-tile-top">
            <span className="stat-label">Enforced Physics</span>
            <Sparkles size={18} className="accent-aqua" />
          </div>
          <strong className="stat-value">EIP-712</strong>
          <small className="stat-sub">Typed cryptographic signatures</small>
        </Surface>
      </div>

      {actionMessage && (
        <Surface className="transfer-message-banner">
          <CheckCircle2 size={16} />
          <span>{actionMessage}</span>
        </Surface>
      )}

      {/* Agent Selector */}
      {agents.length > 0 && (
        <Surface className="quorum-agent-selector-bar">
          <span className="filter-label">Filter Quorum by Agent:</span>
          <select
            aria-label="Agent"
            value={selectedAgentAddress || (agents[0]?.address ?? "")}
            onChange={(e) => setSelectedAgentAddress(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.address} value={a.address}>
                {truncateMiddle(a.address, 10, 6)} ({a.riskTier})
              </option>
            ))}
          </select>
        </Surface>
      )}

      {/* Pending Approvals Section */}
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Pending Approval Queue</h2>
            <p>Transactions currently awaiting human-in-the-loop quorum validation.</p>
          </div>
        </div>

        {pendingTransfers.length > 0 ? (
          <div className="entity-list">
            {pendingTransfers.map((item) => (
              <div key={item.id} className="quorum-intent-card">
                <div className="quorum-card-head">
                  <div className="quorum-type-badge">
                    <Bot size={15} />
                    <span>{item.direction === "load" ? "Load Request" : "Unload Request"}</span>
                  </div>
                  <Badge tone="warning">Awaiting Consensus</Badge>
                </div>

                <div className="quorum-card-body">
                  <div className="quorum-field">
                    <small>Destination Wallet</small>
                    <strong>{item.walletLabel}</strong>
                    <div className="address-copy-group">
                      <Mono>{truncateMiddle(item.walletAddress, 8, 4)}</Mono>
                      <button
                        type="button"
                        className="inline-copy-btn"
                        onClick={() => handleCopy(item.walletAddress)}
                        title="Copy wallet address"
                        aria-label="Copy wallet address"
                      >
                        {copiedText === item.walletAddress ? (
                          <CheckCircle2 size={12} className="copied-icon" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="quorum-field">
                    <small>Requested Spend</small>
                    <TokenAmount baseUnits={item.amountBaseUnits} />
                  </div>

                  <div className="quorum-field">
                    <small>Initiated By</small>
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
                    <span>{approveMutation.isPending ? "Signing…" : "Sign & Authorize Intent"}</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Approval queue is clear"
            detail="All autonomous agent expenditures and wallet transfers are within automated policy invariants."
          />
        )}
      </Surface>

      {/* Multi-Sig Wallets Configuration */}
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Configured Quorum Thresholds</h2>
            <p>Treasury wallets requiring multiple operator signatures before funds can be dispatched.</p>
          </div>
        </div>

        {multisigWallets.length > 0 ? (
          <div className="entity-list">
            {multisigWallets.map((w) => (
              <div key={w.id} className="entity-row">
                <div className="agent-ident-cell">
                  <Wallet size={15} />
                  <strong>{w.label}</strong>
                </div>
                <Mono>{truncateMiddle(w.address, 10, 6)}</Mono>
                <Badge tone="info">Requires {w.approvalThreshold} Operator Signatures</Badge>
                <TokenAmount baseUnits={w.balanceBaseUnits} />
                <Link to="/app/treasury" className="remediation-btn">
                  <span>Manage Quorum</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No multi-operator thresholds configured"
            detail="You can configure approval thresholds (e.g. 2 of 3 signatures required) in the Treasury view."
          />
        )}
      </Surface>
    </div>
  );
}
