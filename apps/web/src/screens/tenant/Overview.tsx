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
  RefreshCw,
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
import { eventLabel } from "../../copy";
import { Breakdown, Gauge, StatTile, TrendArea } from "../../charts";
import { useIdentity } from "../../identity";
import { AgentInspector } from "./AgentInspector";
import { useTripKillSwitch } from "../../hooks/usePolicyContracts";
import { useToast } from "../../components/UndoToast";
import { AgentOnboardingModal } from "../../components/AgentOnboardingModal";

function computeStats(agents: Agent[] | undefined, telemetryCount: number) {
  const active = agents?.filter((agent) => agent.status === "active").length ?? 0;
  const paused = (agents?.length ?? 0) - active;
  return { active, paused, total: agents?.length ?? 0, telemetryCount };
}

export function Overview() {
  const identity = useIdentity();
  const { toast } = useToast();
  const agents = useAgents(Boolean(identity.authenticated));
  const wallets = useOrganizationWallets(Boolean(identity.authenticated));
  const subscription = useSubscription(Boolean(identity.authenticated));
  const telemetry = useTelemetryEvents(Boolean(identity.authenticated));

  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [emergencyAddress, setEmergencyAddress] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(false);

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
      .map(([name, value]) => ({ label: eventLabel(name), value }));
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
    const target = emergencyAddress.trim();
    try {
      await tripKillSwitch.mutateAsync({
        agentAddress: target,
        active: true,
      });
      toast({
        title: "Agent paused",
        message: `Agent ${truncateMiddle(target, 8, 4)} is paused and can't spend.`,
        tone: "critical",
        onUndo: async () => {
          await tripKillSwitch.mutateAsync({ agentAddress: target, active: false });
          void agents.refetch();
          toast({
            title: "Agent resumed",
            message: `Spending authority restored for ${truncateMiddle(target, 8, 4)}.`,
            tone: "success",
          });
        },
      });
      setEmergencyAddress("");
      void agents.refetch();
    } catch (err) {
      toast({
        title: "Couldn't pause agent",
        message: toUserFacingError(err, "Try again in a moment."),
        tone: "critical",
      });
    }
  };

  const operatorLabel = identity.subject?.split(":").at(-1)?.slice(0, 8) ?? "operator";
  const subscriptionStatus = hasSubscription
    ? String((subscription.data as Subscription).subscription?.status ?? "recorded")
    : "not configured";
  const readinessSteps = [
    {
      label: "Add a treasury wallet",
      detail: "This is the wallet you use to fund your agents.",
      done: (wallets.data?.length ?? 0) > 0,
      to: "/app/treasury" as const,
    },
    {
      label: "Create your first agent",
      detail: "Give it a wallet and a spending limit.",
      done: total > 0,
      to: "/app/fleet" as const,
    },
    {
      label: "See your first activity",
      detail: "Try a test payment, or wait for an agent's first one.",
      done: (telemetry.data?.length ?? 0) > 0,
      to: "/app/simulator" as const,
    },
  ];
  const showReadiness = readinessSteps.some((step) => !step.done);

  return (
    <div className="dashboard-stack">
      {/* Top Header */}
      <header className="dashboard-header">
        <div>
          <h1>Home</h1>
          <p>Your agents, spending, and recent activity.</p>
        </div>
        <div className="dashboard-actions">
          <Button
            variant="tonal"
            onClick={() => {
              void agents.refetch();
              void wallets.refetch();
              void telemetry.refetch();
              toast({
                title: "Synchronized",
                message: "Everything is up to date.",
                tone: "info",
              });
            }}
            title="Refresh"
          >
            <RefreshCw size={14} className={agents.isFetching || telemetry.isFetching ? "spin" : ""} />
            <span>Refresh</span>
          </Button>
          <Button onClick={() => setOnboardingOpen(true)}>
            <Bot size={15} />
            <span>Provision Agent</span>
          </Button>
        </div>
      </header>

      {/* Stat Tiles Row with Interactive Navigation */}
      <div className="stat-row">
        <Link to="/app/fleet" style={{ textDecoration: "none", color: "inherit", display: "block" }} title="View all agents in Fleet">
          <StatTile label="Fleet size" value={String(total)} icon={<Bot size={18} />} accent={0} />
        </Link>
        <Link to="/app/fleet" style={{ textDecoration: "none", color: "inherit", display: "block" }} title="View Active agents in Fleet">
          <StatTile label="Active" value={String(active)} icon={<Activity size={18} />} accent={2} />
        </Link>
        <Link to="/app/fleet" style={{ textDecoration: "none", color: "inherit", display: "block" }} title="View Paused agents in Fleet">
          <StatTile label="Paused" value={String(paused)} icon={<PauseCircle size={18} />} accent={1} />
        </Link>
        <Link to="/app/activity" style={{ textDecoration: "none", color: "inherit", display: "block" }} title="View activity">
          <StatTile label="Activity events" value={String(telemetry.data?.length ?? 0)} icon={<Radio size={18} />} accent={5} />
        </Link>
      </div>

      {showReadiness && (
        <section className="setup-card" aria-label="Get started">
          <div className="setup-card-head">
            <div>
              <h2>Get started</h2>
              <p>
                {readinessSteps.filter((s) => s.done).length} of {readinessSteps.length} steps done
              </p>
            </div>
            <div
              className="setup-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={readinessSteps.length}
              aria-valuenow={readinessSteps.filter((s) => s.done).length}
            >
              <span style={{ width: `${(readinessSteps.filter((s) => s.done).length / readinessSteps.length) * 100}%` }} />
            </div>
          </div>
          <ol className="setup-steps">
            {readinessSteps.map((step, idx) => (
              <li key={step.label} className={`setup-step ${step.done ? "is-done" : ""}`}>
                <span className="setup-step-marker">{step.done ? <Check size={13} strokeWidth={3} /> : idx + 1}</span>
                <div className="setup-step-body">
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </div>
                {!step.done && (
                  <Link to={step.to} className="control control-tonal setup-step-cta">
                    <span>Start</span>
                    <ArrowRight size={13} />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Main Analytics Grid */}
      <div className="dashboard-grid">
        <Surface className="dashboard-card dashboard-card-wide">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Activity</span>
              <h2>Activity</h2>
            </div>
          </div>
          <TrendArea
            data={dailyVolume}
            seriesName="Events"
            emptyTitle="No activity yet"
            emptyDetail="Payments and rule checks appear here as they happen."
            valueFormatter={(value) => String(Math.round(value))}
          />
        </Surface>

        <Surface className="dashboard-card dashboard-card-medium">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Fleet</span>
              <h2>Active ratio</h2>
            </div>
          </div>
          <Gauge
            label="Active agents"
            value={total ? (active / total) * 100 : 0}
            detail={`${active} of ${total} active`}
          />
        </Surface>

        <Surface className="dashboard-card dashboard-card-medium">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Events</span>
              <h2>Event mix</h2>
            </div>
          </div>
          <Breakdown
            data={eventBreakdown}
            emptyTitle="No events yet"
            emptyDetail="Event types appear once there is activity."
          />
        </Surface>
      </div>

      {/* Active Fleet Table with Inline Emergency Freeze */}
      <Surface className="saas-table-card">
        <div className="table-card-head">
          <div className="table-card-title">
            <h3>Your agents</h3>
            <small>{filteredAgents.length} agents</small>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div className="table-search-input">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search agents, tiers..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
              />
            </div>
            <div className="circuit-quick-box">
              <input
                type="text"
                className="circuit-input-inline"
                placeholder="Agent address to pause"
                value={emergencyAddress}
                onChange={(e) => setEmergencyAddress(e.target.value)}
              />
              <Button
                variant="tonal"
                onClick={handleTripEmergency}
                disabled={!emergencyAddress.trim()}
                style={{ fontSize: "0.76rem", padding: "6px 12px", height: "32px" }}
              >
                <AlertOctagon size={13} style={{ marginRight: 4 }} />
                <span>Pause</span>
              </Button>
            </div>
          </div>
        </div>

        {filteredAgents.length ? (
          <div className="dense-table-wrapper">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Wallet</th>
                  <th>Risk level</th>
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
                        {agent.walletSource === "sovereign" ? "Secure wallet" : "Connected"}
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
            <p>Register your first agent to activate spend control.</p>
          </div>
        )}
      </Surface>

      {/* Slide-Over Agent Inspector Drawer */}
      {selectedAgent && (
        <AgentInspector
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onTripCircuit={async (addr, trip) => {
            try {
              await tripKillSwitch.mutateAsync({ agentAddress: addr, active: trip });
              toast({
                title: trip ? "Agent paused" : "Agent resumed",
                message: `Agent ${truncateMiddle(addr, 8, 4)} is ${trip ? "paused" : "active again"}.`,
                tone: trip ? "critical" : "success",
              });
              void agents.refetch();
            } catch (err) {
              toast({
                title: "Couldn't update agent",
                message: toUserFacingError(err, "Try again in a moment."),
                tone: "critical",
              });
            }
          }}
        />
      )}

      <AgentOnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onSuccess={() => void agents.refetch()}
      />
    </div>
  );
}
