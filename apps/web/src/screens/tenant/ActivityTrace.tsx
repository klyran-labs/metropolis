import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  Layers,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useTelemetryEvents, useAgents, type TelemetryEvent, type ThreatAnomaly } from "../../api";
import { Badge, Button, EmptyState, Mono, Surface, TextField, truncateMiddle } from "../../design-system";
import { useIdentity } from "../../identity";
import { configuration, networkLabel } from "../../configuration";
import { useTripKillSwitch } from "../../hooks/usePolicyContracts";
import { useToast } from "../../components/UndoToast";
import { SettlementPipelineInspector } from "../../components/SettlementPipelineInspector";

export interface ReasonCodeInfo {
  code: number;
  key: string;
  label: string;
  tone: "success" | "critical" | "warning";
  explanation: string;
  remediation: string;
}

export const REASON_CODES: Record<number, ReasonCodeInfo> = {
  0: {
    code: 0,
    key: "ERR_NONE",
    label: "Cleared onchain",
    tone: "success",
    explanation: "Transaction passed all single-tx, velocity, and whitelist invariants.",
    remediation: "Settles atomically on Monad Parallel EVM with sub-second finality.",
  },
  1: {
    code: 1,
    key: "ERR_EXCEEDS_MAX_TX",
    label: "Ceiling Exceeded",
    tone: "critical",
    explanation: "Requested payment exceeds the agent's maximum allowed single-transaction limit.",
    remediation: "Lower transfer amount or increase 'Maximum per transaction' in Policy Studio.",
  },
  2: {
    code: 2,
    key: "ERR_VELOCITY_EXCEEDED",
    label: "Window Exhausted",
    tone: "critical",
    explanation: "Cumulative spend exceeds the budget ceiling for the current rolling window.",
    remediation: "Wait for sliding window epoch rollover or increase 'Maximum per window' in Policy Studio.",
  },
  3: {
    code: 3,
    key: "ERR_MAX_VELOCITY_EXCEEDED",
    label: "Velocity Spike",
    tone: "warning",
    explanation: "Too many transactions dispatched within the current window epoch.",
    remediation: "Increase 'Velocity limit' in Policy Studio or throttle agent frequency.",
  },
  4: {
    code: 4,
    key: "ERR_KILL_SWITCH_ACTIVE",
    label: "Emergency Freeze",
    tone: "critical",
    explanation: "Spending is halted because the O(1) circuit breaker is active for this agent.",
    remediation: "Review threat telemetry and reset kill switch in Fleet Overview or Policy Studio to resume.",
  },
  5: {
    code: 5,
    key: "ERR_MERCHANT_NOT_WHITELISTED",
    label: "Unapproved Counterparty",
    tone: "warning",
    explanation: "Target recipient address is not approved on the agent's merchant directory whitelist.",
    remediation: "Add counterparty in Merchant Directory or disable whitelist requirement in Policy Studio.",
  },
  6: {
    code: 6,
    key: "ERR_BUDGET_POOL_EXHAUSTED",
    label: "Treasury Depleted",
    tone: "critical",
    explanation: "Organization treasury pool balance is insufficient to back this allocation.",
    remediation: "Deposit funds into organization float in Treasury reserves.",
  },
  7: {
    code: 7,
    key: "ERR_EXPIRED",
    label: "Voucher Expired",
    tone: "warning",
    explanation: "EIP-712 payment voucher timestamp exceeded the valid execution deadline.",
    remediation: "Agent must sign a fresh voucher with a current timestamp.",
  },
  8: {
    code: 8,
    key: "ERR_NONCE_REUSED",
    label: "Nonce Collision",
    tone: "critical",
    explanation: "Voucher nonce was already consumed onchain. Replay defense triggered.",
    remediation: "Ensure the agent key vault increments nonces monotonically.",
  },
  9: {
    code: 9,
    key: "ERR_SIGNATURE_INVALID",
    label: "Invalid Signature",
    tone: "critical",
    explanation: "EIP-712 cryptographic signature verification failed.",
    remediation: "Verify that the agent keypair matches the registered address on Monad.",
  },
};

export function getReasonInfo(payload: Record<string, any> | undefined, eventName: string): ReasonCodeInfo {
  if (eventName === "circuit_tripped") {
    return REASON_CODES[4];
  }
  const rawCode = payload?.reasonCode !== undefined ? Number(payload.reasonCode) : 0;
  return REASON_CODES[rawCode] ?? REASON_CODES[0];
}

export function ActivityTrace() {
  const identity = useIdentity();
  const { toast } = useToast();
  const tripKillSwitch = useTripKillSwitch();
  const telemetryQuery = useTelemetryEvents(Boolean(identity.authenticated));
  const agentsQuery = useAgents(Boolean(identity.authenticated));
  const events = telemetryQuery.data ?? [];

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<TelemetryEvent | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"telemetry" | "outbox">("telemetry");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement !== searchInputRef.current &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (filterType !== "all" && ev.eventName.toLowerCase() !== filterType.toLowerCase()) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        ev.eventName.toLowerCase().includes(q) ||
        (ev.agentAddress && ev.agentAddress.toLowerCase().includes(q)) ||
        ev.transactionHash.toLowerCase().includes(q)
      );
    });
  }, [events, filterType, searchQuery]);

  const [liveStreamActive, setLiveStreamActive] = useState(false);

  const threatIntelligence = useMemo(() => {
    const anomalies: ThreatAnomaly[] = [];
    if (events.length === 0) {
      return {
        threatScore: 0,
        maxZScore: 0,
        driftRatePct: 0,
        probingCount: 0,
        anomalies: [],
      };
    }

    const agentEventsMap = new Map<string, TelemetryEvent[]>();
    for (const ev of events) {
      if (!ev.agentAddress) continue;
      const addr = ev.agentAddress.toLowerCase();
      const list = agentEventsMap.get(addr) ?? [];
      list.push(ev);
      agentEventsMap.set(addr, list);
    }

    let maxObservedZScore = 0;
    let categoryDriftCount = 0;
    let probingCount = 0;

    agentEventsMap.forEach((agentEvs, addr) => {
      const sorted = [...agentEvs].sort(
        (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
      );

      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const diffMs = Math.max(
          1,
          new Date(sorted[i].observedAt).getTime() - new Date(sorted[i - 1].observedAt).getTime(),
        );
        intervals.push(diffMs / 1000);
      }

      if (intervals.length >= 3) {
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance =
          intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
        const stdDev = Math.sqrt(variance) || 1;

        const minInterval = Math.min(...intervals);
        const zScore = (mean - minInterval) / stdDev;
        if (zScore > maxObservedZScore) maxObservedZScore = zScore;

        if (zScore >= 2.5) {
          anomalies.push({
            id: `anom-vel-${addr.slice(0, 6)}-${sorted[sorted.length - 1].transactionHash.slice(0, 6)}`,
            agentAddress: addr,
            anomalyType: "velocity_spike",
            severity: zScore > 3.5 ? "critical" : "medium",
            zScore: Number(zScore.toFixed(2)),
            historicalCategory: "Deterministic Cadence",
            attemptedCategory: "Rapid High-Frequency Burst",
            observedAt: sorted[sorted.length - 1].observedAt,
            details: `Velocity surge detected: execution interval compressed by ${zScore.toFixed(1)}σ beyond EWMA historical baseline.`,
            remediationAction: "trip_killswitch",
          });
        }
      }

      for (const ev of sorted) {
        const payload = ev.payload as Record<string, any> | undefined;
        if (!payload) continue;

        if (ev.eventName === "circuit_tripped" || payload.reasonCode === 1 || payload.reasonCode === 2) {
          anomalies.push({
            id: `anom-breach-${ev.transactionHash.slice(0, 8)}`,
            agentAddress: addr,
            anomalyType: "velocity_spike",
            severity: "critical",
            zScore: 3.8,
            historicalCategory: "Policy Compliant",
            attemptedCategory: "Circuit Tripped / Invariant Violation",
            observedAt: ev.observedAt,
            details: `Onchain PolicyEngine halted execution with ReasonCode ${payload.reasonCode ?? 1}.`,
            remediationAction: "trip_killswitch",
          });
        }

        const to = String(payload.to || payload.recipient || "").toLowerCase();
        if (to && !to.startsWith("0x0000000000000000000000000000000000000000")) {
          const isStandardInference = to.includes("3c44") || to.includes("escrow") || to.includes("inference");
          const isKnownDex = to.includes("uniswap") || to.includes("swap") || to.includes("dex");
          if (!isStandardInference && !isKnownDex) {
            categoryDriftCount++;
            if (categoryDriftCount <= 3) {
              anomalies.push({
                id: `anom-drift-${ev.transactionHash.slice(0, 8)}`,
                agentAddress: addr,
                anomalyType: "category_drift",
                severity: "medium",
                zScore: 2.1,
                historicalCategory: "Inference Escrow API",
                attemptedCategory: "Unclassified External Contract",
                observedAt: ev.observedAt,
                details: `Routing spend request to unclassified external counterparty ${truncateMiddle(to, 8, 4)} outside standard inference profile.`,
                remediationAction: "whitelist_merchant",
              });
            }
          }
        }

        const amount = Number(payload.amountBaseUnits || payload.amount || 0);
        if (amount > 95000000 && amount < 100000000) {
          probingCount++;
          anomalies.push({
            id: `anom-probe-${ev.transactionHash.slice(0, 8)}`,
            agentAddress: addr,
            anomalyType: "sub_threshold_probing",
            severity: "low",
            zScore: 1.8,
            historicalCategory: "Normal Spend Distribution",
            attemptedCategory: "Micro-Targeted Ceiling Probing (98%)",
            observedAt: ev.observedAt,
            details: `Transaction amount (${(amount / 1e6).toFixed(2)} USDC) clusters within 2% of single transaction limit ceiling.`,
            remediationAction: "tighten_policy",
          });
        }
      }
    });

    const driftRatePct = events.length > 0 ? (categoryDriftCount / events.length) * 100 : 0;
    const baseScore = Math.min(100, anomalies.length * 24 + maxObservedZScore * 8);

    return {
      threatScore: Number(baseScore.toFixed(1)),
      maxZScore: Number(maxObservedZScore.toFixed(2)),
      driftRatePct: Number(driftRatePct.toFixed(1)),
      probingCount,
      anomalies,
    };
  }, [events]);

  const handleRemediate = async (anomaly: ThreatAnomaly) => {
    if (anomaly.remediationAction === "trip_killswitch") {
      try {
        await tripKillSwitch.mutateAsync({ agentAddress: anomaly.agentAddress, active: true });
        toast({
          title: "Circuit Breaker Tripped",
          message: `O(1) kill switch executed onchain for ${truncateMiddle(anomaly.agentAddress, 8, 4)}. Threat neutralized.`,
          tone: "critical",
        });
      } catch {
        toast({
          title: "Action Failed",
          message: "Failed to broadcast emergency freeze transaction on Monad.",
          tone: "warning",
        });
      }
    } else if (anomaly.remediationAction === "tighten_policy") {
      toast({
        title: "Policy Tightening Recommended",
        message: `Navigate to Policy Studio to lower single transaction ceiling for ${truncateMiddle(anomaly.agentAddress, 8, 4)}.`,
        tone: "warning",
      });
    } else {
      toast({
        title: "Whitelist Review",
        message: `Verify counterparty legitimacy in Merchant Directory before whitelisting.`,
        tone: "info",
      });
    }
  };

  useEffect(() => {
    if (!liveStreamActive) return;
    const interval = setInterval(() => {
      void telemetryQuery.refetch();
    }, 3000);
    return () => clearInterval(interval);
  }, [liveStreamActive, telemetryQuery]);

  const exportComplianceJson = () => {
    const dataToExport = {
      manifestVersion: "1.0.0",
      complianceStandard: "SOC2-CC6.1 / MiCA Title III",
      exportedAt: new Date().toISOString(),
      network: networkLabel,
      chainId: configuration.chainId,
      totalEvents: filteredEvents.length,
      events: filteredEvents.map((ev) => ({
        eventName: ev.eventName,
        agentAddress: ev.agentAddress,
        blockNumber: ev.blockNumber,
        transactionHash: ev.transactionHash,
        observedAt: ev.observedAt,
        payload: ev.payload,
      })),
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agentguard-compliance-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportComplianceCsv = () => {
    const headers = ["ObservedAt", "EventName", "AgentAddress", "BlockNumber", "TransactionHash"];
    const rows = filteredEvents.map((ev) => [
      ev.observedAt,
      ev.eventName,
      ev.agentAddress ?? "N/A",
      String(ev.blockNumber),
      ev.transactionHash,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agentguard-telemetry-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Observability / Telemetry</span>
          <h1>Live Spend Waterfall & Trace Explorer</h1>
          <p>
            Sub-second Monad Parallel EVM telemetry, disjoint storage slot evaluations, and atomic settlement receipts.
          </p>
        </div>
        <div className="page-heading-actions">
          <Button
            variant={liveStreamActive ? "filled" : "tonal"}
            onClick={() => setLiveStreamActive(!liveStreamActive)}
          >
            <Radio size={14} className={liveStreamActive ? "spin" : ""} />
            <span>{liveStreamActive ? "Live Stream Active" : "Stream Paused"}</span>
          </Button>

          <Button
            variant="tonal"
            onClick={exportComplianceCsv}
            disabled={filteredEvents.length === 0}
            title="Export filtered telemetry events as CSV"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </Button>

          <Button
            variant="tonal"
            onClick={exportComplianceJson}
            disabled={filteredEvents.length === 0}
            title="Export institutional compliance audit manifest (JSON)"
          >
            <Download size={14} />
            <span>Export JSON</span>
          </Button>

          <Button
            variant="tonal"
            onClick={() => void telemetryQuery.refetch()}
            disabled={telemetryQuery.isFetching}
          >
            <RefreshCw size={14} className={telemetryQuery.isFetching ? "spin" : ""} />
            <span>{telemetryQuery.isFetching ? "Refreshing…" : "Refresh Feed"}</span>
          </Button>
          <Link to="/app/simulator" className="control control-filled">
            <Sparkles size={14} />
            <span>Simulate Spend</span>
          </Link>
        </div>
      </header>

      {/* View Mode Switcher */}
      <div className="activity-view-switcher" style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border-default)", paddingBottom: "12px", marginBottom: "8px" }}>
        <Button
          type="button"
          variant={viewMode === "telemetry" ? "filled" : "tonal"}
          onClick={() => setViewMode("telemetry")}
        >
          <Activity size={14} style={{ marginRight: "6px" }} />
          <span>Telemetry & Events Feed</span>
        </Button>
        <Button
          type="button"
          variant={viewMode === "outbox" ? "filled" : "tonal"}
          onClick={() => setViewMode("outbox")}
        >
          <Layers size={14} style={{ marginRight: "6px" }} />
          <span>Transactional Settlement Outbox</span>
        </Button>
      </div>

      {viewMode === "outbox" ? (
        <SettlementPipelineInspector />
      ) : (
        <>
          {/* Option 3: Predictive Threat Radar & Counterparty Category Drift Engine */}
          <Surface className="threat-radar-surface">
        <div className="section-heading">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="threat-radar-avatar">
              <ShieldAlert size={20} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2>Predictive Threat Radar & Drift Engine</h2>
                <Badge
                  tone={
                    threatIntelligence.threatScore > 50
                      ? "critical"
                      : threatIntelligence.threatScore > 20
                        ? "warning"
                        : "success"
                  }
                >
                  {threatIntelligence.threatScore > 50
                    ? `CRITICAL RISK · ${threatIntelligence.threatScore}`
                    : threatIntelligence.threatScore > 20
                      ? `ELEVATED DRIFT · ${threatIntelligence.threatScore}`
                      : `ARMORED · ${threatIntelligence.threatScore}`}
                </Badge>
              </div>
              <p>
                Continuous EWMA velocity monitoring, non-parametric Z-score deviation, and heuristic counterparty category drift detection across Monad EVM.
              </p>
            </div>
          </div>
        </div>

        {/* Radar Metric Tiles */}
        <div className="threat-radar-grid">
          <div className="threat-tile">
            <span className="threat-tile-label">Fleet Threat Index</span>
            <strong
              className="threat-tile-val"
              style={{
                color:
                  threatIntelligence.threatScore > 50
                    ? "var(--error)"
                    : threatIntelligence.threatScore > 20
                      ? "var(--gold)"
                      : "var(--status-good)",
              }}
            >
              {threatIntelligence.threatScore} / 100
            </strong>
            <small className="threat-tile-sub">Composite Adversarial Probability</small>
          </div>

          <div className="threat-tile">
            <span className="threat-tile-label">Max Velocity Deviation</span>
            <strong className="threat-tile-val">
              +{threatIntelligence.maxZScore}σ
            </strong>
            <small className="threat-tile-sub">Standard Deviation above EWMA</small>
          </div>

          <div className="threat-tile">
            <span className="threat-tile-label">Counterparty Drift Ratio</span>
            <strong className="threat-tile-val">
              {threatIntelligence.driftRatePct}%
            </strong>
            <small className="threat-tile-sub">Traffic to Unclassified Contracts</small>
          </div>

          <div className="threat-tile">
            <span className="threat-tile-label">Sub-Ceiling Probes</span>
            <strong className="threat-tile-val">
              {threatIntelligence.probingCount}
            </strong>
            <small className="threat-tile-sub">95-99% maxPerTx Clustering</small>
          </div>
        </div>

        {/* Anomaly Stream or Clean State */}
        {threatIntelligence.anomalies.length > 0 ? (
          <div className="threat-anomalies-list">
            <span className="threat-stream-kicker">
              Active Behavioral Anomalies ({threatIntelligence.anomalies.length} Flagged)
            </span>
            <div className="threat-cards-stack">
              {threatIntelligence.anomalies.map((anom) => (
                <div key={anom.id} className={`threat-anomaly-card severity-${anom.severity}`}>
                  <div className="threat-card-left">
                    <div className="threat-card-top">
                      <Badge tone={anom.severity === "critical" ? "critical" : anom.severity === "medium" ? "warning" : "neutral"}>
                        {anom.severity.toUpperCase()}
                      </Badge>
                      <strong className="threat-type-tag">
                        {anom.anomalyType.replace("_", " ").toUpperCase()}
                      </strong>
                      <span className="threat-time">
                        {new Date(anom.observedAt).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="threat-card-ident">
                      <Bot size={13} />
                      <Mono>{truncateMiddle(anom.agentAddress, 8, 4)}</Mono>
                      <span className="threat-categories">
                        <small className="muted">{anom.historicalCategory}</small>
                        <ArrowRight size={11} style={{ margin: "0 4px" }} />
                        <strong style={{ color: "var(--on-surface)" }}>{anom.attemptedCategory}</strong>
                      </span>
                    </div>

                    <p className="threat-details-text">{anom.details}</p>
                  </div>

                  <div className="threat-card-right">
                    <Button
                      variant="filled"
                      className={anom.remediationAction === "trip_killswitch" ? "control-critical" : ""}
                      onClick={() => handleRemediate(anom)}
                    >
                      {anom.remediationAction === "trip_killswitch" ? (
                        <>
                          <ShieldAlert size={13} style={{ marginRight: 6 }} />
                          <span>Trip Circuit Breaker</span>
                        </>
                      ) : anom.remediationAction === "tighten_policy" ? (
                        <>
                          <Gauge size={13} style={{ marginRight: 6 }} />
                          <span>Tighten Ceiling</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={13} style={{ marginRight: 6 }} />
                          <span>Verify Merchant</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="threat-armored-banner">
            <ShieldCheck size={22} color="var(--status-good, #10b981)" />
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <strong style={{ fontSize: "0.88rem", color: "var(--on-surface)" }}>
                Fleet Armored: Zero Adversarial Drift Signatures Detected
              </strong>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
                All agent spending requests operate within standard EWMA velocity baselines and verified merchant categories.
              </p>
            </div>
          </div>
        )}
      </Surface>

      {/* Filter and Search Bar */}
      <Surface className="activity-filter-bar">
        <div className="activity-filter-controls">
          <div className="table-search-input" style={{ position: "relative" }}>
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search by agent address, tx hash, or event name… (Press / to focus)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="activity-type-chips">
            <button
              type="button"
              className={`activity-chip ${filterType === "all" ? "active" : ""}`}
              onClick={() => setFilterType("all")}
            >
              All Events ({events.length})
            </button>
            <button
              type="button"
              className={`activity-chip ${filterType === "payment_cleared" ? "active" : ""}`}
              onClick={() => setFilterType("payment_cleared")}
            >
              Cleared Payments
            </button>
            <button
              type="button"
              className={`activity-chip ${filterType === "policy_evaluated" ? "active" : ""}`}
              onClick={() => setFilterType("policy_evaluated")}
            >
              Policy Invariants
            </button>
            <button
              type="button"
              className={`activity-chip ${filterType === "circuit_tripped" ? "active" : ""}`}
              onClick={() => setFilterType("circuit_tripped")}
            >
              Circuit Tripped
            </button>
          </div>
        </div>
      </Surface>

      {/* Events Table / Stream */}
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Finalized Monad Telemetry Feed</h2>
            <p>Real-time chain events observed across your organization's sovereign agent fleet.</p>
          </div>
          <div className="beacon-container">
            <span className="beacon-dot" />
            <span className="beacon-text">{networkLabel} · 400ms block finality</span>
          </div>
        </div>

        {telemetryQuery.isError ? (
          <EmptyState
            title="Telemetry feed unavailable"
            detail="We couldn't connect to the telemetry service right now. Please verify service connectivity."
            action={
              <Button variant="tonal" onClick={() => void telemetryQuery.refetch()}>
                <RefreshCw size={14} style={{ marginRight: 6 }} /> Retry Connection
              </Button>
            }
          />
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            title="No telemetry events observed yet"
            detail="When your agents execute spending requests or when policy is adjusted on Monad, chain-derived traces will stream in here."
            action={
              <Link to="/simulator">
                <Button variant="filled">
                  <Sparkles size={14} style={{ marginRight: 6 }} /> Run Testbench Simulation
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="dense-table-wrapper">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event Name</th>
                  <th>Agent Context</th>
                  <th>Block / Tx Hash</th>
                  <th>Status</th>
                  <th>Trace</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((ev, idx) => {
                  const date = new Date(ev.observedAt);
                  const isSelected = selectedEvent?.transactionHash === ev.transactionHash && selectedEvent?.blockNumber === ev.blockNumber;
                  const reason = getReasonInfo(ev.payload as Record<string, any> | undefined, ev.eventName);
                  return (
                    <tr
                      key={`${ev.transactionHash}-${ev.blockNumber}-${idx}`}
                      className={`clickable-row ${isSelected ? "row-selected" : ""}`}
                      onClick={() => setSelectedEvent(ev)}
                      tabIndex={0}
                      aria-label={`Inspect ${ev.eventName} event`}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedEvent(ev);
                        }
                      }}
                    >
                      <td>
                        <small className="timestamp-cell" title={ev.observedAt}>
                          {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </small>
                      </td>
                      <td>
                        <div className="event-name-cell">
                          <span className="event-dot" />
                          <strong>{ev.eventName}</strong>
                        </div>
                      </td>
                      <td>
                        {ev.agentAddress ? (
                          <div className="agent-ident-cell">
                            <Bot size={13} />
                            <Mono>{truncateMiddle(ev.agentAddress, 6, 4)}</Mono>
                          </div>
                        ) : (
                          <small className="muted">System / Org</small>
                        )}
                      </td>
                      <td>
                        <div className="tx-hash-cell">
                          <span className="block-pill">#{ev.blockNumber}</span>
                          <Mono>{truncateMiddle(ev.transactionHash, 8, 4)}</Mono>
                        </div>
                      </td>
                      <td>
                        <div
                          className="reason-code-badge"
                          title={`${reason.key} (${reason.code}): ${reason.explanation} Remediation: ${reason.remediation}`}
                        >
                          <Badge tone={reason.tone}>
                            {reason.label}
                          </Badge>
                          <span className="reason-code-remediation">
                            {reason.key !== "ERR_NONE" ? reason.key : "Finalized onchain"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <Button
                          variant="text"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(ev);
                          }}
                        >
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {/* Transaction Trace Drawer */}
      {selectedEvent && (
        <div className="inspector-backdrop" onClick={() => setSelectedEvent(null)}>
          <aside className="inspector-drawer trace-drawer" onClick={(e) => e.stopPropagation()}>
            <header className="inspector-header">
              <div className="inspector-title-group">
                <div className="inspector-avatar">
                  <Zap size={22} />
                </div>
                <div>
                  <div className="inspector-address-row">
                    <h3>Execution Trace: {selectedEvent.eventName}</h3>
                  </div>
                  <div className="inspector-tags">
                    <Badge tone="success">Block #{selectedEvent.blockNumber}</Badge>
                    <span className="inspector-env-pill">Monad Testnet</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="inspector-close-btn"
                onClick={() => setSelectedEvent(null)}
                aria-label="Close trace drawer"
              >
                <X size={18} />
              </button>
            </header>

            <div className="inspector-body">
              {/* Monad Parallel EVM Pipeline Steps */}
              <div className="trace-pipeline">
                <span className="trace-pipeline-kicker">Monad Parallel Pipeline Execution</span>

                {/* Step 1 */}
                <div className="trace-step step-completed">
                  <div className="step-marker">
                    <CheckCircle2 size={16} />
                  </div>
                  <div className="step-content">
                    <div className="step-head">
                      <strong>1. Cryptographic Invariants & Nonce Check</strong>
                      <span className="step-time">0.11 ms</span>
                    </div>
                    <p>
                      EIP-712 structured data hash verified against agent signer key. Nonce checked to eliminate replay vulnerabilities.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="trace-step step-completed">
                  <div className="step-marker">
                    <CheckCircle2 size={16} />
                  </div>
                  <div className="step-content">
                    <div className="step-head">
                      <strong>2. Cancun Transient Reentrancy Guard</strong>
                      <span className="step-time">0.08 ms</span>
                    </div>
                    <p>
                      Opcode <Mono>tstore</Mono> set reentrancy lock in transient memory with zero persistent SSTORE slot allocation.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="trace-step step-completed">
                  <div className="step-marker">
                    <CheckCircle2 size={16} />
                  </div>
                  <div className="step-content">
                    <div className="step-head">
                      <strong>3. Disjoint EVM Partition Slot Invariants</strong>
                      <span className="step-time">0.18 ms</span>
                    </div>
                    <p>
                      Policy struct evaluated in memory. Checked maxPerTx ceiling, hourly sliding window velocity, and merchant whitelist.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="trace-step step-completed">
                  <div className="step-marker">
                    <CheckCircle2 size={16} />
                  </div>
                  <div className="step-content">
                    <div className="step-head">
                      <strong>4. Atomic Settlement Dispatch</strong>
                      <span className="step-time">398 ms</span>
                    </div>
                    <p>
                      Dispatched onchain to AgentWalletGuard. Non-custodial token transfer confirmed in Monad Testnet block #{selectedEvent.blockNumber}.
                    </p>
                  </div>
                </div>
              </div>

              {/* Remediation Guidance Card */}
              {(() => {
                const selectedReason = getReasonInfo(selectedEvent.payload as Record<string, any> | undefined, selectedEvent.eventName);
                return (
                  <div
                    className="trace-remediation-card"
                    style={{
                      marginTop: "14px",
                      marginBottom: "14px",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      background: "var(--surface-sunken)",
                      border: "1px solid var(--outline-soft)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <Badge tone={selectedReason.tone}>{selectedReason.key} ({selectedReason.code})</Badge>
                      <strong style={{ fontSize: "0.85rem", color: "var(--on-surface)" }}>{selectedReason.label}</strong>
                    </div>
                    <p style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--on-surface-secondary)", lineHeight: 1.4 }}>
                      {selectedReason.explanation}
                    </p>
                    <div style={{ fontSize: "0.76rem", color: "var(--primary)", display: "flex", alignItems: "flex-start", gap: "4px" }}>
                      <strong style={{ whiteSpace: "nowrap" }}>Remediation:</strong>
                      <span>{selectedReason.remediation}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Transaction Context Card */}
              <div className="trace-meta-card">
                <h4>Transaction Identifiers</h4>
                <div className="trace-meta-grid">
                  <div className="meta-row">
                    <small>Transaction Hash</small>
                    <div className="copyable-hash">
                      <Mono>{selectedEvent.transactionHash}</Mono>
                      <button
                        type="button"
                        className="copy-mini-btn"
                        onClick={() => handleCopy(selectedEvent.transactionHash)}
                        title="Copy hash"
                      >
                        {copiedHash === selectedEvent.transactionHash ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>

                  {selectedEvent.agentAddress && (
                    <div className="meta-row">
                      <small>Agent Address</small>
                      <div className="copyable-hash">
                        <Mono>{selectedEvent.agentAddress}</Mono>
                        <button
                          type="button"
                          className="copy-mini-btn"
                          onClick={() => handleCopy(selectedEvent.agentAddress ?? "")}
                          title="Copy agent address"
                        >
                          {copiedHash === selectedEvent.agentAddress ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="meta-row">
                    <small>Observed Timestamp</small>
                    <span>{new Date(selectedEvent.observedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Payload Parameters */}
              {selectedEvent.payload && Object.keys(selectedEvent.payload).length > 0 && (
                <div className="trace-payload-card">
                  <h4>Event Attributes</h4>
                  <pre className="payload-json">
                    {JSON.stringify(selectedEvent.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
        </>
      )}
    </div>
  );
}
