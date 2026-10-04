import { useState } from "react";
import { Check, Cpu, Globe, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useEdgeTopology, type Agent } from "../api";
import { useToast } from "./UndoToast";
import { useTripKillSwitch } from "../hooks/usePolicyContracts";
import { Badge, Button, EmptyState, Mono, Surface, formatRiskTier, truncateMiddle } from "../design-system";
import { formatDate, formatFixed, formatUsd } from "../format";

interface AgentStatusGridProps {
  agents: Agent[];
  onInspectAgent?: (address: string) => void;
  onProvisionAgent?: () => void;
}

/**
 * Card view of the registered agents. Every figure comes from the agent roster
 * or the gateway's regional capacity endpoint. The gateway does not serve
 * lead/helper relationships, assigned budgets or capability lists, so
 * none of those are shown.
 */
export function AgentStatusGrid({ agents, onInspectAgent, onProvisionAgent }: AgentStatusGridProps) {
  const { toast } = useToast();
  const tripKillSwitch = useTripKillSwitch();
  const edgeTopologyQuery = useEdgeTopology();
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const handleCopy = (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(address);
    setCopiedAddr(address);
    setTimeout(() => setCopiedAddr(null), 2000);
  };

  const handleToggleIsolation = async (agent: Agent) => {
    const isolate = agent.status === "active";
    try {
      await tripKillSwitch.mutateAsync({ agentAddress: agent.address, active: isolate });
      toast({
        title: isolate ? "Agent isolated" : "Agent restored",
        message: isolate
          ? `Isolated agent ${truncateMiddle(agent.address, 8, 4)}. All other agents keep running.`
          : `Agent ${truncateMiddle(agent.address, 8, 4)} can spend again.`,
        tone: isolate ? "critical" : "success",
      });
    } catch {
      toast({
        title: "Couldn't update agent",
        message: "Could not update this agent. Try again.",
        tone: "warning",
      });
    }
  };

  if (agents.length === 0) {
    return (
      <EmptyState
        kind="agents"
        title="No agents to show yet"
        detail="Register an agent and it will appear here with its status and a one-click pause."
        action={
          onProvisionAgent ? (
            <Button onClick={onProvisionAgent}>
              <Sparkles size={14} />
              <span>Provision First Agent</span>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const regions = edgeTopologyQuery.data?.regions ?? [];

  return (
    <div className="agent-card-grid-container">
      <div className="agent-card-grid" role="region" aria-label="Agent cards">
        {agents.map((agent, index) => {
          const isolated = agent.status !== "active";
          return (
            <div
              key={agent.address}
              className={`agent-card ${isolated ? "is-isolated" : ""}`}
              onClick={() => onInspectAgent?.(agent.address)}
              tabIndex={0}
              role="button"
              aria-label={`Inspect ${agent.label || `agent ${index + 1}`}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onInspectAgent?.(agent.address);
                }
              }}
            >
              <div className="agent-card-head">
                <div className="agent-card-avatar">
                  <Cpu size={16} />
                </div>
                <div className="agent-card-ident">
                  <div className="agent-card-title-row">
                    <strong>{agent.label || `Agent ${index + 1}`}</strong>
                    <Badge tone={isolated ? "critical" : "success"}>{isolated ? "Isolated" : "Active"}</Badge>
                  </div>
                  <div className="agent-card-address-row">
                    <Mono>{truncateMiddle(agent.address, 8, 4)}</Mono>
                    <button
                      type="button"
                      className="agent-card-copy"
                      onClick={(e) => handleCopy(agent.address, e)}
                      title="Copy address"
                      aria-label="Copy address"
                    >
                      {copiedAddr === agent.address ? <Check size={12} /> : <Mono style={{ fontSize: "10px" }}>0x</Mono>}
                    </button>
                  </div>
                </div>
              </div>

              <dl className="agent-card-facts">
                <div>
                  <dt>Environment</dt>
                  <dd>{agent.environment}</dd>
                </div>
                <div>
                  <dt>Risk level</dt>
                  <dd>{formatRiskTier(agent.riskTier)}</dd>
                </div>
                <div>
                  <dt>Registered</dt>
                  <dd>{formatDate(agent.createdAt)}</dd>
                </div>
              </dl>

              <div className="agent-card-footer">
                <Button
                  variant="tonal"
                  className={isolated ? "" : "control-critical"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleToggleIsolation(agent);
                  }}
                  title={isolated ? "Let this agent spend again" : "Pause this agent only. Other agents are unaffected."}
                >
                  {isolated ? (
                    <>
                      <ShieldCheck size={12} style={{ marginRight: 4 }} />
                      <span>Restore agent</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={12} style={{ marginRight: 4 }} />
                      <span>Isolate agent</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {regions.length > 0 && (
        <Surface className="agent-regions-panel">
          <div className="section-heading">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Globe size={18} className="text-accent-blue" />
              <h2>Regions</h2>
              <Badge tone="success">{edgeTopologyQuery.data?.global_active_edges ?? 0} active</Badge>
            </div>
            <p style={{ marginTop: "4px", fontSize: "0.84rem", color: "var(--color-on-surface-variant)" }}>
              How your agents' budgets are spread across regions.
            </p>
          </div>

          <div className="agent-regions-grid">
            {regions.map((reg) => (
              <div key={reg.region_name} className="agent-region-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "0.84rem", fontWeight: 700 }}>{reg.region_name}</span>
                  <Badge tone={reg.consensus_health === "OPTIMAL_LEASE_SYNC" ? "success" : "warning"}>
                    {reg.consensus_health === "OPTIMAL_LEASE_SYNC" ? "Healthy" : "Needs attention"}
                  </Badge>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.78rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>Response time:</span>
                    <Mono style={{ color: "var(--status-good)", fontWeight: 700 }}>{formatFixed(reg.latency_p99_ms, 2)}ms</Mono>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>Active budgets:</span>
                    <strong>{reg.active_leases}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>Allocated:</span>
                    <Mono>{formatUsd(reg.allocated_budget_usd)} USDC</Mono>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}
    </div>
  );
}
