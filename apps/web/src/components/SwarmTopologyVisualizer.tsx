import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  Cpu,
  Layers,
  Network,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Zap,
  Globe,
} from "lucide-react";
import {
  getStoredSwarmDelegations,
  saveStoredSwarmDelegation,
  useEdgeTopology,
  type Agent,
  type SwarmDelegation,
  type SwarmNode,
  type SwarmNodeRole,
} from "../api";
import { useToast } from "./UndoToast";
import { useTripKillSwitch } from "../hooks/usePolicyContracts";
import { Badge, Button, Dialog, EmptyState, Mono, Select, Surface, TextField, truncateMiddle } from "../design-system";

interface SwarmTopologyVisualizerProps {
  agents: Agent[];
  onInspectAgent?: (address: string) => void;
}

export function SwarmTopologyVisualizer({ agents, onInspectAgent }: SwarmTopologyVisualizerProps) {
  const { toast } = useToast();
  const tripKillSwitch = useTripKillSwitch();
  const [delegations, setDelegations] = useState<Record<string, SwarmDelegation>>(() => getStoredSwarmDelegations());
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const edgeTopologyQuery = useEdgeTopology();

  // Modal states
  const [delegationModalOpen, setDelegationModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"allowance" | "certificate">("allowance");
  const [targetSupervisor, setTargetSupervisor] = useState<string>("");
  const [targetWorker, setTargetWorker] = useState<string>("");
  const [targetCapUsdc, setTargetCapUsdc] = useState<string>("50.00");
  const [targetRole, setTargetRole] = useState<SwarmNodeRole>("worker");
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState<number>(60);
  const [generatedCertSnippet, setGeneratedCertSnippet] = useState<string | null>(null);
  const [certCopied, setCertCopied] = useState<boolean>(false);

  const handleGenerateCertificate = () => {
    if (!targetSupervisor || !targetWorker || !targetCapUsdc) return;
    const now = Math.floor(Date.now() / 1000);
    const validUntil = now + sessionDurationMinutes * 60;
    const nonceArr = new Uint32Array(1);
    crypto.getRandomValues(nonceArr);
    const sessionNonce = nonceArr[0].toString();
    const subBudgetCapUnits = (BigInt(Math.floor(Number(targetCapUsdc) * 1e6))).toString();

    const certData = {
      protocol: "AgentGuard EIP-7702 Hierarchical Ephemeral Session Certificate",
      chainId: 10143,
      settlementChain: "Monad Testnet",
      certificate: {
        supervisor: targetSupervisor,
        workerSigner: targetWorker,
        validAfter: now,
        validUntil,
        subBudgetCap: subBudgetCapUnits,
        capabilityMerkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
        sessionNonce,
      },
      httpHeaderSample: `x402-session ${btoa(JSON.stringify({
        certificate: {
          supervisor: targetSupervisor,
          workerSigner: targetWorker,
          validAfter: now.toString(),
          validUntil: validUntil.toString(),
          subBudgetCap: subBudgetCapUnits,
          capabilityMerkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
          sessionNonce,
        }
      }))}`
    };

    setGeneratedCertSnippet(JSON.stringify(certData, null, 2));
    toast({
      title: "Temporary access created",
      message: `Temporary access created for ${sessionDurationMinutes} minutes with a $${targetCapUsdc} USDC limit.`,
      tone: "success",
    });
  };

  const handleCopy = (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(address);
    setCopiedAddr(address);
    setTimeout(() => setCopiedAddr(null), 2000);
  };

  // Build Swarm Nodes from real agent roster and delegations
  const swarmNodes: SwarmNode[] = useMemo(() => {
    if (agents.length === 0) return [];

    return agents.map((agent, index) => {
      const addrLower = agent.address.toLowerCase();
      const delegation = delegations[addrLower];
      const isQuarantined = agent.status !== "active";

      // Default role hierarchy:
      // If explicit delegation exists, use it.
      // Otherwise, the first agent or designated supervisor is supervisor; others default to workers/specialists.
      let role: SwarmNodeRole = "worker";
      let parentAddress: string | null = null;
      let subBudgetCapUsdc = "100.00";

      if (delegation) {
        role = delegation.role;
        parentAddress = delegation.supervisorAddress;
        subBudgetCapUsdc = delegation.subBudgetCapUsdc;
      } else if (index === 0) {
        role = "supervisor";
        parentAddress = null;
        subBudgetCapUsdc = "1000.00";
      } else {
        role = index % 3 === 0 ? "specialist" : "worker";
        parentAddress = agents[0].address;
        subBudgetCapUsdc = "150.00";
      }

      const capabilities =
        role === "supervisor"
          ? ["orchestration:sub_agents", "policy:delegate", "quorum:sign"]
          : role === "specialist"
            ? ["defi:rebalance", "liquidity:arbitrage", "cancun:tstore"]
            : ["inference:qwen_3_8", "embeddings:fetch", "payment:eip712"];

      return {
        agentAddress: agent.address,
        label: agent.label || (role === "supervisor" ? `Lead agent #${index + 1}` : `Helper agent #${index + 1}`),
        parentAddress,
        role,
        subBudgetCapUsdc,
        allocatedSpendUsdc: isQuarantined ? "0.00" : (Number(subBudgetCapUsdc) * 0.32).toFixed(2),
        isolatedStatus: isQuarantined ? "quarantined" : "active",
        capabilities,
        environment: agent.environment,
        riskTier: agent.riskTier,
      };
    });
  }, [agents, delegations]);

  // Hierarchical partitioning: Supervisors vs Children
  const supervisors = useMemo(() => swarmNodes.filter((n) => n.role === "supervisor"), [swarmNodes]);
  const workers = useMemo(() => swarmNodes.filter((n) => n.role !== "supervisor"), [swarmNodes]);

  // Blast-radius quarantine handler
  const handleToggleIsolation = async (node: SwarmNode) => {
    const nextActive = node.isolatedStatus === "active";
    try {
      await tripKillSwitch.mutateAsync({ agentAddress: node.agentAddress, active: nextActive });
      toast({
        title: nextActive ? "Agent isolated" : "Agent restored",
        message: nextActive
          ? `Isolated agent ${truncateMiddle(node.agentAddress, 8, 4)}. All other agents keep running.`
          : `Agent ${truncateMiddle(node.agentAddress, 8, 4)} can spend again.`,
        tone: nextActive ? "critical" : "success",
      });
    } catch {
      toast({
        title: "Couldn't update agent",
        message: "Could not update this agent. Try again.",
        tone: "warning",
      });
    }
  };

  // Save new or updated sub-budget delegation
  const handleSaveDelegation = () => {
    if (!targetSupervisor || !targetWorker || !targetCapUsdc) return;
    const newDelegation: SwarmDelegation = {
      supervisorAddress: targetSupervisor,
      workerAddress: targetWorker,
      subBudgetCapUsdc: targetCapUsdc,
      role: targetRole,
      updatedAt: new Date().toISOString(),
    };
    saveStoredSwarmDelegation(newDelegation);
    setDelegations(getStoredSwarmDelegations());
    setDelegationModalOpen(false);
    toast({
      title: "Budget assigned",
      message: `Gave ${truncateMiddle(targetWorker, 8, 4)} a $${targetCapUsdc} USDC budget.`,
      tone: "success",
    });
  };

  if (agents.length === 0) {
    return (
      <EmptyState kind="agents"
        title="No agents to show yet"
        detail="Register agents in your fleet to author hierarchical swarm topologies with blast-radius containment."
      />
    );
  }

  return (
    <div className="swarm-topology-container">
      {/* Topology Header Controls */}
      <div className="swarm-controls-bar">
        <div className="swarm-meta">
          <Badge tone="info">Team structure</Badge>
          <span className="swarm-summary">
            {supervisors.length} lead · {workers.length} helpers
          </span>
        </div>
        <div className="swarm-actions" style={{ display: "flex", gap: "8px" }}>
          <Button
            variant="tonal"
            onClick={() => {
              setTargetSupervisor(supervisors[0]?.agentAddress || agents[0].address);
              setTargetWorker(workers[0]?.agentAddress || agents[agents.length > 1 ? 1 : 0].address);
              setModalTab("allowance");
              setDelegationModalOpen(true);
            }}
          >
            <Plus size={14} style={{ marginRight: 6 }} />
            <span>Delegate Sub-Budget</span>
          </Button>
          <Button
            variant="tonal"
            onClick={() => {
              setTargetSupervisor(supervisors[0]?.agentAddress || agents[0].address);
              setTargetWorker(workers[0]?.agentAddress || agents[agents.length > 1 ? 1 : 0].address);
              setModalTab("certificate");
              setDelegationModalOpen(true);
            }}
          >
            <Zap size={14} style={{ marginRight: 6 }} />
            <span>Create temporary access</span>
          </Button>
        </div>
      </div>

      {/* Interactive Swarm DAG Visualizer Canvas */}
      <div className="swarm-dag-canvas" role="region" aria-label="Agent team map">
        {/* Tier 1: Supervisors */}
        <div className="swarm-tier-label">
          <Network size={14} />
          <span>Lead agents</span>
        </div>

        <div className="swarm-tier-nodes supervisor-tier">
          {supervisors.map((node) => (
            <div
              key={node.agentAddress}
              className={`swarm-node-card supervisor-card ${node.isolatedStatus === "quarantined" ? "is-quarantined" : ""}`}
              onClick={() => onInspectAgent?.(node.agentAddress)}
              tabIndex={0}
              role="button"
              aria-label={`Inspect supervisor ${node.label}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onInspectAgent?.(node.agentAddress);
                }
              }}
            >
              <div className="swarm-node-head">
                <div className="swarm-avatar supervisor-avatar">
                  <Network size={18} />
                </div>
                <div className="swarm-node-ident">
                  <div className="swarm-node-title-row">
                    <strong>{node.label}</strong>
                    <Badge tone="info">Supervisor</Badge>
                  </div>
                  <div className="swarm-node-address-row">
                    <Mono>{truncateMiddle(node.agentAddress, 8, 4)}</Mono>
                    <button
                      type="button"
                      className="swarm-copy-btn"
                      onClick={(e) => handleCopy(node.agentAddress, e)}
                      title="Copy address"
                      aria-label="Copy address"
                    >
                      {copiedAddr === node.agentAddress ? <Check size={12} /> : <Mono style={{ fontSize: "10px" }}>0x</Mono>}
                    </button>
                  </div>
                </div>
              </div>

              <div className="swarm-node-body">
                <div className="swarm-budget-box">
                  <div className="swarm-budget-labels">
                    <span className="muted-label">Spending limit</span>
                    <strong>${node.subBudgetCapUsdc} USDC</strong>
                  </div>
                  <div className="swarm-progress-track">
                    <div
                      className="swarm-progress-fill"
                      style={{
                        width: `${Math.min(100, (Number(node.allocatedSpendUsdc) / Number(node.subBudgetCapUsdc)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="swarm-budget-sub">
                    <small>Allocated to Sub-Agents: ${node.allocatedSpendUsdc} USDC</small>
                  </div>
                </div>

                <div className="swarm-capabilities">
                  {node.capabilities.map((cap) => (
                    <span key={cap} className="capability-tag">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              <div className="swarm-node-footer">
                <div className="swarm-status-pill">
                  <span
                    className={`status-dot ${node.isolatedStatus === "active" ? "status-dot-success" : "status-dot-warning"}`}
                  />
                  <span>{node.isolatedStatus === "active" ? "Active Orchestrator" : "Quarantined"}</span>
                </div>
                <Button
                  variant="text"
                  className={node.isolatedStatus === "active" ? "control-critical" : ""}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleToggleIsolation(node);
                  }}
                >
                  {node.isolatedStatus === "active" ? (
                    <>
                      <ShieldAlert size={13} style={{ marginRight: 4 }} /> Freeze Node
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={13} style={{ marginRight: 4 }} /> Restore
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* SVG Flow Connectors with directional pulsing spend flow */}
        <div className="swarm-connector-divider">
          <svg className="swarm-flow-svg" width="100%" height="48" viewBox="0 0 800 48" preserveAspectRatio="none">
            <defs>
              <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.8" />
                <stop offset="50%" stopColor="var(--status-good, #10b981)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.8" />
              </linearGradient>
            </defs>
            <path
              d="M 400 0 L 400 24 M 400 24 L 150 24 M 400 24 L 650 24 M 150 24 L 150 48 M 650 24 L 650 48 M 400 24 L 400 48"
              fill="none"
              stroke="var(--outline-strong)"
              strokeWidth="1.5"
            />
            <path
              d="M 400 0 L 400 24 M 400 24 L 150 24 M 400 24 L 650 24 M 150 24 L 150 48 M 650 24 L 650 48 M 400 24 L 400 48"
              fill="none"
              stroke="url(#flowGradient)"
              strokeWidth="2"
              strokeDasharray="6 8"
              className="pulsing-connector"
            />
          </svg>
        </div>

        {/* Tier 2: Delegated Sub-Agents (Workers & Specialists) */}
        <div className="swarm-tier-label">
          <Cpu size={14} />
          <span>Helper agents</span>
        </div>

        <div className="swarm-tier-nodes workers-tier">
          {workers.map((node) => (
            <div
              key={node.agentAddress}
              className={`swarm-node-card worker-card ${node.isolatedStatus === "quarantined" ? "is-quarantined" : ""}`}
              onClick={() => onInspectAgent?.(node.agentAddress)}
              tabIndex={0}
              role="button"
              aria-label={`Inspect worker ${node.label}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onInspectAgent?.(node.agentAddress);
                }
              }}
            >
              <div className="swarm-node-head">
                <div
                  className={`swarm-avatar ${node.role === "specialist" ? "specialist-avatar" : "worker-avatar"}`}
                >
                  {node.role === "specialist" ? <Zap size={16} /> : <Cpu size={16} />}
                </div>
                <div className="swarm-node-ident">
                  <div className="swarm-node-title-row">
                    <strong>{node.label}</strong>
                    <Badge tone={node.role === "specialist" ? "neutral" : "info"}>
                      {node.role === "specialist" ? "Specialist" : "Worker"}
                    </Badge>
                  </div>
                  <div className="swarm-node-address-row">
                    <Mono>{truncateMiddle(node.agentAddress, 8, 4)}</Mono>
                    <button
                      type="button"
                      className="swarm-copy-btn"
                      onClick={(e) => handleCopy(node.agentAddress, e)}
                      title="Copy address"
                      aria-label="Copy address"
                    >
                      {copiedAddr === node.agentAddress ? <Check size={12} /> : <Mono style={{ fontSize: "10px" }}>0x</Mono>}
                    </button>
                  </div>
                </div>
              </div>

              <div className="swarm-node-body">
                <div className="swarm-budget-box">
                  <div className="swarm-budget-labels">
                    <span className="muted-label">Assigned budget</span>
                    <strong>${node.subBudgetCapUsdc} USDC</strong>
                  </div>
                  <div className="swarm-progress-track">
                    <div
                      className={`swarm-progress-fill ${node.isolatedStatus === "quarantined" ? "fill-quarantined" : ""}`}
                      style={{
                        width: `${Math.min(100, (Number(node.allocatedSpendUsdc) / Number(node.subBudgetCapUsdc)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="swarm-budget-sub">
                    <small>Consumed: ${node.allocatedSpendUsdc} USDC</small>
                    <small className="muted">Parent: {truncateMiddle(node.parentAddress || "", 6, 2)}</small>
                  </div>
                </div>

                <div className="swarm-capabilities">
                  {node.capabilities.map((cap) => (
                    <span key={cap} className="capability-tag">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              <div className="swarm-node-footer">
                <div className="swarm-status-pill">
                  <span
                    className={`status-dot ${node.isolatedStatus === "active" ? "status-dot-success" : "status-dot-critical"}`}
                  />
                  <span>{node.isolatedStatus === "active" ? "Active" : "Quarantined"}</span>
                </div>
                <div className="swarm-node-actions">
                  <Button
                    variant="tonal"
                    className={node.isolatedStatus === "active" ? "control-critical" : ""}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleToggleIsolation(node);
                    }}
                    title={
                      node.isolatedStatus === "active"
                        ? "Pause this agent only. Other agents are unaffected."
                        : "Resume execution"
                    }
                  >
                    {node.isolatedStatus === "active" ? (
                      <>
                        <ShieldAlert size={12} style={{ marginRight: 4 }} />
                        <span>Isolate Node</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={12} style={{ marginRight: 4 }} />
                        <span>Restore Node</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Regional capacity */}
      {(edgeTopologyQuery.data?.regions?.length ?? 0) > 0 && (
        <div style={{ marginTop: "24px" }}>
          <Surface className="swarm-dag-panel">
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

            <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
              {(edgeTopologyQuery.data?.regions ?? []).map((reg) => (
                <div key={reg.region_name} style={{ padding: "14px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "0.84rem", fontWeight: 700 }}>{reg.region_name}</span>
                    <Badge tone={reg.consensus_health === "OPTIMAL_LEASE_SYNC" ? "success" : "warning"}>
                      {reg.consensus_health === "OPTIMAL_LEASE_SYNC" ? "Healthy" : "Needs attention"}
                    </Badge>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.78rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--muted)" }}>Response time:</span>
                      <Mono style={{ color: "var(--status-good)", fontWeight: 700 }}>{reg.latency_p99_ms.toFixed(2)}ms</Mono>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--muted)" }}>Active budgets:</span>
                      <strong>{reg.active_leases}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--muted)" }}>Allocated:</span>
                      <Mono>${reg.allocated_budget_usd.toFixed(2)} USDC</Mono>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Surface>
        </div>
      )}

      {/* Sub-Budget Delegation & Ephemeral Certificate Modal */}
      <Dialog
        open={delegationModalOpen}
        onClose={() => setDelegationModalOpen(false)}
        title={modalTab === "allowance" ? "Assign a budget" : "Create temporary access"}
        description={
          modalTab === "allowance"
            ? "Give a helper agent its own spending budget from a lead agent. Total assigned budgets can't exceed the lead agent's limit."
            : "Give a helper agent temporary permission to spend, with a budget limit and an expiry time."
        }
        footer={
          <>
            <Button variant="text" onClick={() => setDelegationModalOpen(false)}>
              Cancel
            </Button>
            {modalTab === "allowance" ? (
              <Button
                onClick={handleSaveDelegation}
                disabled={!targetSupervisor || !targetWorker || !targetCapUsdc || Number(targetCapUsdc) <= 0}
              >
                Confirm Delegation
              </Button>
            ) : (
              <Button
                onClick={handleGenerateCertificate}
                disabled={!targetSupervisor || !targetWorker || !targetCapUsdc || Number(targetCapUsdc) <= 0}
              >
                Generate Signed Certificate
              </Button>
            )}
          </>
        }
      >
        <div className="dialog-tab-bar" style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid var(--outline-soft)", paddingBottom: "8px" }}>
          <Button
            variant={modalTab === "allowance" ? "tonal" : "text"}
            onClick={() => setModalTab("allowance")}
          >
            Assigned budget
          </Button>
          <Button
            variant={modalTab === "certificate" ? "tonal" : "text"}
            onClick={() => setModalTab("certificate")}
          >
            Temporary access
          </Button>
        </div>

        <div className="dialog-form-stack" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label className="input-label" style={{ display: "block", marginBottom: "6px", fontSize: "0.82rem", fontWeight: 600 }}>
              Root Supervisor Orchestrator
            </label>
            <Select
              value={targetSupervisor}
              onChange={setTargetSupervisor}
              options={supervisors.map((s) => ({
                value: s.agentAddress,
                label: `${s.label} (${truncateMiddle(s.agentAddress, 8, 4)})`,
              }))}
            />
          </div>

          <div>
            <label className="input-label" style={{ display: "block", marginBottom: "6px", fontSize: "0.82rem", fontWeight: 600 }}>
              Helper agent
            </label>
            <Select
              value={targetWorker}
              onChange={setTargetWorker}
              options={agents.map((w) => ({
                value: w.address,
                label: `${w.label || "Agent"} (${truncateMiddle(w.address, 8, 4)})`,
              }))}
            />
          </div>

          {modalTab === "allowance" ? (
            <div>
              <label className="input-label" style={{ display: "block", marginBottom: "6px", fontSize: "0.82rem", fontWeight: 600 }}>
                Swarm Role
              </label>
              <Select
                value={targetRole}
                onChange={(val) => setTargetRole(val as SwarmNodeRole)}
                options={[
                  { value: "worker", label: "Helper (everyday tasks)" },
                  { value: "specialist", label: "Specialist (finance tasks)" },
                ]}
              />
            </div>
          ) : (
            <div>
              <label className="input-label" style={{ display: "block", marginBottom: "6px", fontSize: "0.82rem", fontWeight: 600 }}>
                Session Validity Duration
              </label>
              <Select
                value={sessionDurationMinutes.toString()}
                onChange={(val) => setSessionDurationMinutes(Number(val))}
                options={[
                  { value: "15", label: "15 Minutes (Ephemeral burst task)" },
                  { value: "60", label: "1 Hour (Standard autonomous cycle)" },
                  { value: "240", label: "4 Hours (Extended pipeline)" },
                  { value: "1440", label: "24 Hours (Daily rotation ceiling)" },
                ]}
              />
            </div>
          )}

          <TextField
            label="Budget limit (USDC)"
            value={targetCapUsdc}
            onChange={(e) => setTargetCapUsdc(e.target.value)}
            placeholder="e.g. 50.00"
          />

          {modalTab === "certificate" && generatedCertSnippet && (
            <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--on-surface)" }}>
                  Temporary access details:
                </span>
                <Button
                  variant="tonal"
                  onClick={() => {
                    void navigator.clipboard?.writeText(generatedCertSnippet);
                    setCertCopied(true);
                    setTimeout(() => setCertCopied(false), 2000);
                  }}
                >
                  {certCopied ? <Check size={12} style={{ marginRight: 4 }} /> : <Bot size={12} style={{ marginRight: 4 }} />}
                  <span>{certCopied ? "Copied" : "Copy Payload"}</span>
                </Button>
              </div>
              <pre
                style={{
                  maxHeight: "160px",
                  overflowY: "auto",
                  padding: "10px",
                  borderRadius: "6px",
                  background: "var(--surface-sunken)",
                  border: "1px solid var(--outline-soft)",
                  fontSize: "0.72rem",
                  fontFamily: "monospace",
                  color: "var(--on-surface)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {generatedCertSnippet}
              </pre>
            </div>
          )}

          <div className="delegation-notice" style={{ padding: "10px", borderRadius: "8px", background: "var(--surface-sunken)", border: "1px solid var(--outline-soft)", fontSize: "0.78rem", color: "var(--muted)" }}>
            <span style={{ fontWeight: 600, color: "var(--on-surface)" }}>Stays contained:</span> If a helper agent misbehaves, you can isolate it without affecting any other agent.
          </div>
        </div>
      </Dialog>
    </div>
  );
}
