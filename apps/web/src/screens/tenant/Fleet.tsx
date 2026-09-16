import { useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Bot, Check, Copy, PauseCircle, Sparkles, Wallet } from "lucide-react";
import { useRef, useState } from "react";
import {
  request,
  useAgents,
  useLoadAgentWallet,
  useOrganizationWallets,
  useSubmitWalletTransfer,
  useUnloadAgentWallet,
  useWalletTransfers,
  type Agent,
} from "../../api";
import { Badge, Button, EmptyState, Mono, Surface, TextField, TokenAmount, truncateMiddle } from "../../design-system";
import { StatTile } from "../../charts";
import { useIdentity } from "../../identity";
import { AgentInspector } from "./AgentInspector";

function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="agent-cell-wrapper">
      <Mono>{truncateMiddle(address, 10, 6)}</Mono>
      <button
        type="button"
        className="table-copy-btn"
        onClick={copy}
        title={copied ? "Copied!" : "Copy address to clipboard"}
        aria-label="Copy address"
      >
        {copied ? <Check size={13} className="copy-success" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

const fleetFeatures = tableFeatures({});
const fleetColumnHelper = createColumnHelper<typeof fleetFeatures, Agent>();
const fleetColumns = fleetColumnHelper.columns([
  fleetColumnHelper.accessor("address", {
    header: "Agent",
    cell: (info) => <CopyAddressButton address={info.getValue()} />,
  }),
  fleetColumnHelper.accessor("walletSource", {
    header: "Wallet",
    cell: (info) => (
      <Badge tone={info.getValue() === "sovereign" ? "info" : "neutral"}>
        {info.getValue() === "sovereign" ? "Managed Enclave" : "Connected Wallet"}
      </Badge>
    ),
  }),
  fleetColumnHelper.accessor("environment", { header: "Environment" }),
  fleetColumnHelper.accessor("riskTier", { header: "Risk tier" }),
  fleetColumnHelper.accessor("status", {
    header: "State",
    cell: (info) => (
      <div className="agent-state-pill">
        <span
          className={`status-dot ${info.getValue() === "active" ? "status-dot-success" : "status-dot-warning"}`}
        />
        <span>{info.getValue()}</span>
      </div>
    ),
  }),
]);

function AgentWalletPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const identity = useIdentity();
  const wallets = useOrganizationWallets(Boolean(identity.authenticated));
  const transfers = useWalletTransfers(agent.address, Boolean(identity.authenticated));
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

  const treasuryWallets = wallets.data ?? [];

  return (
    <Surface className="wallet-panel">
      <div className="section-heading">
        <div>
          <h2>
            <Mono>{agent.address}</Mono>
          </h2>
          <p>Send funds to this agent, or send its balance back to a treasury wallet.</p>
        </div>
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="wallet-action-grid">
        <div className="wallet-action-card">
          <div className="wallet-action-head">
            <ArrowDownToLine size={16} />
            <strong>Load</strong>
          </div>
          {treasuryWallets.length ? (
            <>
              <select
                aria-label="Source treasury wallet"
                value={loadWalletId}
                onChange={(event) => setLoadWalletId(event.target.value)}
              >
                <option value="">Select a source treasury wallet</option>
                {treasuryWallets
                  .filter((wallet) => wallet.hasAccess)
                  .map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.label} ({wallet.kind === "sovereign" ? "managed" : "connected"})
                    </option>
                  ))}
              </select>
              <TextField
                label="Amount (USDC)"
                value={loadAmount}
                onChange={(event) => setLoadAmount(event.target.value)}
              />
              <Button
                onClick={() =>
                  load.mutate({ organizationWalletId: loadWalletId, amountBaseUnits: loadAmount })
                }
                disabled={!loadWalletId || !loadAmount || load.isPending}
              >
                {load.isPending ? "Loading…" : "Load agent wallet"}
              </Button>
            </>
          ) : (
            <EmptyState title="No treasury wallets" detail="Register a treasury wallet first." />
          )}
        </div>
        <div className="wallet-action-card">
          <div className="wallet-action-head">
            <ArrowUpFromLine size={16} />
            <strong>Unload</strong>
          </div>
          {agent.walletSource !== "sovereign" ? (
            <EmptyState
              title="Needs a managed wallet"
              detail="Only agents with a wallet we manage can send funds back to treasury. This one uses a connected wallet instead."
            />
          ) : treasuryWallets.length ? (
            <>
              <select
                aria-label="Destination treasury wallet"
                value={unloadWalletId}
                onChange={(event) => setUnloadWalletId(event.target.value)}
              >
                <option value="">Select a destination treasury wallet</option>
                {treasuryWallets
                  .filter((wallet) => wallet.hasAccess)
                  .map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.label} ({wallet.kind === "sovereign" ? "managed" : "connected"})
                    </option>
                  ))}
              </select>
              <TextField
                label="Amount (USDC)"
                value={unloadAmount}
                onChange={(event) => setUnloadAmount(event.target.value)}
              />
              <Button
                variant="tonal"
                onClick={() =>
                  unload.mutate({ organizationWalletId: unloadWalletId, amountBaseUnits: unloadAmount })
                }
                disabled={!unloadWalletId || !unloadAmount || unload.isPending}
              >
                {unload.isPending ? "Unloading…" : "Unload to treasury"}
              </Button>
            </>
          ) : (
            <EmptyState title="No treasury wallets" detail="Register a treasury wallet first." />
          )}
        </div>
      </div>
      {message && <p className="form-message">{message}</p>}
      <div className="section-heading">
        <div>
          <h2>Wallet activity</h2>
          <p>{transfers.data?.length ?? 0} real, chain-verified transfers for this agent.</p>
        </div>
      </div>
      {transfers.isError ? (
        <EmptyState title="Activity unavailable" detail="The wallet transfer history could not be loaded." />
      ) : transfers.data?.length ? (
        <div className="entity-list">
          {transfers.data.map((transfer) => (
            <div className="entity-row" key={transfer.id}>
              <strong>
                {transfer.direction === "load" ? "Load" : "Unload"} · {transfer.walletLabel}
              </strong>
              <TokenAmount baseUnits={transfer.amountBaseUnits} />
              <Badge
                tone={
                  transfer.status === "confirmed"
                    ? "success"
                    : transfer.status === "failed"
                      ? "critical"
                      : "warning"
                }
              >
                {transfer.status}
              </Badge>
              {transfer.transactionHash && (
                <small>
                  <Mono>{transfer.transactionHash}</Mono>
                </small>
              )}
              {transfer.status === "pending" && transfer.direction === "load" && (
                <Button
                  variant="text"
                  onClick={() => {
                    const transactionHash = window.prompt("Paste the transaction hash");
                    if (transactionHash) {
                      submitTransfer.mutate({ transferId: transfer.id, transactionHash });
                    }
                  }}
                >
                  I've sent this
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No wallet activity yet" detail="Load this agent's wallet to begin." />
      )}
    </Surface>
  );
}

export function Fleet() {
  const identity = useIdentity();
  const query = useAgents(Boolean(identity.authenticated));
  const treasuryWallets = useOrganizationWallets(Boolean(identity.authenticated));
  const client = useQueryClient();
  const [address, setAddress] = useState("");
  const [walletSource, setWalletSource] = useState<"external" | "sovereign">("sovereign");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const parent = useRef<HTMLDivElement>(null);
  const rows = query.data ?? [];
  const active = rows.filter((agent) => agent.status === "active").length;
  const sovereign = rows.filter((agent) => agent.walletSource === "sovereign").length;
  const table = useTable({ data: rows, columns: fleetColumns, features: fleetFeatures });
  const virtual = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 38,
    overscan: 8,
  });
  const register = async () => {
    setMessage("");
    try {
      await request("/agents", {
        method: "POST",
        body: JSON.stringify(
          walletSource === "sovereign"
            ? { walletSource: "sovereign", label, environment: "production", riskTier: "tier2_standard" }
            : { walletSource: "external", address, environment: "production", riskTier: "tier2_standard" },
        ),
      });
      setMessage("Agent registered.");
      setAddress("");
      setLabel("");
      void client.invalidateQueries({ queryKey: ["agents"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The agent could not be registered.");
    }
  };
  const selectedAgent = rows.find((agent) => agent.address === selected) ?? null;
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Home / Fleet</span>
          <h1>Fleet</h1>
          <p>Every agent below belongs to your organization.</p>
        </div>
      </header>
      <div className="stat-row">
        <StatTile label="Total agents" value={String(rows.length)} icon={<Bot size={18} />} accent={0} />
        <StatTile label="Active" value={String(active)} icon={<Activity size={18} />} accent={2} />
        <StatTile label="Paused" value={String(rows.length - active)} icon={<PauseCircle size={18} />} accent={1} />
        <StatTile label="Managed wallets" value={String(sovereign)} icon={<Wallet size={18} />} accent={3} />
      </div>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Register an agent</h2>
            <p>Generate a wallet we'll manage for this agent, or connect one you already control. Either way, the private key never enters this app.</p>
          </div>
        </div>
        <div className="wallet-kind-toggle" role="tablist" aria-label="Wallet source">
          <button
            type="button"
            className={walletSource === "sovereign" ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setWalletSource("sovereign")}
          >
            <Sparkles size={14} /> Auto-generate wallet
          </button>
          <button
            type="button"
            className={walletSource === "external" ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setWalletSource("external")}
          >
            <Wallet size={14} /> Link a treasury wallet
          </button>
        </div>
        <div className="inline-form">
          {walletSource === "sovereign" ? (
            <TextField label="Agent label" value={label} onChange={(event) => setLabel(event.target.value)} />
          ) : (treasuryWallets.data?.length ?? 0) > 0 ? (
            <select aria-label="Treasury wallet to link" value={address} onChange={(event) => setAddress(event.target.value)}>
              <option value="">Select a wallet your organization has registered</option>
              {treasuryWallets.data?.map((wallet) => (
                <option key={wallet.id} value={wallet.address}>
                  {wallet.label} ({wallet.kind === "sovereign" ? "managed" : "connected"})
                </option>
              ))}
            </select>
          ) : (
            <EmptyState
              title="No treasury wallets yet"
              detail="Register one in Treasury first, then come back to link it to this agent."
            />
          )}
          <Button
            onClick={register}
            disabled={walletSource === "sovereign" ? !label.trim() : !address}
          >
            Register
          </Button>
        </div>
        {message && <p className="form-message">{message}</p>}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Registered agents</h2>
            <p>{rows.length} agents registered. Select one to load or unload its wallet.</p>
          </div>
        </div>
        {query.isError ? (
          <EmptyState title="Fleet unavailable" detail="We couldn't load your fleet right now." />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No agents registered"
            detail="Register your first agent to start enforcing spend policy."
          />
        ) : (
          <div className="table-viewport" ref={parent}>
            <table>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th key={header.id}>
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {virtual.getVirtualItems().map((item) => {
                  const row = table.getRowModel().rows[item.index];
                  return (
                    <tr
                      key={row.id}
                      className={row.original.address === selected ? "row-selected" : undefined}
                      style={{ height: item.size, cursor: "pointer" }}
                      onClick={() => setSelected(row.original.address === selected ? null : row.original.address)}
                    >
                      {row.getAllCells().map((cell) => (
                        <td key={cell.id}>
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
      {selectedAgent && (
        <AgentInspector
          agent={selectedAgent}
          onClose={() => setSelected(null)}
          onTripCircuit={() => void client.invalidateQueries({ queryKey: ["agents"] })}
        />
      )}
    </div>
  );
}
