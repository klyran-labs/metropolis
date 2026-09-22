import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  Bot,
  Building2,
  Check,
  CreditCard,
  ExternalLink,
  Lock,
  PauseCircle,
  Radio,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import {
  useAgents,
  useSubscription,
  useTelemetryEvents,
  useOrganizationWallets,
  toUserFacingError,
  type Subscription,
  type Agent,
} from "../../api";
import { Badge, Button, Mono, Surface, TokenAmount, truncateMiddle } from "../../design-system";
import { Breakdown, Gauge, StatTile, TrendArea } from "../../charts";
import { useIdentity } from "../../identity";
import { AgentInspector } from "./AgentInspector";
import { useTripKillSwitch } from "../../hooks/usePolicyContracts";

function computeStats(agents: Agent[] | undefined, telemetryCount: number) {
  const active = agents?.filter((agent) => agent.status === "active").length ?? 0;
  const paused = (agents?.length ?? 0) - active;
  return { active, paused, total: agents?.length ?? 0, telemetryCount };
}

export function Overview() {
  const identity = useIdentity();
  const agents = useAgents(Boolean(identity.authenticated));
  const wallets = useOrganizationWallets(Boolean(identity.authenticated));
  const subscription = useSubscription(Boolean(identity.authenticated));
  const telemetry = useTelemetryEvents(Boolean(identity.authenticated));

  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [emergencyAddress, setEmergencyAddress] = useState("");
  const [emergencyMessage, setEmergencyMessage] = useState("");

  const { active, paused, total } = computeStats(agents.data, telemetry.data?.length ?? 0);
  const recentEvents = telemetry.data?.slice(0, 6) ?? [];
  const hasSubscription = Boolean((subscription.data as Subscription | undefined)?.subscription);

  const filteredAgents = useMemo(() => {
    const list = agents.data ?? [];
    if (!agentSearch.trim()) return list;
    const query = agentSearch.toLowerCase();
    return list.filter(
      (a) =>
        a.address.toLowerCase().includes(query) ||
        a.riskTier.toLowerCase().includes(query) ||
        (a.walletSource && a.walletSource.toLowerCase().includes(query)),
    );
  }, [agents.data, agentSearch]);

  const eventBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of telemetry.data ?? []) {
      counts.set(event.eventName, (counts.get(event.eventName) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value }));
  }, [telemetry.data]);

  const dailyVolume = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of telemetry.data ?? []) {
      const day = new Date(event.observedAt).toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([label, value]) => ({ label: label.slice(5), value }));
  }, [telemetry.data]);

  const tripKillSwitch = useTripKillSwitch();

  const handleTripEmergency = async () => {
    if (!emergencyAddress.trim()) return;
    setEmergencyMessage(`Broadcasting O(1) Kill-Switch freeze for ${emergencyAddress.slice(0, 10)}…`);
    try {
      await tripKillSwitch.mutateAsync({
        agentAddress: emergencyAddress.trim(),
        active: true,
      });
      setEmergencyMessage(`Kill-Switch active onchain for ${emergencyAddress.slice(0, 10)}… Invariant enforced.`);
      setEmergencyAddress("");
      void agents.refetch();
    } catch (err) {
      setEmergencyMessage(toUserFacingError(err, "Kill-switch transaction failed."));
    }
    setTimeout(() => setEmergencyMessage(""), 6000);
  };

  const operatorLabel = identity.subject?.split(":").at(-1)?.slice(0, 8) ?? "operator";
  const subscriptionStatus = hasSubscription
    ? String((subscription.data as Subscription).subscription?.status ?? "recorded")
    : "not configured";
  const readinessSteps = [
    {
      label: "Connect a treasury wallet",
      detail: "Fund and recover agent balances from an organization-controlled wallet.",
      done: (wallets.data?.length ?? 0) > 0,
      to: "/app/treasury" as const,
    },
    {
      label: "Register your first agent",
      detail: "Create a managed vault or link an existing wallet to your fleet.",
      done: total > 0,
      to: "/app/fleet" as const,
    },
    {
      label: "Verify chain activity",
      detail: "Run a policy simulation or wait for your first finalized event.",
      done: (telemetry.data?.length ?? 0) > 0,
      to: "/app/activity" as const,
    },
  ];
  const showReadiness = readinessSteps.some((step) => !step.done);

  return (
    <div className="dashboard-stack">
      {/* Top Header */}
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">Enterprise Control Plane</span>
          <h1>Spend Governance & Overview</h1>
          <p>Real-time autonomous spend evaluation, parallel EVM settlement, and telemetry.</p>
        </div>
        <div className="dashboard-actions">
          <Link to="/app/fleet" className="control control-filled">
            <Bot size={15} />
            <span>Provision Agent</span>
          </Link>
        </div>
      </header>

      {/* Stat Tiles Row */}
      <div className="stat-row">
        <StatTile label="Fleet size" value={String(total)} icon={<Bot size={18} />} accent={0} />
        <StatTile label="Active & Guarded" value={String(active)} icon={<Activity size={18} />} accent={2} />
        <StatTile label="Circuit Paused" value={String(paused)} icon={<PauseCircle size={18} />} accent={1} />
        <StatTile label="Verified Telemetry" value={String(telemetry.data?.length ?? 0)} icon={<Radio size={18} />} accent={5} />
      </div>

      {showReadiness && (
        <Surface className="readiness-card">
          <div className="readiness-heading">
            <div>
              <span className="eyebrow">Workspace readiness</span>
              <h2>Complete the operating path</h2>
              <p>Use real organization and chain state to take the workspace from setup to governed execution.</p>
            </div>
            <Badge tone="info">{readinessSteps.filter((step) => step.done).length}/{readinessSteps.length} complete</Badge>
          </div>
          <div className="readiness-steps">
            {readinessSteps.map((step) => (
              <Link to={step.to} className={`readiness-step ${step.done ? "is-complete" : ""}`} key={step.label}>
                <span className="readiness-step-icon" aria-hidden="true">
                  {step.done ? <Check size={14} /> : <span />}
                </span>
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Surface>
      )}

      {/* Reference Image Style Upper Grid: Hero + Highlights */}
      <div className="saas-reference-grid">
        {/* Left Hero Card: Swift Setup / Spend Governance Posture */}
        <Surface className="saas-hero-card">
          <div className="saas-hero-content">
            <div className="saas-hero-icon-badge">
              <ShieldCheck size={28} />
            </div>
            <span className="saas-hero-kicker">High-Throughput Policy Engine</span>
            <h2>Autonomous Spend Governance</h2>
            <p>
              Enhance agent formation and treasury management with sub-second Monad settlement,
              private organizational spend invariants, and cryptographic auditability.
            </p>
            <div className="saas-hero-actions">
              <Link to="/app/fleet" className="saas-hero-btn primary">
                Register New Agent
              </Link>
              <Link to="/app/policy" className="saas-hero-btn secondary">
                Author Policy Rule
              </Link>
            </div>
          </div>
        </Surface>

        {/* Right Highlights Card: Stacked Progress Bar & Channel Breakdown */}
        <Surface className="saas-highlights-card">
          <div className="highlights-header">
            <h3>Fleet Posture & Highlights</h3>
            <span className="status-dot status-dot-success" title="Monad activity available" />
          </div>

          <div className="highlights-headline">
            <small>Active Spend Governance Fleet</small>
            <div className="headline-number-row">
              <span className="headline-currency">{total} Registered Agents</span>
              <span className="delta-badge positive">
                <TrendingUp size={13} /> {active} Active
              </span>
            </div>
          </div>

          {/* Multi-Segment Stacked Allocation Bar Derived From Real Data */}
          {total + (wallets.data?.length ?? 0) > 0 ? (
            <>
              <div className="stacked-allocation-bar">
                {agents.data?.filter((a) => a.walletSource === "sovereign").length ? (
                  <div
                    className="allocation-segment seg-blue"
                    style={{
                      width: `${Math.round(
                        ((agents.data.filter((a) => a.walletSource === "sovereign").length) /
                          Math.max(1, total + (wallets.data?.length ?? 0))) *
                          100,
                      )}%`,
                    }}
                    title={`Managed Enclaves (${agents.data.filter((a) => a.walletSource === "sovereign").length})`}
                  />
                ) : null}
                {agents.data?.filter((a) => a.walletSource !== "sovereign").length ? (
                  <div
                    className="allocation-segment seg-green"
                    style={{
                      width: `${Math.round(
                        ((agents.data.filter((a) => a.walletSource !== "sovereign").length) /
                          Math.max(1, total + (wallets.data?.length ?? 0))) *
                          100,
                      )}%`,
                    }}
                    title={`Connected Wallets (${agents.data.filter((a) => a.walletSource !== "sovereign").length})`}
                  />
                ) : null}
                {wallets.data?.length ? (
                  <div
                    className="allocation-segment seg-amber"
                    style={{
                      width: `${Math.round(
                        (wallets.data.length / Math.max(1, total + (wallets.data?.length ?? 0))) * 100,
                      )}%`,
                    }}
                    title={`Treasury Pools (${wallets.data.length})`}
                  />
                ) : null}
              </div>

              <div className="stacked-legend">
                <span><span className="legend-dot seg-blue" /> Managed Enclaves ({agents.data?.filter((a) => a.walletSource === "sovereign").length ?? 0})</span>
                <span><span className="legend-dot seg-green" /> Connected Wallets ({agents.data?.filter((a) => a.walletSource !== "sovereign").length ?? 0})</span>
                <span><span className="legend-dot seg-amber" /> Treasury ({wallets.data?.length ?? 0})</span>
              </div>
            </>
          ) : (
            <div className="stacked-allocation-empty">
              <small>No agents or treasury wallets provisioned yet.</small>
            </div>
          )}

          {/* Itemized Channel Rows Derived from Real Onchain Data */}
          <div className="channel-list">
            <div className="channel-row">
              <div className="channel-info">
                <Lock size={15} />
                <span>Sovereign Enclave Vaults</span>
              </div>
              <div className="channel-metrics">
                <strong>{agents.data?.filter((a) => a.walletSource === "sovereign").length ?? 0} active</strong>
                <span className="channel-delta positive">
                  <ShieldCheck size={12} /> Sovereign Vault
                </span>
              </div>
            </div>

            <div className="channel-row">
              <div className="channel-info">
                <Wallet size={15} />
                <span>Connected Agent Wallets</span>
              </div>
              <div className="channel-metrics">
                <strong>{agents.data?.filter((a) => a.walletSource !== "sovereign").length ?? 0} linked</strong>
                <span className="channel-delta neutral">
                  <Check size={12} /> Non-Custodial
                </span>
              </div>
            </div>

            <div className="channel-row">
              <div className="channel-info">
                <Building2 size={15} />
                <span>Organization Treasury</span>
              </div>
              <div className="channel-metrics">
                <strong>{wallets.data?.length ?? 0} vaults</strong>
                <span className="channel-delta positive">
                  <TrendingUp size={12} /> Onchain
                </span>
              </div>
            </div>

            <div className="channel-row">
              <div className="channel-info">
                <Zap size={15} />
                <span>Parallel EVM Settlement</span>
              </div>
              <div className="channel-metrics">
                <strong>{telemetry.data?.length ?? 0} events</strong>
                <span className="channel-delta positive">
                  <Radio size={12} /> Chain-derived
                </span>
              </div>
            </div>
          </div>
        </Surface>
      </div>

      {/* Reference Image Style Lower Grid: Active Fleet Table + Circuit Breaker Block List */}
      <div className="saas-lower-grid">
        {/* Fleet Table Card */}
        <Surface className="saas-table-card">
          <div className="table-card-head">
            <div className="table-card-title">
              <h3>Fleet Roster</h3>
              <small>{filteredAgents.length} agents under governance</small>
            </div>
            <div className="table-search-input">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search agents, tiers, vaults..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
              />
            </div>
          </div>

          {filteredAgents.length ? (
            <div className="dense-table-wrapper">
              <table className="dense-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Wallet Type</th>
                    <th>Risk Tier</th>
                    <th>State</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((agent) => (
                    <tr
                      key={agent.address}
                      className="clickable-row"
                      onClick={() => setSelectedAgent(agent)}
                    >
                      <td>
                        <div className="agent-ident-cell">
                          <div className="agent-mini-icon">
                            <Bot size={14} />
                          </div>
                          <Mono>{truncateMiddle(agent.address, 8, 4)}</Mono>
                        </div>
                      </td>
                      <td>
                        <Badge tone={agent.walletSource === "sovereign" ? "info" : "neutral"}>
                          {agent.walletSource === "sovereign" ? "Managed Vault" : "Connected"}
                        </Badge>
                      </td>
                      <td>{agent.riskTier}</td>
                      <td>
                        <span className={`status-pill ${agent.status === "active" ? "active" : "paused"}`}>
                          <span className="status-dot-sm" />
                          {agent.status}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="text"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAgent(agent);
                          }}
                        >
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card-empty">
              <strong>No matching agents found.</strong>
              <p>Register your first agent in Fleet to activate spend control.</p>
            </div>
          )}
        </Surface>

        {/* Emergency Circuit Breaker (Block List) Card */}
        <Surface className="saas-circuit-card">
          <div className="circuit-card-head">
            <div className="circuit-head-title">
              <AlertOctagon size={18} className="circuit-icon" />
              <h3>Circuit Breaker</h3>
            </div>
            <span className="fast-pill">O(1) Short-Circuit</span>
          </div>

          <p className="circuit-card-desc">
            Emergency freeze halting unauthorized spend across the Monad parallel execution plane without computing sliding window arithmetic.
          </p>

          <div className="circuit-action-box">
            <input
              type="text"
              className="circuit-input"
              placeholder="0x... Agent address to freeze"
              value={emergencyAddress}
              onChange={(e) => setEmergencyAddress(e.target.value)}
            />
            <button
              type="button"
              className="circuit-submit-btn"
              onClick={handleTripEmergency}
              disabled={!emergencyAddress.trim()}
            >
              Freeze
            </button>
          </div>

          {emergencyMessage && (
            <div className="circuit-alert-banner">
              <ShieldAlert size={14} />
              <span>{emergencyMessage}</span>
            </div>
          )}

          <div className="circuit-stats-footer">
            <div className="circuit-stat">
              <small>Kill-Switch Invariant</small>
              <strong>O(1) Evaluation</strong>
            </div>
            <div className="circuit-stat">
              <small>Disjoint Partitions</small>
              <strong>Zero Aborts</strong>
            </div>
          </div>
        </Surface>
      </div>

      {/* Telemetry Charts Section */}
      <div className="dashboard-grid">
        <Surface className="dashboard-card dashboard-card-wide">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Verified activity</span>
              <h2>Telemetry volume</h2>
            </div>
          </div>
          <TrendArea
            data={dailyVolume}
            seriesName="Events"
            emptyTitle="No finalized activity yet"
            emptyDetail="Verified policy and settlement events will appear here as they happen."
            valueFormatter={(value) => String(Math.round(value))}
          />
        </Surface>

        <Surface className="dashboard-card dashboard-card-medium">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Fleet posture</span>
              <h2>Active ratio</h2>
            </div>
          </div>
          <Gauge
            label="Active agents"
            value={total ? (active / total) * 100 : 0}
            detail={`${active} of ${total} agents active`}
          />
        </Surface>

        <Surface className="dashboard-card dashboard-card-medium">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Event mix</span>
              <h2>By type</h2>
            </div>
          </div>
          <Breakdown
            data={eventBreakdown}
            emptyTitle="No events yet"
            emptyDetail="Event types will appear once telemetry is observed."
          />
        </Surface>
      </div>

      {/* Slide-Over Agent Inspector Drawer */}
      {selectedAgent && (
        <AgentInspector
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onTripCircuit={async (addr, trip) => {
            setEmergencyMessage(`Updating circuit status onchain for ${addr.slice(0, 10)}…`);
            try {
              await tripKillSwitch.mutateAsync({ agentAddress: addr, active: trip });
              setEmergencyMessage(`Agent ${addr.slice(0, 10)}… ${trip ? "frozen onchain" : "resumed onchain"}.`);
              void agents.refetch();
            } catch (err) {
              setEmergencyMessage(toUserFacingError(err, "Circuit update failed."));
            }
            setTimeout(() => setEmergencyMessage(""), 5000);
          }}
        />
      )}
    </div>
  );
}
