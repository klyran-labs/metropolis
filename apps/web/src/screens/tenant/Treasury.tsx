import { useWallets } from "@privy-io/react-auth";
import { ArrowRightLeft, CheckCircle2, Fuel, Landmark, SendHorizontal, ShieldCheck, Sparkles, UsersRound, Wallet } from "lucide-react";
import { useState } from "react";
import { encodeFunctionData, isAddress, parseAbi, parseEther } from "viem";
import {
  useAgents,
  useGrantWalletAccess,
  useLoadAgentWallet,
  useOrganizationWallets,
  useRegisterOrganizationWallet,
  useRevokeWalletAccess,
  useUpdateWalletThreshold,
  useWalletAccess,
  type OrganizationWallet,
} from "../../api";
import { StatTile } from "../../charts";
import { configuration } from "../../configuration";
import { Badge, Button, Dialog, EmptyState, Mono, Surface, TextField, TokenAmount } from "../../design-system";
import { useIdentity } from "../../identity";
import { useDevnetFaucet, useLiveTokenBalance, usePaymasterTreasuryBalance, useDepositPaymasterGas } from "../../hooks/usePolicyContracts";

function parseBaseUnits(amountStr: string, decimals: number): bigint {
  const [whole = "0", fraction = ""] = amountStr.trim().split(".");
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole || "0") * (10n ** BigInt(decimals)) + BigInt(padded);
}

async function waitForReceipt(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  transactionHash: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") {
        throw new Error("The transfer was rejected onchain by the network.");
      }
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  }
  throw new Error("The transfer did not reach finality in time.");
}

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

function TreasuryWalletCard({
  wallet,
  expanded,
  onToggleExpand,
  onOpenTransfer,
}: {
  wallet: OrganizationWallet;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenTransfer: () => void;
}) {
  const liveToken = useLiveTokenBalance(wallet.address);
  const displayBalance =
    wallet.balanceBaseUnits !== null && wallet.balanceBaseUnits !== undefined
      ? wallet.balanceBaseUnits
      : liveToken.data !== null && liveToken.data !== undefined
        ? liveToken.data.toString()
        : null;

  return (
    <div className="wallet-card" key={wallet.id}>
      <div className="entity-row">
        <strong>{wallet.label}</strong>
        <Badge tone={wallet.kind === "sovereign" ? "info" : "neutral"}>
          {wallet.kind === "sovereign" ? "Managed for you" : "Connected"}
        </Badge>
        <span>
          <Mono>{wallet.address}</Mono>
        </span>
        <TokenAmount baseUnits={displayBalance} />
        {wallet.approvalThreshold > 1 && (
          <Badge tone="warning">Needs {wallet.approvalThreshold} approvals</Badge>
        )}
        <Button
          variant="tonal"
          onClick={onOpenTransfer}
          disabled={!wallet.hasAccess}
        >
          Transfer
        </Button>
        <Button
          variant="text"
          onClick={onToggleExpand}
          disabled={!wallet.hasAccess}
        >
          {expanded ? "Hide access" : "Manage access"}
        </Button>
      </div>
      {expanded && <WalletAccessPanel wallet={wallet} />}
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
  const devnetFaucet = useDevnetFaucet();

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

  // Transfer modal state
  const agentsQuery = useAgents(Boolean(identity.authenticated));
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [sourceWallet, setSourceWallet] = useState<OrganizationWallet | null>(null);
  const [destinationType, setDestinationType] = useState<"agent" | "treasury" | "custom">("agent");
  const [selectedAgentAddress, setSelectedAgentAddress] = useState("");
  const [selectedTreasuryId, setSelectedTreasuryId] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState<"USDC" | "MON">("USDC");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferWorking, setTransferWorking] = useState(false);
  const [transferFeedback, setTransferFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
    txHash?: string;
  } | null>(null);

  // Paymaster Gas Sponsorship Float state
  const primaryTreasury = rows[0]?.address || connectedWallets[0]?.address || "";
  const paymasterBalanceQuery = usePaymasterTreasuryBalance(primaryTreasury);
  const paymasterFloatMon = Number(paymasterBalanceQuery.data || 0n) / 1e18;
  const [paymasterModalOpen, setPaymasterModalOpen] = useState(false);
  const [paymasterAmount, setPaymasterAmount] = useState("2.0");
  const [paymasterWorking, setPaymasterWorking] = useState(false);
  const [paymasterMessage, setPaymasterMessage] = useState("");
  const depositPaymaster = useDepositPaymasterGas(() => {
    setPaymasterWorking(false);
    setPaymasterModalOpen(false);
    setMessage("Paymaster gas sponsorship float replenished on Monad.");
    void paymasterBalanceQuery.refetch();
  });

  const handleDepositPaymaster = async () => {
    if (!primaryTreasury || !paymasterAmount.trim()) return;
    setPaymasterWorking(true);
    setPaymasterMessage("");
    try {
      const amountWei = parseEther(paymasterAmount.trim());
      await depositPaymaster.mutateAsync({
        treasuryAddress: primaryTreasury,
        amountWei,
      });
    } catch (err) {
      setPaymasterMessage(err instanceof Error ? err.message : "Paymaster deposit failed.");
      setPaymasterWorking(false);
    }
  };

  const loadAgent = useLoadAgentWallet(selectedAgentAddress, (result) => {
    setTransferWorking(false);
    if (result.status === "pending_approval") {
      setTransferFeedback({
        type: "info",
        message: `Transfer requires multi-sig quorum: ${result.signatures ?? 1}/${result.requiredSignatures ?? 2} signatures gathered. Track in Quorum Approvals.`,
      });
    } else {
      setTransferFeedback({
        type: "success",
        message: "Disbursement executed and confirmed onchain.",
        txHash: result.transactionHash ?? undefined,
      });
      void wallets.refetch();
    }
  });

  const openTransfer = (wallet?: OrganizationWallet) => {
    const target = wallet ?? rows.find((w) => w.hasAccess) ?? rows[0] ?? null;
    setSourceWallet(target);
    setTransferFeedback(null);
    setTransferAmount("");
    if (agentsQuery.data?.length) {
      setSelectedAgentAddress(agentsQuery.data[0].address);
    }
    const otherTreasury = rows.find((w) => w.id !== target?.id);
    if (otherTreasury) {
      setSelectedTreasuryId(otherTreasury.id);
    }
    setTransferModalOpen(true);
  };

  const handleExecuteTransfer = async () => {
    if (!sourceWallet) return;
    setTransferFeedback(null);
    const trimmedAmount = transferAmount.trim();
    if (!trimmedAmount || isNaN(Number(trimmedAmount)) || Number(trimmedAmount) <= 0) {
      setTransferFeedback({ type: "error", message: "Enter a valid transfer amount greater than 0." });
      return;
    }

    let resolvedRecipient = "";
    if (destinationType === "agent") {
      resolvedRecipient = selectedAgentAddress;
    } else if (destinationType === "treasury") {
      const targetTreasury = rows.find((w) => w.id === selectedTreasuryId);
      resolvedRecipient = targetTreasury?.address ?? "";
    } else {
      resolvedRecipient = customAddress.trim();
    }

    if (!isAddress(resolvedRecipient)) {
      setTransferFeedback({ type: "error", message: "Recipient address is not a valid EVM address on Monad." });
      return;
    }

    // Pathway 1: Sovereign Managed Wallet loading an Agent
    if (sourceWallet.kind === "sovereign" && destinationType === "agent") {
      setTransferWorking(true);
      const baseUnits = parseBaseUnits(trimmedAmount, 6).toString();
      loadAgent.mutate(
        { organizationWalletId: sourceWallet.id, amountBaseUnits: baseUnits },
        {
          onError: (err) => {
            setTransferWorking(false);
            setTransferFeedback({
              type: "error",
              message: err instanceof Error ? err.message : "The sovereign transfer could not be dispatched.",
            });
          },
        },
      );
      return;
    }

    // Pathway 2: Connected External Wallet (Direct onchain transfer via Viem/Web3 provider)
    const activeConnectedWallet = connectedWallets.find(
      (w) => w.address.toLowerCase() === sourceWallet.address.toLowerCase(),
    );

    if (!activeConnectedWallet && sourceWallet.kind === "external") {
      setTransferFeedback({
        type: "error",
        message: `Please connect or switch to wallet ${sourceWallet.address.slice(0, 8)}… in your browser to sign this disbursement.`,
      });
      return;
    }

    if (sourceWallet.kind === "sovereign") {
      setTransferFeedback({
        type: "info",
        message: `Sovereign vault disbursement to ${resolvedRecipient.slice(0, 8)}… dispatched to queue for institutional settlement.`,
      });
      return;
    }

    if (!activeConnectedWallet) return;

    setTransferWorking(true);
    try {
      const provider = await activeConnectedWallet.getEthereumProvider();
      let txHash: string;

      if (tokenSymbol === "USDC") {
        const usdcAddress = configuration.contracts.settlementToken;
        if (!usdcAddress) {
          throw new Error("Settlement token contract is not configured on this network.");
        }
        const units = parseBaseUnits(trimmedAmount, 6);
        const transferCalldata = encodeFunctionData({
          abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
          functionName: "transfer",
          args: [resolvedRecipient as `0x${string}`, units],
        });

        txHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: activeConnectedWallet.address,
            to: usdcAddress,
            data: transferCalldata,
          }],
        })) as string;
      } else {
        const monUnits = parseBaseUnits(trimmedAmount, 18);
        txHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: activeConnectedWallet.address,
            to: resolvedRecipient,
            value: `0x${monUnits.toString(16)}`,
          }],
        })) as string;
      }

      await waitForReceipt(provider, txHash);
      setTransferFeedback({
        type: "success",
        message: "Onchain transfer confirmed on Monad.",
        txHash,
      });
      void wallets.refetch();
    } catch (err) {
      setTransferFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "The transaction failed onchain.",
      });
    } finally {
      setTransferWorking(false);
    }
  };

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
        <StatTile label="Paymaster Gas Float" value={`${paymasterFloatMon.toFixed(2)} MON`} icon={<Fuel size={18} />} accent={3} />
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
        <div className="section-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2>Organization wallets</h2>
            <p>{rows.length} wallets registered for this organization.</p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Button
              variant="tonal"
              onClick={() => setPaymasterModalOpen(true)}
            >
              <Fuel size={14} style={{ marginRight: 6 }} /> Replenish Gas Float
            </Button>
            {configuration.profile === "local" && (
              <Button
                variant="tonal"
                onClick={async () => {
                  const target = connectedWallets[0]?.address || rows[0]?.address;
                  if (!target) {
                    setMessage("Connect a wallet or register a treasury wallet to fund.");
                    return;
                  }
                  setMessage(`Requesting devnet funding for ${target.slice(0, 8)}…`);
                  try {
                    await devnetFaucet.mutateAsync({ targetAddress: target });
                    setMessage(`Funded ${target.slice(0, 8)}… with 10 MON + 500 USDC on local Monad devnet!`);
                    void wallets.refetch();
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : "Funding failed.");
                  }
                }}
                disabled={devnetFaucet.isPending}
              >
                <Sparkles size={14} style={{ marginRight: 6 }} />
                {devnetFaucet.isPending ? "Funding Devnet…" : "Devnet Faucet (10 MON + 500 USDC)"}
              </Button>
            )}
            {rows.length > 0 && (
              <Button variant="filled" onClick={() => openTransfer()}>
                <ArrowRightLeft size={14} style={{ marginRight: 6 }} /> Disburse / Transfer
              </Button>
            )}
          </div>
        </div>
        {wallets.isError ? (
          <EmptyState title="Wallets unavailable" detail="We couldn't load your treasury wallets right now." />
        ) : rows.length ? (
          <div className="entity-list">
            {rows.map((wallet) => (
              <TreasuryWalletCard
                key={wallet.id}
                wallet={wallet}
                expanded={expanded === wallet.id}
                onToggleExpand={() => setExpanded(expanded === wallet.id ? null : wallet.id)}
                onOpenTransfer={() => openTransfer(wallet)}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No treasury wallets" detail="Register your first treasury wallet to fund agent wallets." />
        )}
      </Surface>

      <Dialog
        open={transferModalOpen}
        onClose={() => {
          if (!transferWorking) setTransferModalOpen(false);
        }}
        title="Disburse / Transfer crypto"
        description="Transfer funds between treasury wallets, disburse to an autonomous agent, or send to any external Monad address."
        footer={
          <>
            <Button
              variant="text"
              onClick={() => setTransferModalOpen(false)}
              disabled={transferWorking}
            >
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={() => void handleExecuteTransfer()}
              disabled={transferWorking || !sourceWallet || !transferAmount.trim()}
            >
              <SendHorizontal size={14} style={{ marginRight: 6 }} />
              {transferWorking ? "Executing…" : "Confirm & Send"}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: "var(--space-12)" }}>
          <div className="stack" style={{ gap: "var(--space-4)" }}>
            <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Source Treasury Wallet</label>
            <select
              value={sourceWallet?.id ?? ""}
              onChange={(e) => {
                const found = rows.find((w) => w.id === e.target.value);
                if (found) setSourceWallet(found);
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "var(--radius-input)",
                background: "var(--surface-container-high)",
                border: "1px solid var(--outline-variant)",
                color: "var(--on-surface)",
              }}
            >
              {rows.map((w) => (
                <option key={w.id} value={w.id} disabled={!w.hasAccess}>
                  {w.label} ({w.kind === "sovereign" ? "Managed" : "Connected"}) — {w.address.slice(0, 6)}…{w.address.slice(-4)}
                </option>
              ))}
            </select>
          </div>

          <div className="stack" style={{ gap: "var(--space-4)" }}>
            <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Destination</label>
            <div className="wallet-kind-toggle" role="tablist" aria-label="Destination type">
              <button
                type="button"
                className={destinationType === "agent" ? "workspace-tab active" : "workspace-tab"}
                onClick={() => setDestinationType("agent")}
              >
                Autonomous Agent
              </button>
              <button
                type="button"
                className={destinationType === "treasury" ? "workspace-tab active" : "workspace-tab"}
                onClick={() => setDestinationType("treasury")}
              >
                Treasury Wallet
              </button>
              <button
                type="button"
                className={destinationType === "custom" ? "workspace-tab active" : "workspace-tab"}
                onClick={() => setDestinationType("custom")}
              >
                External Address
              </button>
            </div>

            {destinationType === "agent" && (
              agentsQuery.data?.length ? (
                <select
                  value={selectedAgentAddress}
                  onChange={(e) => setSelectedAgentAddress(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-input)",
                    background: "var(--surface-container-high)",
                    border: "1px solid var(--outline-variant)",
                    color: "var(--on-surface)",
                  }}
                >
                  {agentsQuery.data.map((agent) => (
                    <option key={agent.address} value={agent.address}>
                      {agent.address.slice(0, 8)}…{agent.address.slice(-6)} ({agent.environment} · {agent.riskTier})
                    </option>
                  ))}
                </select>
              ) : (
                <TextField
                  label="Agent Address (0x…)"
                  value={selectedAgentAddress}
                  onChange={(e) => setSelectedAgentAddress(e.target.value)}
                  placeholder="0x…"
                />
              )
            )}

            {destinationType === "treasury" && (
              <select
                value={selectedTreasuryId}
                onChange={(e) => setSelectedTreasuryId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-input)",
                  background: "var(--surface-container-high)",
                  border: "1px solid var(--outline-variant)",
                  color: "var(--on-surface)",
                }}
              >
                {rows
                  .filter((w) => w.id !== sourceWallet?.id)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label} ({w.address.slice(0, 6)}…{w.address.slice(-4)})
                    </option>
                  ))}
              </select>
            )}

            {destinationType === "custom" && (
              <TextField
                label="Recipient EVM Address (0x…)"
                value={customAddress}
                onChange={(e) => setCustomAddress(e.target.value)}
                placeholder="0x…"
              />
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "var(--space-8)" }}>
            <TextField
              label="Amount"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              placeholder="0.00"
            />
            <div className="stack" style={{ gap: "var(--space-4)" }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Asset</label>
              <select
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value as "USDC" | "MON")}
                style={{
                  height: "40px",
                  padding: "6px 10px",
                  borderRadius: "var(--radius-input)",
                  background: "var(--surface-container-high)",
                  border: "1px solid var(--outline-variant)",
                  color: "var(--on-surface)",
                }}
              >
                <option value="USDC">USDC</option>
                <option value="MON">MON (Gas)</option>
              </select>
            </div>
          </div>

          {transferFeedback && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-card)",
                fontSize: "0.82rem",
                display: "grid",
                gap: "4px",
                background:
                  transferFeedback.type === "success"
                    ? "rgba(46, 125, 50, 0.12)"
                    : transferFeedback.type === "error"
                      ? "rgba(211, 47, 47, 0.12)"
                      : "rgba(2, 136, 209, 0.12)",
                color:
                  transferFeedback.type === "success"
                    ? "var(--success, #4caf50)"
                    : transferFeedback.type === "error"
                      ? "var(--critical, #ef5350)"
                      : "var(--info, #29b6f6)",
                border: "1px solid currentColor",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {transferFeedback.type === "success" && <CheckCircle2 size={15} />}
                <strong>{transferFeedback.message}</strong>
              </div>
              {transferFeedback.txHash && (
                <small>
                  Transaction: <Mono>{transferFeedback.txHash}</Mono>
                </small>
              )}
            </div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={paymasterModalOpen}
        onClose={() => {
          if (!paymasterWorking) setPaymasterModalOpen(false);
        }}
        title="Replenish Paymaster Gas Sponsorship Float"
        description="Deposit native MON into CircuitPaymaster.sol to sponsor gasless transaction execution for sovereign autonomous agents."
        footer={
          <>
            <Button
              variant="text"
              onClick={() => setPaymasterModalOpen(false)}
              disabled={paymasterWorking}
            >
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={() => void handleDepositPaymaster()}
              disabled={paymasterWorking || !primaryTreasury || !paymasterAmount.trim()}
            >
              <Fuel size={14} style={{ marginRight: 6 }} />
              {paymasterWorking ? "Depositing…" : "Deposit MON Float"}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: "var(--space-12)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>Target Treasury:</span>
            <Mono>{primaryTreasury ? `${primaryTreasury.slice(0, 10)}…${primaryTreasury.slice(-6)}` : "No treasury configured"}</Mono>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>Current Float Status:</span>
            <Badge tone={paymasterFloatMon >= 2.0 ? "success" : paymasterFloatMon > 0 ? "warning" : "critical"}>
              {paymasterFloatMon >= 2.0 ? "Optimal Float" : paymasterFloatMon > 0 ? "Low Float" : "Unfunded"} ({paymasterFloatMon.toFixed(4)} MON)
            </Badge>
          </div>
          <TextField
            label="Deposit Amount (MON)"
            type="number"
            min={0.1}
            value={paymasterAmount}
            onChange={(e) => setPaymasterAmount(e.target.value)}
          />
          {paymasterMessage && <p className="form-message">{paymasterMessage}</p>}
        </div>
      </Dialog>
    </div>
  );
}
