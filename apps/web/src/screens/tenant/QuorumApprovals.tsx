import { useState } from "react";
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
  useOrganizationWallets,
  useApproveWalletTransfer,
  useInfinitePendingApprovals,
  toUserFacingError,
  type PendingApproval,
} from "../../api";
import { Badge, Button, EmptyState, Mono, Surface, TokenAmount, truncateMiddle } from "../../design-system";
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

function approvalBlockReason(item: PendingApproval): string | null {
  if (item.canApprove) return null;
  return item.alreadySigned
    ? "You've already signed this one. Waiting on other approvers."
    : "You don't have access to this wallet, so someone else needs to approve.";
}

export function QuorumApprovals() {
  const identity = useIdentity();
  const walletsQuery = useOrganizationWallets(Boolean(identity.authenticated));
  const wallets = walletsQuery.data ?? [];
  const pendingQuery = useInfinitePendingApprovals(Boolean(identity.authenticated));
  const pendingApprovals = pendingQuery.data?.pages.flatMap((page) => page.approvals) ?? [];
  const pendingTotal = pendingQuery.data?.pages[0]?.total ?? 0;

  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const approveMutation = useApproveWalletTransfer(() => {
    setActionMessage("Approved.");
    setErrorMessage("");
    void pendingQuery.refetch();
    void walletsQuery.refetch();
    setTimeout(() => setActionMessage(""), 5000);
  });

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
          <strong className="stat-value">{pendingTotal}</strong>
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

      {errorMessage && <p className="form-message" role="alert">{errorMessage}</p>}

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
        </div>

        {pendingQuery.isError ? (
          <EmptyState kind="warning" title="Approvals unavailable" detail="You may not have access to approvals, or we couldn't load them. Try again shortly." tone="warning" />
        ) : pendingApprovals.length > 0 ? (
          <div className="entity-list">
            {pendingApprovals.map((item) => (
              <div key={item.transferId} className="quorum-intent-card">
                <div className="quorum-card-head">
                  <div className="quorum-type-badge">
                    <Bot size={15} />
                    <span>{item.direction === "load" ? "Add funds" : "Withdraw"}</span>
                  </div>
                  <Badge tone="warning">
                    {item.signatures} of {item.requiredSignatures} signatures
                  </Badge>
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
                    <small>Agent</small>
                    <Mono>{truncateMiddle(item.agentAddress, 8, 4)}</Mono>
                  </div>

                  <div className="quorum-field">
                    <small>Requested by</small>
                    <Mono>{truncateMiddle(item.initiatedBySubject, 10, 6)}</Mono>
                  </div>
                </div>

                <div className="quorum-card-actions">
                  <Button
                    variant="filled"
                    onClick={() =>
                      approveMutation.mutate(item.transferId, {
                        onError: (error) =>
                          setErrorMessage(toUserFacingError(error, "That approval could not be recorded.")),
                      })
                    }
                    disabled={!item.canApprove || approveMutation.isPending}
                  >
                    <CheckCheck size={14} />
                    <span>{approveMutation.isPending ? "Approving…" : "Approve"}</span>
                  </Button>
                  {approvalBlockReason(item) && <small className="subtle">{approvalBlockReason(item)}</small>}
                </div>
              </div>
            ))}
            {pendingQuery.hasNextPage && (
              <Button
                variant="tonal"
                onClick={() => void pendingQuery.fetchNextPage()}
                disabled={pendingQuery.isFetchingNextPage}
              >
                {pendingQuery.isFetchingNextPage ? "Loading…" : `Show more (${pendingTotal - pendingApprovals.length} left)`}
              </Button>
            )}
          </div>
        ) : (
          <EmptyState
            kind="success"
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
            kind="wallet"
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
