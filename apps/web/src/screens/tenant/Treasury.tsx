import { useWallets } from "@privy-io/react-auth";
import { Landmark, ShieldCheck, Sparkles, UsersRound, Wallet } from "lucide-react";
import { useState } from "react";
import {
  useGrantWalletAccess,
  useOrganizationWallets,
  useRegisterOrganizationWallet,
  useRevokeWalletAccess,
  useUpdateWalletThreshold,
  useWalletAccess,
  type OrganizationWallet,
} from "../../api";
import { StatTile } from "../../charts";
import { Badge, Button, EmptyState, Mono, Surface, TextField, TokenAmount } from "../../design-system";
import { useIdentity } from "../../identity";

function treasuryOwnershipMessage(orgId: string, label: string) {
  return `AgentGuard treasury wallet ownership proof\nOrganization: ${orgId}\nLabel: ${label}`;
}

function WalletAccessPanel({ wallet }: { wallet: OrganizationWallet }) {
  const access = useWalletAccess(wallet.id, true);
  const [subject, setSubject] = useState("");
  const [threshold, setThreshold] = useState(String(wallet.approvalThreshold));
  const [message, setMessage] = useState("");
  const grant = useGrantWalletAccess(wallet.id, () => {
    setSubject("");
    void access.refetch();
  });
  const revoke = useRevokeWalletAccess(wallet.id, () => void access.refetch());
  const updateThreshold = useUpdateWalletThreshold(wallet.id, () =>
    setMessage("Approval threshold updated."),
  );
  return (
    <div className="wallet-access-panel">
      <div className="inline-form">
        <TextField label="Operator ID" value={subject} onChange={(event) => setSubject(event.target.value)} />
        <Button
          variant="tonal"
          onClick={() => grant.mutate(subject)}
          disabled={!subject.trim() || grant.isPending}
        >
          Grant access
        </Button>
      </div>
      {access.data?.length ? (
        <div className="entity-list">
          {access.data.map((entry) => (
            <div className="entity-row" key={entry.subject}>
              <strong>
                <Mono>{entry.subject}</Mono>
              </strong>
              <small>granted by <Mono>{entry.grantedBySubject}</Mono></small>
              <Button variant="text" onClick={() => revoke.mutate(entry.subject)} disabled={revoke.isPending}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No access grants yet" detail="Grant access to operators who should be able to load or unload this wallet." />
      )}
      <div className="inline-form">
        <TextField
          label="Approvals required per transfer"
          type="number"
          min={1}
          max={10}
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
        />
        <Button
          variant="tonal"
          onClick={() => updateThreshold.mutate(Number(threshold))}
          disabled={updateThreshold.isPending}
        >
          Save threshold
        </Button>
      </div>
      {message && <p className="form-message">{message}</p>}
    </div>
  );
}

export function Treasury() {
  const identity = useIdentity();
  const wallets = useOrganizationWallets(Boolean(identity.authenticated));
  const { wallets: connectedWallets } = useWallets();
  const [kind, setKind] = useState<"external" | "sovereign">("sovereign");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const register = useRegisterOrganizationWallet(() => {
    setLabel("");
    setMessage("Treasury wallet registered.");
    void wallets.refetch();
  });

  const registerWallet = async () => {
    setMessage("");
    if (!label.trim()) {
      setMessage("Choose a label for this treasury wallet.");
      return;
    }
    if (kind === "sovereign") {
      register.mutate({ kind: "sovereign", label: label.trim() });
      return;
    }
    const wallet = connectedWallets[0];
    if (!wallet || !identity.tenantId) {
      setMessage("Connect a wallet first, then sign to confirm you own it.");
      return;
    }
    setWorking(true);
    try {
      const provider = await wallet.getEthereumProvider();
      const proof = treasuryOwnershipMessage(identity.tenantId, label.trim());
      const signature = (await provider.request({
        method: "personal_sign",
        params: [proof, wallet.address],
      })) as string;
      register.mutate({ kind: "external", label: label.trim(), address: wallet.address, signature });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn't confirm you own that wallet.");
    } finally {
      setWorking(false);
    }
  };

  const rows = wallets.data ?? [];
  const sovereignCount = rows.filter((wallet) => wallet.kind === "sovereign").length;
  const withAccessCount = rows.filter((wallet) => wallet.hasAccess).length;

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Home / Treasury</span>
          <h1>Treasury wallets</h1>
          <p>Fund and reclaim agent wallets from wallets you and your team control.</p>
        </div>
      </header>
      <div className="stat-row">
        <StatTile label="Treasury wallets" value={String(rows.length)} icon={<Landmark size={18} />} accent={0} />
        <StatTile label="Wallets we manage" value={String(sovereignCount)} icon={<ShieldCheck size={18} />} accent={2} />
        <StatTile label="You can access" value={String(withAccessCount)} icon={<UsersRound size={18} />} accent={1} />
      </div>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Register a treasury wallet</h2>
            <p>Connect a wallet you already control, or have us generate one and hold the key sealed on your behalf.</p>
          </div>
        </div>
        <div className="wallet-kind-toggle" role="tablist" aria-label="Wallet source">
          <button
            type="button"
            className={kind === "sovereign" ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setKind("sovereign")}
          >
            <Sparkles size={14} /> Generate a new wallet
          </button>
          <button
            type="button"
            className={kind === "external" ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setKind("external")}
          >
            <Wallet size={14} /> Connect an existing wallet
          </button>
        </div>
        <div className="inline-form">
          <TextField label="Label" value={label} onChange={(event) => setLabel(event.target.value)} />
          <Button onClick={() => void registerWallet()} disabled={working || register.isPending || !label.trim()}>
            {working || register.isPending ? "Registering…" : "Register wallet"}
          </Button>
        </div>
        {message && <p className="form-message">{message}</p>}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Organization wallets</h2>
            <p>{rows.length} wallets registered for this organization.</p>
          </div>
        </div>
        {wallets.isError ? (
          <EmptyState title="Wallets unavailable" detail="We couldn't load your treasury wallets right now." />
        ) : rows.length ? (
          <div className="entity-list">
            {rows.map((wallet) => (
              <div className="wallet-card" key={wallet.id}>
                <div className="entity-row">
                  <strong>{wallet.label}</strong>
                  <Badge tone={wallet.kind === "sovereign" ? "info" : "neutral"}>
                    {wallet.kind === "sovereign" ? "Managed for you" : "Connected"}
                  </Badge>
                  <span>
                    <Mono>{wallet.address}</Mono>
                  </span>
                  <TokenAmount baseUnits={wallet.balanceBaseUnits} />
                  {wallet.approvalThreshold > 1 && (
                    <Badge tone="warning">Needs {wallet.approvalThreshold} approvals</Badge>
                  )}
                  <Button
                    variant="text"
                    onClick={() => setExpanded(expanded === wallet.id ? null : wallet.id)}
                    disabled={!wallet.hasAccess}
                  >
                    {expanded === wallet.id ? "Hide access" : "Manage access"}
                  </Button>
                </div>
                {expanded === wallet.id && <WalletAccessPanel wallet={wallet} />}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No treasury wallets" detail="Register your first treasury wallet to fund agent wallets." />
        )}
      </Surface>
    </div>
  );
}
