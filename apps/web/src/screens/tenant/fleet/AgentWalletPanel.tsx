import { Activity, ArrowDownToLine, ArrowUpFromLine, Wallet } from "lucide-react";
import { useState } from "react";
import { useLoadAgentWallet, useOrganizationWallets, useSubmitWalletTransfer, useUnloadAgentWallet, useWalletTransfers, type Agent } from "../../../api";
import { Badge, Button, Dialog, EmptyState, Mono, Select, Surface, TextField, TokenAmount, truncateMiddle } from "../../../design-system";
import { useIdentity } from "../../../identity";
import { useAgentTba, usePaymasterEligibility } from "../../../hooks/usePolicyContracts";
import { useToast } from "../../../components/UndoToast";

export function AgentWalletPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const identity = useIdentity();
  const { toast } = useToast();
  const wallets = useOrganizationWallets(Boolean(identity.authenticated));
  const transfers = useWalletTransfers(agent.address, Boolean(identity.authenticated));
  const [loadWalletId, setLoadWalletId] = useState("");
  const [loadAmount, setLoadAmount] = useState("");
  const [unloadWalletId, setUnloadWalletId] = useState("");
  const [unloadAmount, setUnloadAmount] = useState("");
  const [confirmTransferId, setConfirmTransferId] = useState<string | null>(null);
  const [txHashInput, setTxHashInput] = useState("");

  const refresh = () => {
    void transfers.refetch();
    void wallets.refetch();
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
        message: "The agent's wallet has been topped up.",
        tone: "success",
      });
    }
    setLoadAmount("");
    refresh();
  });

  const unload = useUnloadAgentWallet(agent.address, (result) => {
    toast({
      title: result.status === "confirmed" ? "Funds Unloaded" : "Unload Submitted",
      message: result.status === "confirmed" ? "Sent back to your treasury." : "Withdrawal submitted.",
      tone: "success",
    });
    setUnloadAmount("");
    refresh();
  });

  const tba = useAgentTba(agent.address);
  const paymaster = usePaymasterEligibility(agent.address);

  const treasuryWallets = wallets.data ?? [];
  const treasurySelectOptions = treasuryWallets
    .filter((w) => w.hasAccess)
    .map((w) => ({
      value: w.id,
      label: w.label,
      detail: `${w.kind === "sovereign" ? "Secure" : "Connected"} · ${truncateMiddle(w.address, 8, 4)}`,
      badge: <Badge tone="info">{w.kind === "sovereign" ? "Secure" : "Connected"}</Badge>,
    }));

  return (
    <Surface className="wallet-panel">
      <div className="section-heading">
        <div>
          <h2>
            <Mono>{agent.address}</Mono>
          </h2>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.35rem", marginBottom: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
            <Badge tone={paymaster.data?.eligible ? "success" : "neutral"}>
              {paymaster.data?.eligible ? "AgentGuard covers network fees" : "Agent pays its own network fees"}
            </Badge>
            {tba.data?.tbaAddress && (
              <Badge tone="info">
                Identity wallet: <Mono>{truncateMiddle(tba.data.tbaAddress, 8, 4)}</Mono>
              </Badge>
            )}
          </div>
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
              <Select
                value={loadWalletId}
                onChange={setLoadWalletId}
                options={treasurySelectOptions}
                placeholder="Select a source treasury wallet"
              />
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
            <EmptyState kind="wallet" title="No treasury wallets" detail="Register a treasury wallet first." />
          )}
        </div>
        <div className="wallet-action-card">
          <div className="wallet-action-head">
            <ArrowUpFromLine size={16} />
            <strong>Unload</strong>
          </div>
          {agent.walletSource !== "sovereign" ? (
            <EmptyState kind="wallet"
              title="Needs a managed wallet"
              detail="Only agents with a wallet we manage can send funds back to treasury. This one uses a connected wallet instead."
            />
          ) : treasuryWallets.length ? (
            <>
              <Select
                value={unloadWalletId}
                onChange={setUnloadWalletId}
                options={treasurySelectOptions}
                placeholder="Select a destination treasury wallet"
              />
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
            <EmptyState kind="wallet" title="No treasury wallets" detail="Register a treasury wallet first." />
          )}
        </div>
      </div>
      <div className="section-heading">
        <div>
          <h2>Wallet activity</h2>
          <p>{transfers.data?.length ?? 0} real, chain-verified transfers for this agent.</p>
        </div>
      </div>
      {transfers.isError ? (
        <EmptyState kind="warning" title="Activity unavailable" detail="The wallet transfer history could not be loaded." />
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
                    setConfirmTransferId(transfer.id);
                    setTxHashInput("");
                  }}
                >
                  I've sent this
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState kind="wallet" title="No wallet activity yet" detail="Load this agent's wallet to begin." />
      )}

      <Dialog
        open={Boolean(confirmTransferId)}
        onClose={() => {
          setConfirmTransferId(null);
          setTxHashInput("");
        }}
        title="Confirm Transfer Broadcast"
        description="Provide the transaction hash from your wallet once the transfer has completed."
        footer={
          <>
            <Button
              variant="text"
              onClick={() => {
                setConfirmTransferId(null);
                setTxHashInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmTransferId && txHashInput.trim()) {
                  submitTransfer.mutate({
                    transferId: confirmTransferId,
                    transactionHash: txHashInput.trim(),
                  });
                  setConfirmTransferId(null);
                  setTxHashInput("");
                }
              }}
              disabled={!txHashInput.trim() || submitTransfer.isPending}
            >
              Confirm submission
            </Button>
          </>
        }
      >
        <TextField
          label="Transaction hash"
          value={txHashInput}
          placeholder="0x…"
          onChange={(e) => setTxHashInput(e.target.value)}
        />
      </Dialog>
    </Surface>
  );
}
