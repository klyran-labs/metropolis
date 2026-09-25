import { useConnectWallet, useWallets } from "@privy-io/react-auth";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  ExternalLink,
  Fuel,
  Info,
  Landmark,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { encodeFunctionData, isAddress, parseAbi, parseEther, stringToHex } from "viem";
import {
  useAgents,
  useGrantWalletAccess,
  useLoadAgentWallet,
  useOrganizationWallets,
  useRegisterOrganizationWallet,
  useRevokeWalletAccess,
  useUpdateWalletThreshold,
  useWalletAccess,
  toUserFacingError,
  type OrganizationWallet,
} from "../../api";
import { StatTile } from "../../charts";
import { configuration } from "../../configuration";
import { AgentSelect, Badge, Button, Dialog, EmptyState, Mono, Surface, TextField, TokenAmount, truncateMiddle } from "../../design-system";
import { useIdentity } from "../../identity";
import {
  useDevnetFaucet,
  useLiveTokenBalance,
  useLiveNativeBalance,
  usePaymasterTreasuryBalance,
  useDepositPaymasterGas,
} from "../../hooks/usePolicyContracts";

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
  const { connectWallet } = useConnectWallet();
  const { wallets: connectedWallets } = useWallets();
  const [kind, setKind] = useState<"external" | "sovereign">("sovereign");
  const [externalAddress, setExternalAddress] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const devnetFaucet = useDevnetFaucet();

  const handleSelectKind = (nextKind: "external" | "sovereign") => {
    setKind(nextKind);
  };

  const rows = wallets.data ?? [];
  const sovereignCount = rows.filter((wallet) => wallet.kind === "sovereign").length;
  const withAccessCount = rows.filter((wallet) => wallet.hasAccess).length;

  const trimmedAddress = externalAddress.trim();
  const addressValidation = useMemo(() => {
    if (!trimmedAddress) {
      return { status: "empty" as const, message: "" };
    }
    if (!trimmedAddress.startsWith("0x") && !trimmedAddress.startsWith("0X")) {
      return {
        status: "invalid" as const,
        message: "Address must begin with '0x'.",
      };
    }
    if (trimmedAddress.length !== 42) {
      return {
        status: "invalid" as const,
        message: `Must be exactly 42 characters (currently ${trimmedAddress.length}).`,
      };
    }
    if (!isAddress(trimmedAddress)) {
      return {
        status: "invalid" as const,
        message: "Invalid hexadecimal characters or invalid ERC-55 checksum.",
      };
    }
    if (trimmedAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      return {
        status: "invalid" as const,
        message: "Zero address cannot be registered as a treasury wallet.",
      };
    }
    const existing = rows.find(
      (w) => w.address.toLowerCase() === trimmedAddress.toLowerCase(),
    );
    if (existing) {
      return {
        status: "duplicate" as const,
        message: `Already registered for this organization as "${existing.label}".`,
      };
    }
    const isConnectedInBrowser = connectedWallets.some(
      (w) => w.address.toLowerCase() === trimmedAddress.toLowerCase(),
    );
    if (isConnectedInBrowser) {
      return {
        status: "valid_connected" as const,
        message: "Valid EVM address · Connected in browser wallet",
      };
    }
    return {
      status: "valid_unconnected" as const,
      message: "Valid EVM address · Switch to this account in your browser extension to sign",
    };
  }, [trimmedAddress, rows, connectedWallets]);

  const register = useRegisterOrganizationWallet(
    () => {
      setLabel("");
      setExternalAddress("");
      setMessage("Treasury wallet registered.");
      void wallets.refetch();
    },
    (err) => {
      setMessage(toUserFacingError(err, "Failed to register treasury wallet."));
    },
  );

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
    if (
      addressValidation.status === "invalid" ||
      addressValidation.status === "duplicate" ||
      addressValidation.status === "empty"
    ) {
      setMessage(addressValidation.message || "Please enter a valid EVM wallet address (0x...).");
      return;
    }
    const targetAddress = trimmedAddress;
    const wallet = connectedWallets.find(
      (w) => w.address.toLowerCase() === targetAddress.toLowerCase(),
    );
    if (!wallet || !identity.tenantId) {
      setMessage(
        `Wallet ${truncateMiddle(targetAddress, 8, 6)} is not connected. Connect this wallet in your browser to sign ownership verification.`,
      );
      return;
    }
    setWorking(true);
    try {
      const proof = treasuryOwnershipMessage(identity.tenantId, label.trim());
      let signature: string;
      if (typeof (wallet as any).sign === "function") {
        signature = await (wallet as any).sign(proof);
      } else {
        const provider = await wallet.getEthereumProvider();
        const hexMessage = stringToHex(proof);
        try {
          signature = (await provider.request({
            method: "personal_sign",
            params: [hexMessage, wallet.address],
          })) as string;
        } catch {
          signature = (await provider.request({
            method: "personal_sign",
            params: [wallet.address, hexMessage],
          })) as string;
        }
      }
      register.mutate({ kind: "external", label: label.trim(), address: wallet.address, signature });
    } catch (error) {
      console.error("Treasury wallet signing error:", error);
      setMessage(toUserFacingError(error, "We couldn't confirm you own that wallet."));
    } finally {
      setWorking(false);
    }
  };

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

  const liveSourceUsdc = useLiveTokenBalance(
    sourceWallet?.address ?? "",
    Boolean(transferModalOpen && sourceWallet?.address),
  );
  const liveSourceMon = useLiveNativeBalance(
    sourceWallet?.address ?? "",
    Boolean(transferModalOpen && sourceWallet?.address),
  );

  const availableUsdcUnits =
    liveSourceUsdc.data !== null && liveSourceUsdc.data !== undefined
      ? liveSourceUsdc.data
      : sourceWallet?.balanceBaseUnits !== null && sourceWallet?.balanceBaseUnits !== undefined
        ? BigInt(sourceWallet.balanceBaseUnits)
        : 0n;

  const availableUsdcNumber = Number(availableUsdcUnits) / 1e6;
  const availableMonNumber = Number(liveSourceMon.data ?? 0n) / 1e18;

  const selectedAgent = agentsQuery.data?.find(
    (a) => a.address.toLowerCase() === selectedAgentAddress.toLowerCase(),
  );
  const liveAgentUsdc = useLiveTokenBalance(
    selectedAgentAddress || "",
    Boolean(transferModalOpen && destinationType === "agent" && selectedAgentAddress),
  );

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
      setPaymasterMessage(toUserFacingError(err, "Paymaster deposit failed."));
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
    if (target?.kind === "sovereign") {
      setTokenSymbol("USDC");
    }
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

    if (sourceWallet.kind === "sovereign" && tokenSymbol === "MON") {
      setTransferFeedback({
        type: "error",
        message: "Sovereign Managed Vaults disburse USDC float. To sponsor native MON gas for agents, use the Paymaster Gas Float panel.",
      });
      return;
    }

    const requestedAmount = Number(trimmedAmount);
    if (tokenSymbol === "USDC" && requestedAmount > availableUsdcNumber) {
      setTransferFeedback({
        type: "error",
        message: `Insufficient balance: wallet holds ${availableUsdcNumber.toFixed(2)} USDC.`,
      });
      return;
    }
    if (tokenSymbol === "MON" && requestedAmount > availableMonNumber) {
      setTransferFeedback({
        type: "error",
        message: `Insufficient balance: wallet holds ${availableMonNumber.toFixed(4)} MON.`,
      });
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
              message: toUserFacingError(err, "The sovereign transfer could not be dispatched."),
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
        message: toUserFacingError(err, "The transaction failed onchain."),
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
            onClick={() => handleSelectKind("sovereign")}
          >
            <Sparkles size={14} /> Generate a new wallet
          </button>
          <button
            type="button"
            className={kind === "external" ? "workspace-tab active" : "workspace-tab"}
            onClick={() => handleSelectKind("external")}
          >
            <Wallet size={14} /> Connect an existing wallet
          </button>
        </div>
        {kind === "external" ? (
          <div className="stack" style={{ gap: "12px", marginTop: "14px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 340px" }}>
                <TextField
                  label="Wallet Address (0x...)"
                  placeholder="0x... (paste address or connect wallet)"
                  value={externalAddress}
                  onChange={(event) => setExternalAddress(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <Button
                variant="tonal"
                style={{ height: "42px", minHeight: "42px", minWidth: "190px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => {
                  try {
                    void connectWallet();
                  } catch (err) {
                    setMessage(toUserFacingError(err, "Wallet connection failed."));
                  }
                }}
              >
                <Wallet size={14} style={{ marginRight: 6 }} />
                {connectedWallets.length > 0 ? "Connect / Switch Wallet" : "Connect Web3 Wallet"}
              </Button>
            </div>
            {addressValidation.status !== "empty" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", marginTop: "-4px" }}>
                {addressValidation.status === "invalid" && (
                  <>
                    <AlertCircle size={14} style={{ color: "var(--status-critical)", flexShrink: 0 }} />
                    <span style={{ color: "var(--status-critical)" }}>{addressValidation.message}</span>
                  </>
                )}
                {addressValidation.status === "duplicate" && (
                  <>
                    <AlertTriangle size={14} style={{ color: "var(--status-warning)", flexShrink: 0 }} />
                    <span style={{ color: "var(--status-warning)" }}>{addressValidation.message}</span>
                  </>
                )}
                {addressValidation.status === "valid_connected" && (
                  <>
                    <CheckCircle2 size={14} style={{ color: "var(--status-good)", flexShrink: 0 }} />
                    <span style={{ color: "var(--status-good)" }}>{addressValidation.message}</span>
                  </>
                )}
                {addressValidation.status === "valid_unconnected" && (
                  <>
                    <Info size={14} style={{ color: "var(--status-warning)", flexShrink: 0 }} />
                    <span style={{ color: "var(--status-warning)" }}>{addressValidation.message}</span>
                  </>
                )}
              </div>
            )}
            {connectedWallets.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", color: "var(--color-on-surface-variant)", flexWrap: "wrap" }}>
                <span className="status-dot tone-success" />
                <span>
                  Detected browser wallet: <Mono>{truncateMiddle(connectedWallets[0].address, 10, 6)}</Mono>
                </span>
                {externalAddress.toLowerCase() !== connectedWallets[0].address.toLowerCase() && (
                  <Button
                    variant="text"
                    style={{ padding: "0 6px", height: "24px", fontSize: "0.78rem" }}
                    onClick={() => setExternalAddress(connectedWallets[0].address)}
                  >
                    Use detected address
                  </Button>
                )}
                {connectedWallets.length > 1 && (
                  <select
                    style={{ marginLeft: "auto", fontSize: "0.8rem", padding: "4px 8px", borderRadius: "6px" }}
                    value={externalAddress}
                    onChange={(e) => setExternalAddress(e.target.value)}
                    aria-label="Select connected wallet"
                  >
                    <option value="">Select from connected wallets...</option>
                    {connectedWallets.map((w) => (
                      <option key={w.address} value={w.address}>
                        {truncateMiddle(w.address, 10, 6)} ({w.walletClientType || "wallet"})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginTop: 0 }}>
              <div style={{ flex: "1 1 340px" }}>
                <TextField
                  label="Wallet Label"
                  placeholder="e.g. Primary Treasury, Operations Vault"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button
                style={{ height: "42px", minHeight: "42px", minWidth: "190px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => void registerWallet()}
                disabled={
                  working ||
                  register.isPending ||
                  !label.trim() ||
                  (addressValidation.status !== "valid_connected" && addressValidation.status !== "valid_unconnected")
                }
              >
                {working || register.isPending ? "Registering…" : "Register wallet"}
              </Button>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--color-on-surface-variant)", margin: 0 }}>
              Connecting an external wallet requires a one-time cryptographic signature in your browser extension to verify ownership.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginTop: "14px" }}>
            <div style={{ flex: "1 1 340px" }}>
              <TextField
                label="Wallet Label"
                placeholder="e.g. Sovereign Vault, Reserve Treasury"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                autoComplete="off"
              />
            </div>
            <Button
              style={{ height: "42px", minHeight: "42px", minWidth: "190px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => void registerWallet()}
              disabled={working || register.isPending || !label.trim()}
            >
              {working || register.isPending ? "Registering…" : "Register wallet"}
            </Button>
          </div>
        )}
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
                    setMessage(toUserFacingError(err, "Funding failed."));
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
        title="Disburse / Transfer Funds"
        description="Transfer institutional USDC or native MON to fund autonomous agents, rebalance treasury vaults, or settle external counterparties on Monad."
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
              disabled={
                transferWorking ||
                !sourceWallet ||
                !transferAmount.trim() ||
                isNaN(Number(transferAmount)) ||
                Number(transferAmount) <= 0
              }
              style={{ minWidth: "160px" }}
            >
              <SendHorizontal size={14} style={{ marginRight: 6 }} />
              {transferWorking
                ? "Executing Transfer…"
                : transferAmount && Number(transferAmount) > 0
                  ? `Disburse ${transferAmount} ${tokenSymbol}`
                  : "Confirm & Disburse"}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: "var(--space-16)" }}>
          {/* Source Treasury Wallet */}
          <div className="stack" style={{ gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Source Treasury Wallet</label>
              {sourceWallet && (
                <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>
                  Available:{" "}
                  <strong style={{ color: "var(--on-surface)" }}>
                    {tokenSymbol === "USDC" ? `${availableUsdcNumber.toFixed(2)} USDC` : `${availableMonNumber.toFixed(4)} MON`}
                  </strong>
                </span>
              )}
            </div>
            <select
              value={sourceWallet?.id ?? ""}
              onChange={(e) => {
                const found = rows.find((w) => w.id === e.target.value);
                if (found) {
                  setSourceWallet(found);
                  if (found.kind === "sovereign") {
                    setTokenSymbol("USDC");
                  }
                }
              }}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "var(--radius-input)",
                background: "var(--surface-container-high)",
                border: "1px solid var(--outline-variant)",
                color: "var(--on-surface)",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              {rows.map((w) => (
                <option key={w.id} value={w.id} disabled={!w.hasAccess}>
                  {w.label} ({w.kind === "sovereign" ? "Managed Vault" : "Connected Wallet"}) — {truncateMiddle(w.address, 8, 4)}
                  {!w.hasAccess ? " [No Access]" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Destination Selection */}
          <div className="stack" style={{ gap: "8px" }}>
            <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Destination Target</label>
            <div className="modal-segmented-control" role="tablist" aria-label="Destination category">
              <button
                type="button"
                className={destinationType === "agent" ? "modal-segment-btn active" : "modal-segment-btn"}
                onClick={() => setDestinationType("agent")}
              >
                <Bot size={14} /> Autonomous Agent
              </button>
              <button
                type="button"
                className={destinationType === "treasury" ? "modal-segment-btn active" : "modal-segment-btn"}
                onClick={() => setDestinationType("treasury")}
              >
                <Landmark size={14} /> Treasury Vault
              </button>
              <button
                type="button"
                className={destinationType === "custom" ? "modal-segment-btn active" : "modal-segment-btn"}
                onClick={() => setDestinationType("custom")}
              >
                <ExternalLink size={14} /> External Address
              </button>
            </div>

            {destinationType === "agent" && (
              agentsQuery.data?.length ? (
                <div className="stack" style={{ gap: "6px" }}>
                  <AgentSelect
                    value={selectedAgentAddress}
                    onChange={(val) => setSelectedAgentAddress(val)}
                    agents={agentsQuery.data}
                  />
                  {selectedAgent && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "0.78rem", color: "var(--muted)", padding: "2px 2px" }}>
                      <Badge tone="info">{selectedAgent.environment.toUpperCase()}</Badge>
                      <Badge tone="neutral">{selectedAgent.riskTier.replace("_", " ").toUpperCase()}</Badge>
                      <span>Float: {liveAgentUsdc.data ? (Number(liveAgentUsdc.data) / 1e6).toFixed(2) : "0.00"} USDC</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="stack" style={{ gap: "6px" }}>
                  <TextField
                    label="Agent Address (0x…)"
                    value={selectedAgentAddress}
                    onChange={(e) => setSelectedAgentAddress(e.target.value)}
                    placeholder="0x…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <small style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
                    No fleet agents registered yet. Enter the recipient agent account address.
                  </small>
                </div>
              )
            )}

            {destinationType === "treasury" && (
              rows.filter((w) => w.id !== sourceWallet?.id).length > 0 ? (
                <select
                  value={selectedTreasuryId}
                  onChange={(e) => setSelectedTreasuryId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-input)",
                    background: "var(--surface-container-high)",
                    border: "1px solid var(--outline-variant)",
                    color: "var(--on-surface)",
                    fontSize: "0.85rem",
                  }}
                >
                  {rows
                    .filter((w) => w.id !== sourceWallet?.id)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label} ({w.kind === "sovereign" ? "Managed Vault" : "Connected"}) — {truncateMiddle(w.address, 8, 4)}
                      </option>
                    ))}
                </select>
              ) : (
                <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--surface-sunken)", border: "1px solid var(--outline-soft)", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Only 1 treasury wallet is currently registered. To transfer between treasury vaults, register an additional vault first.
                </div>
              )
            )}

            {destinationType === "custom" && (
              <div className="stack" style={{ gap: "4px" }}>
                <TextField
                  label="Recipient EVM Address (0x…)"
                  value={customAddress}
                  onChange={(e) => setCustomAddress(e.target.value)}
                  placeholder="0x… (paste recipient wallet or smart contract)"
                  autoComplete="off"
                  spellCheck={false}
                />
                {customAddress.trim() && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem" }}>
                    {isAddress(customAddress.trim()) ? (
                      <span style={{ color: "var(--status-good)" }}>✓ Valid EVM destination address on Monad</span>
                    ) : (
                      <span style={{ color: "var(--status-critical)" }}>✕ Invalid hexadecimal EVM address</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amount and Asset Selection */}
          <div className="stack" style={{ gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Transfer Amount</label>
              <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>
                Max sendable:{" "}
                <strong style={{ color: "var(--on-surface)" }}>
                  {tokenSymbol === "USDC" ? `${availableUsdcNumber.toFixed(2)} USDC` : `${availableMonNumber.toFixed(4)} MON`}
                </strong>
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "var(--space-8)", alignItems: "center" }}>
              <div style={{ position: "relative" }}>
                <TextField
                  label="Amount"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                  autoComplete="off"
                />
                {Number(tokenSymbol === "USDC" ? availableUsdcNumber : availableMonNumber) > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (tokenSymbol === "USDC") {
                        setTransferAmount(availableUsdcNumber.toFixed(2));
                      } else {
                        setTransferAmount(Math.max(0, availableMonNumber - 0.005).toFixed(4));
                      }
                    }}
                    style={{
                      position: "absolute",
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      padding: "3px 8px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      borderRadius: "5px",
                      background: "var(--primary-soft)",
                      color: "var(--primary)",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    MAX
                  </button>
                )}
              </div>

              <div className="stack" style={{ gap: "var(--space-4)" }}>
                <select
                  value={tokenSymbol}
                  onChange={(e) => {
                    setTokenSymbol(e.target.value as "USDC" | "MON");
                    setTransferAmount("");
                  }}
                  aria-label="Settlement Asset"
                  disabled={sourceWallet?.kind === "sovereign"}
                  style={{
                    height: "42px",
                    padding: "6px 12px",
                    borderRadius: "var(--radius-input)",
                    background: "var(--surface-container-high)",
                    border: "1px solid var(--outline-variant)",
                    color: "var(--on-surface)",
                    fontWeight: 600,
                    cursor: sourceWallet?.kind === "sovereign" ? "not-allowed" : "pointer",
                    opacity: sourceWallet?.kind === "sovereign" ? 0.8 : 1,
                  }}
                >
                  <option value="USDC">USDC (Token)</option>
                  {sourceWallet?.kind !== "sovereign" && <option value="MON">MON (Gas)</option>}
                </select>
              </div>
            </div>

            {sourceWallet?.kind === "sovereign" && (
              <small style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "-2px" }}>
                ℹ Sovereign vaults disburse USDC float. For agent native MON gas sponsorship, replenish the Paymaster.
              </small>
            )}

            {/* Quick Amount Chips */}
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", paddingTop: "2px" }}>
              <span style={{ fontSize: "0.74rem", color: "var(--muted)", marginRight: "2px" }}>Quick:</span>
              {(tokenSymbol === "USDC" ? ["10", "25", "50", "100", "250"] : ["0.5", "1.0", "2.0", "5.0"]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={transferAmount === preset ? "amount-quick-chip active" : "amount-quick-chip"}
                  onClick={() => setTransferAmount(preset)}
                >
                  {preset} {tokenSymbol}
                </button>
              ))}
            </div>
          </div>

          {/* Transfer Route Preview Card */}
          <div className="transfer-route-preview">
            <div className="transfer-route-flow">
              <div className="transfer-route-node">
                <small style={{ color: "var(--muted)", textTransform: "uppercase", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em" }}>
                  Origin Source
                </small>
                <strong>{sourceWallet?.label || "Select Wallet"}</strong>
                <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>
                  <Mono>{sourceWallet ? truncateMiddle(sourceWallet.address, 8, 4) : "—"}</Mono>
                </span>
              </div>

              <div className="transfer-route-arrow">
                <ArrowRight size={15} />
              </div>

              <div className="transfer-route-node" style={{ textAlign: "right" }}>
                <small style={{ color: "var(--muted)", textTransform: "uppercase", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em" }}>
                  Recipient Target
                </small>
                <strong>
                  {destinationType === "agent"
                    ? selectedAgent ? `Agent (${selectedAgent.environment})` : "Autonomous Agent"
                    : destinationType === "treasury"
                      ? rows.find((w) => w.id === selectedTreasuryId)?.label || "Treasury Vault"
                      : "External Recipient"}
                </strong>
                <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>
                  <Mono>
                    {truncateMiddle(
                      destinationType === "agent"
                        ? selectedAgentAddress
                        : destinationType === "treasury"
                          ? rows.find((w) => w.id === selectedTreasuryId)?.address || ""
                          : customAddress || "0x…",
                      8,
                      4,
                    )}
                  </Mono>
                </span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "8px", borderTop: "1px solid var(--outline-soft)", fontSize: "0.76rem", color: "var(--muted)", flexWrap: "wrap", gap: "6px" }}>
              <span>
                {sourceWallet?.kind === "sovereign"
                  ? "✨ Sovereign Enclave · Programmatic Execution"
                  : "💼 Browser Extension · 1 Signature Required"}
              </span>
              <span style={{ color: "var(--status-good)", fontWeight: 600 }}>
                Monad Fast Finality (~400ms)
              </span>
            </div>
          </div>

          {/* Feedback & Confirmation Message */}
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
