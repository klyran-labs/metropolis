import { useWallets } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  PlayCircle,
  ShieldCheck,
  ShieldAlert,
  Sliders,
  Sparkles,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { encodeFunctionData, isAddress, type Address } from "viem";
import { request, useAgentPolicy, useAgents, type PolicyUpdate } from "../../api";
import { configuration } from "../../configuration";
import { Badge, Button, EmptyState, Mono, RecordSummary, Surface, TextField } from "../../design-system";
import { POLICY_ENGINE_ABI } from "../../hooks/usePolicyContracts";
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

interface PolicyPreset {
  label: string;
  description: string;
  maxPerTx: string;
  maxPerWindow: string;
  windowSeconds: number;
  maxVelocity: number;
}

const POLICY_PRESETS: PolicyPreset[] = [
  {
    label: "Micro Inference",
    description: "LLM completions & embeddings ($10/tx, $100/hr)",
    maxPerTx: "10000000",
    maxPerWindow: "100000000",
    windowSeconds: 3600,
    maxVelocity: 50,
  },
  {
    label: "Standard Autonomous",
    description: "Autonomous task execution ($50/tx, $500/hr)",
    maxPerTx: "50000000",
    maxPerWindow: "500000000",
    windowSeconds: 3600,
    maxVelocity: 20,
  },
  {
    label: "High-Volume Trader",
    description: "DeFi rebalancing & high-cadence bots ($250/tx, $2k/hr)",
    maxPerTx: "250000000",
    maxPerWindow: "2000000000",
    windowSeconds: 3600,
    maxVelocity: 100,
  },
  {
    label: "Alibaba Qwen 3.8 Max Agent",
    description: "ADR-0008 Autonomous Inference Workload ($0.10/tx, $1.50/hr, 10 tx/hr velocity)",
    maxPerTx: "100000",
    maxPerWindow: "1500000",
    windowSeconds: 3600,
    maxVelocity: 10,
  },
];

export function Policy() {
  const identity = useIdentity();
  const agents = useAgents(Boolean(identity.authenticated));
  const [agent, setAgent] = useState("");
  const policy = useAgentPolicy(agent, Boolean(identity.authenticated && agent));
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
  const [isPublishing, setIsPublishing] = useState(false);

  // Auto-select first agent if available and none selected
  useEffect(() => {
    if (!agent && agents.data && agents.data.length > 0) {
      setAgent(agents.data[0].address);
    }
  }, [agents.data, agent]);

  // Check for policy staged from Qwen AI Copilot
  useEffect(() => {
    try {
      const staged = sessionStorage.getItem("agentguard_staged_policy");
      if (staged) {
        const parsed = JSON.parse(staged);
        sessionStorage.removeItem("agentguard_staged_policy");
        setDraft((prev) => ({
          ...prev,
          maxPerTx: parsed.maxPerTx ?? prev.maxPerTx,
          maxPerWindow: parsed.maxPerWindow ?? prev.maxPerWindow,
          windowSeconds: parsed.windowSeconds ?? prev.windowSeconds,
          maxVelocity: parsed.maxVelocity ?? prev.maxVelocity,
          whitelistEnabled: parsed.whitelistEnabled ?? prev.whitelistEnabled,
        }));
        setMessage("Pre-filled policy parameters synthesized by Alibaba Qwen 3.8 Max Copilot.");
      }
    } catch {
      // ignore
    }
  }, []);

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

  const applyPreset = (preset: PolicyPreset) => {
    setDraft((prev) => ({
      ...prev,
      maxPerTx: preset.maxPerTx,
      maxPerWindow: preset.maxPerWindow,
      windowSeconds: preset.windowSeconds,
      maxVelocity: preset.maxVelocity,
    }));
  };

  const setDuration = (seconds: number) => {
    setDraft((prev) => ({ ...prev, windowSeconds: seconds }));
  };

  const publish = async () => {
    const wallet = wallets[0];
    if (!agent || !wallet) {
      setMessage("Connect your organization's admin wallet before publishing policy.");
      return;
    }
    setIsPublishing(true);
    try {
      setMessage("Preparing the policy change…");
      let target: string;
      let data: string;

      try {
        const prepared = await request<{ target: string; data: string }>(
          `/agents/${encodeURIComponent(agent)}/policy`,
          { method: "POST", body: JSON.stringify(draft) },
        );
        target = prepared.target;
        data = prepared.data;
      } catch {
        // Direct onchain fallback if gateway REST endpoint is unreachable
        const engineAddress = configuration.contracts.policyEngine;
        if (!engineAddress || !isAddress(engineAddress)) {
          throw new Error("PolicyEngine contract address is not configured.");
        }
        target = engineAddress;
        data = encodeFunctionData({
          abi: POLICY_ENGINE_ABI,
          functionName: "setPolicy",
          args: [
            agent as Address,
            {
              maxPerTx: BigInt(draft.maxPerTx || "0"),
              maxPerWindow: BigInt(draft.maxPerWindow || "0"),
              windowSeconds: draft.windowSeconds,
              maxVelocity: draft.maxVelocity,
              killSwitch: draft.killSwitch,
              whitelistEnabled: draft.whitelistEnabled,
            },
          ],
        });
      }

      const provider = await wallet.getEthereumProvider();
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: target, data }],
      })) as string;
      await waitForReceipt(provider, hash);
      setMessage("Policy change confirmed on the settlement network.");
      void policy.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The policy change could not be completed.");
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Risk Governance / Policy Engine</span>
          <h1>Policy Studio</h1>
          <p>
            Author and enforce deterministic Monad EVM spend invariants per autonomous agent. Changes settle atomically in 400ms.
          </p>
        </div>
        <div className="page-heading-actions">
          <Link to="/app/simulator" className="control control-tonal">
            <PlayCircle size={15} />
            <span>Open "What-If" Simulator</span>
          </Link>
        </div>
      </header>

      {/* 2-Column Studio Grid */}
      <div className="policy-studio-grid">
        {/* Left Column: Authoring Form */}
        <Surface className="policy-editor-panel">
          <div className="section-heading">
            <div>
              <h2>Policy Authoring</h2>
              <p>Configure ceilings, sliding window epochs, and circuit breakers.</p>
            </div>
            {draft.killSwitch ? (
              <Badge tone="critical">Paused</Badge>
            ) : (
              <Badge tone="success">Active</Badge>
            )}
          </div>

          <div className="policy-field-group">
            <label className="field-label">Target Agent</label>
            <select
              aria-label="Agent policy"
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
              className="policy-agent-select"
            >
              <option value="">Select an agent</option>
              {agents.data?.map((item) => (
                <option key={item.address} value={item.address}>
                  {item.address} ({item.riskTier} tier)
                </option>
              ))}
            </select>
          </div>

          {/* Quick Presets */}
          <div className="policy-presets-container">
            <div className="presets-label-row">
              <Sliders size={13} className="text-muted" />
              <span className="preset-kicker">Role Presets:</span>
            </div>
            <div className="policy-preset-chips">
              {POLICY_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.label}
                  className="policy-preset-chip"
                  onClick={() => applyPreset(p)}
                  title={p.description}
                >
                  <Sparkles size={12} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-grid">
            <TextField
              label="Maximum per transaction (USDC base units)"
              value={draft.maxPerTx}
              onChange={(event) => setDraft({ ...draft, maxPerTx: event.target.value })}
            />
            <TextField
              label="Maximum per window (USDC base units)"
              value={draft.maxPerWindow}
              onChange={(event) => setDraft({ ...draft, maxPerWindow: event.target.value })}
            />

            <div className="duration-input-wrapper">
              <TextField
                label="Window duration (seconds)"
                type="number"
                min={1}
                value={draft.windowSeconds}
                onChange={(event) => setDraft({ ...draft, windowSeconds: Number(event.target.value) })}
              />
              <div className="duration-quick-chips">
                <button
                  type="button"
                  className={`duration-chip ${draft.windowSeconds === 900 ? "active" : ""}`}
                  onClick={() => setDuration(900)}
                >
                  15m
                </button>
                <button
                  type="button"
                  className={`duration-chip ${draft.windowSeconds === 3600 ? "active" : ""}`}
                  onClick={() => setDuration(3600)}
                >
                  1h
                </button>
                <button
                  type="button"
                  className={`duration-chip ${draft.windowSeconds === 86400 ? "active" : ""}`}
                  onClick={() => setDuration(86400)}
                >
                  24h
                </button>
              </div>
            </div>

            <TextField
              label="Velocity limit (txs per window)"
              type="number"
              min={1}
              value={draft.maxVelocity}
              onChange={(event) => setDraft({ ...draft, maxVelocity: Number(event.target.value) })}
            />

            <div className="policy-toggle-group">
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={draft.killSwitch}
                  onChange={(event) => setDraft({ ...draft, killSwitch: event.target.checked })}
                />
                <span className="check-title">Pause agent activity (O(1) Kill Switch)</span>
              </label>

              <label className="check-field">
                <input
                  type="checkbox"
                  checked={draft.whitelistEnabled}
                  onChange={(event) => setDraft({ ...draft, whitelistEnabled: event.target.checked })}
                />
                <span className="check-title">Require approved merchants from directory</span>
              </label>
            </div>

            <Button
              onClick={() => void publish()}
              disabled={!agent || isPublishing}
              className="publish-policy-btn"
            >
              {isPublishing ? "Submitting to Monad…" : "Publish Policy to Monad"}
            </Button>
          </div>

          {message && (
            <div className={`form-message-banner ${message.includes("confirmed") ? "banner-success" : ""}`}>
              {message.includes("confirmed") ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{message}</span>
            </div>
          )}
        </Surface>

        {/* Right Column: Live Onchain State & Verification */}
        <div className="policy-state-column">
          <Surface className="policy-preview-card">
            <div className="section-heading">
              <div>
                <h2>Live Onchain Policy</h2>
                <p>Derived directly from Monad verified storage slots.</p>
              </div>
              <span className="epoch-pill">
                <span className="epoch-dot" />
                Slot 0 Word
              </span>
            </div>

            {policy.isError ? (
              <EmptyState title="Policy unavailable" detail="The selected policy could not be read from Monad." />
            ) : policy.data ? (
              <div className="policy-metrics-breakdown">
                <div className="policy-metric-tile">
                  <span className="tile-label">Max Per Transaction</span>
                  <strong className="tile-val">
                    {(Number(policy.data.maxPerTx ?? 0) / 1_000_000).toFixed(2)} USDC
                  </strong>
                  <small className="tile-sub">Base units: {String(policy.data.maxPerTx ?? 0)}</small>
                </div>

                <div className="policy-metric-tile">
                  <span className="tile-label">Sliding Window Cap</span>
                  <strong className="tile-val">
                    {(Number(policy.data.maxPerWindow ?? 0) / 1_000_000).toFixed(2)} USDC
                  </strong>
                  <small className="tile-sub">Per {String(policy.data.windowSeconds ?? 3600)}s epoch</small>
                </div>

                <div className="policy-metric-tile">
                  <span className="tile-label">Velocity Ceiling</span>
                  <strong className="tile-val">{String(policy.data.maxVelocity ?? 1)} txs</strong>
                  <small className="tile-sub">Max payments per epoch</small>
                </div>

                <div className="policy-metric-tile">
                  <span className="tile-label">Enforced Standards</span>
                  <div className="enforced-tags">
                    <Badge tone={policy.data.killSwitch ? "critical" : "success"}>
                      {policy.data.killSwitch ? "Circuit Tripped" : "Guarded Active"}
                    </Badge>
                    <Badge tone={policy.data.whitelistEnabled ? "info" : "neutral"}>
                      {policy.data.whitelistEnabled ? "Whitelist Required" : "Open Merchant"}
                    </Badge>
                  </div>
                </div>

                <div className="simulator-cta-box">
                  <div className="cta-copy">
                    <strong>Want to verify this policy safely?</strong>
                    <p>Dry-run simulated payments against Monad Cancun transient storage with zero financial risk.</p>
                  </div>
                  <Link to="/app/simulator" className="control control-tonal cta-btn">
                    <span>Dry-Run in Simulator</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No agent selected"
                detail="Choose an agent to inspect and publish its onchain policy limits."
              />
            )}
          </Surface>
        </div>
      </div>
    </div>
  );
}
