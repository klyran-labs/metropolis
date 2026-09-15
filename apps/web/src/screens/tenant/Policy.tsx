import { useWallets } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { request, useAgentPolicy, useAgents, type PolicyUpdate } from "../../api";
import { Button, EmptyState, RecordSummary, Surface, TextField } from "../../design-system";
import { useIdentity } from "../../identity";

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
        throw new Error("The settlement approval was rejected by the network.");
      }
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  }
  throw new Error("The settlement approval did not reach finality in time.");
}

const policyLabels: Record<string, string> = {
  maxPerTx: "Maximum per transaction",
  maxPerWindow: "Maximum per window",
  windowSeconds: "Window duration (seconds)",
  maxVelocity: "Velocity limit",
  killSwitch: "Paused",
  whitelistEnabled: "Approved merchants required",
};

export function Policy() {
  const identity = useIdentity();
  const agents = useAgents(Boolean(identity.authenticated));
  const [agent, setAgent] = useState("");
  const policy = useAgentPolicy(agent, Boolean(identity.authenticated));
  const { wallets } = useWallets();
  const [draft, setDraft] = useState<PolicyUpdate>({
    maxPerTx: "0",
    maxPerWindow: "0",
    windowSeconds: 3600,
    maxVelocity: 1,
    killSwitch: false,
    whitelistEnabled: false,
  });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!policy.data) return;
    setDraft({
      maxPerTx: String(policy.data.maxPerTx ?? "0"),
      maxPerWindow: String(policy.data.maxPerWindow ?? "0"),
      windowSeconds: Number(policy.data.windowSeconds ?? 3600),
      maxVelocity: Number(policy.data.maxVelocity ?? 1),
      killSwitch: Boolean(policy.data.killSwitch),
      whitelistEnabled: Boolean(policy.data.whitelistEnabled),
    });
  }, [policy.data]);
  const publish = async () => {
    const wallet = wallets[0];
    if (!agent || !wallet) {
      setMessage("Connect your organization's admin wallet before publishing policy.");
      return;
    }
    try {
      setMessage("Preparing the policy change…");
      const prepared = await request<{ target: string; data: string }>(
        `/agents/${encodeURIComponent(agent)}/policy`,
        { method: "POST", body: JSON.stringify(draft) },
      );
      const provider = await wallet.getEthereumProvider();
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: prepared.target, data: prepared.data }],
      })) as string;
      await waitForReceipt(provider, hash);
      setMessage("Policy change confirmed on the settlement network.");
      void policy.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The policy change could not be completed.");
    }
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Home / Policy</span>
          <h1>Policy</h1>
          <p>Only your organization's admin wallet can publish policy changes, and every change is verified onchain.</p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Onchain policy state</h2>
            <p>Read directly from the verified policy contract.</p>
          </div>
        </div>
        <select aria-label="Agent policy" value={agent} onChange={(event) => setAgent(event.target.value)}>
          <option value="">Select an agent</option>
          {agents.data?.map((item) => (
            <option key={item.address} value={item.address}>
              {item.address}
            </option>
          ))}
        </select>
        <div className="form-grid">
          <TextField
            label="Maximum per transaction"
            value={draft.maxPerTx}
            onChange={(event) => setDraft({ ...draft, maxPerTx: event.target.value })}
          />
          <TextField
            label="Maximum per window"
            value={draft.maxPerWindow}
            onChange={(event) => setDraft({ ...draft, maxPerWindow: event.target.value })}
          />
          <TextField
            label="Window duration (seconds)"
            type="number"
            min={1}
            value={draft.windowSeconds}
            onChange={(event) => setDraft({ ...draft, windowSeconds: Number(event.target.value) })}
          />
          <TextField
            label="Velocity limit"
            type="number"
            min={1}
            value={draft.maxVelocity}
            onChange={(event) => setDraft({ ...draft, maxVelocity: Number(event.target.value) })}
          />
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.killSwitch}
              onChange={(event) => setDraft({ ...draft, killSwitch: event.target.checked })}
            />
            Pause agent activity
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.whitelistEnabled}
              onChange={(event) => setDraft({ ...draft, whitelistEnabled: event.target.checked })}
            />
            Require approved merchants
          </label>
          <Button onClick={() => void publish()} disabled={!agent}>
            Publish policy
          </Button>
        </div>
        {message && <p className="form-message">{message}</p>}
        {policy.isError ? (
          <EmptyState title="Policy unavailable" detail="The selected policy could not be read from Monad." />
        ) : policy.data ? (
          <RecordSummary record={policy.data} labels={policyLabels} />
        ) : (
          <EmptyState title="No policy selected" detail="Choose an agent to inspect its chain-derived limits." />
        )}
      </Surface>
    </div>
  );
}
