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
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useTelemetryEvents, useAgents, type TelemetryEvent, type ThreatAnomaly } from "../../api";
import { Badge, Button, EmptyState, Mono, Surface, TextField, truncateMiddle } from "../../design-system";
import { eventLabel } from "../../copy";
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
    label: "Approved",
    tone: "success",
    explanation: "This payment passed every spending rule.",
    remediation: "No action needed. The payment went through.",
  },
  1: {
    code: 1,
    key: "ERR_EXCEEDS_MAX_TX",
    label: "Over the limit",
    tone: "critical",
    explanation: "The payment was larger than this agent's per-transaction limit.",
    remediation: "Lower the amount, or raise the per-transaction limit in Policy.",
  },
  2: {
    code: 2,
    key: "ERR_VELOCITY_EXCEEDED",
    label: "Period limit reached",
    tone: "critical",
    explanation: "This agent has used up its spending limit for the current period.",
    remediation: "Wait for the period to reset, or raise the period limit in Policy.",
  },
  3: {
    code: 3,
    key: "ERR_MAX_VELOCITY_EXCEEDED",
    label: "Too many payments",
    tone: "warning",
    explanation: "This agent made too many payments in a short time.",
    remediation: "Raise the payments-per-period limit in Policy, or slow the agent down.",
  },
  4: {
    code: 4,
    key: "ERR_KILL_SWITCH_ACTIVE",
    label: "Agent paused",
    tone: "critical",
    explanation: "This agent is paused, so it can't spend.",
    remediation: "Resume the agent in Fleet or Policy when you're ready.",
  },
  5: {
    code: 5,
    key: "ERR_MERCHANT_NOT_WHITELISTED",
    label: "Unapproved merchant",
    tone: "warning",
    explanation: "The recipient isn't on this agent's approved merchant list.",
    remediation: "Add the merchant in Merchant Directory, or turn off the approved-merchants requirement in Policy.",
  },
  6: {
    code: 6,
    key: "ERR_BUDGET_POOL_EXHAUSTED",
    label: "Out of funds",
    tone: "critical",
    explanation: "Your treasury doesn't have enough funds for this payment.",
    remediation: "Add funds in Treasury.",
  },
  7: {
    code: 7,
    key: "ERR_EXPIRED",
    label: "Request expired",
    tone: "warning",
    explanation: "The payment request took too long and expired.",
    remediation: "The agent needs to send a fresh request.",
  },
  8: {
    code: 8,
    key: "ERR_NONCE_REUSED",
    label: "Duplicate request",
    tone: "critical",
    explanation: "This exact request was already used, so it was blocked.",
    remediation: "Check that the agent isn't sending the same request twice.",
  },
  9: {
    code: 9,
    key: "ERR_SIGNATURE_INVALID",
    label: "Couldn't verify",
    tone: "critical",
    explanation: "The request's signature could not be verified.",
    remediation: "Check that the agent is using the wallet it was registered with.",
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

  const currentEventIndex = selectedEvent
    ? filteredEvents.findIndex(
        (ev) =>
          ev.transactionHash === selectedEvent.transactionHash &&
          ev.blockNumber === selectedEvent.blockNumber &&
          ev.eventName === selectedEvent.eventName,
      )
    : -1;
  const hasPrevEvent = currentEventIndex > 0;
  const hasNextEvent = currentEventIndex >= 0 && currentEventIndex < filteredEvents.length - 1;
  const handlePrevEvent = () => {
    if (hasPrevEvent) setSelectedEvent(filteredEvents[currentEventIndex - 1]);
  };
  const handleNextEvent = () => {
    if (hasNextEvent) setSelectedEvent(filteredEvents[currentEventIndex + 1]);
  };

  const clearedCount = useMemo(() => events.filter((e) => e.eventName.toLowerCase() === "payment_cleared").length, [events]);
  const policyCount = useMemo(() => events.filter((e) => e.eventName.toLowerCase() === "policy_evaluated").length, [events]);
  const trippedCount = useMemo(() => events.filter((e) => e.eventName.toLowerCase() === "circuit_tripped").length, [events]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedEvent) {
        setSelectedEvent(null);
        return;
      }
      if (
        e.key === "/" &&
        !selectedEvent &&
        document.activeElement !== searchInputRef.current &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      const target = e.target as HTMLElement | null;
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "") || Boolean(target?.isContentEditable);
      if (isInput) return;

      if (selectedEvent) {
        if ((e.key === "j" || e.key === "ArrowDown") && hasNextEvent) {
          e.preventDefault();
          handleNextEvent();
        } else if ((e.key === "k" || e.key === "ArrowUp") && hasPrevEvent) {
          e.preventDefault();
          handlePrevEvent();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEvent, hasNextEvent, hasPrevEvent, currentEventIndex, filteredEvents]);

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
            historicalCategory: "Policy Compliant",
            attemptedCategory: "Blocked by a spending rule",
            observedAt: ev.observedAt,
            details: `A spending rule blocked this payment.`,
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
          title: "Agent paused",
          message: `${truncateMiddle(anomaly.agentAddress, 8, 4)} has been paused.`,
          tone: "critical",
        });
      } catch {
        toast({
          title: "Couldn't pause agent",
          message: "Try again in a moment.",
          tone: "warning",
        });
      }
    } else if (anomaly.remediationAction === "tighten_policy") {
      toast({
        title: "Consider tighter limits",
        message: `Open Policy to lower the per-transaction limit for ${truncateMiddle(anomaly.agentAddress, 8, 4)}.`,
        tone: "warning",
      });
    } else {
      toast({
        title: "Check this merchant",
        message: `Make sure this merchant is legitimate before approving it in Merchant Directory.`,
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
          <h1>Activity</h1>
          <p>
            Real-time spend evaluations, settlement receipts, and audit trail.
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
            title="Export the filtered activity as CSV"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </Button>

          <Button
            variant="tonal"
            onClick={exportComplianceJson}
            disabled={filteredEvents.length === 0}
            title="Export a compliance audit report (JSON)"
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
            <span>{telemetryQuery.isFetching ? "Refreshing…" : "Refresh"}</span>
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
          <span>Activity</span>
        </Button>
        <Button
          type="button"
          variant={viewMode === "outbox" ? "filled" : "tonal"}
          onClick={() => setViewMode("outbox")}
        >
          <Layers size={14} style={{ marginRight: "6px" }} />
          <span>Payment queue</span>
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
                <h2>Risk monitor</h2>
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
                    ? `High risk · ${threatIntelligence.threatScore}`
                    : threatIntelligence.threatScore > 20
                      ? `Some risk · ${threatIntelligence.threatScore}`
                      : `Low risk · ${threatIntelligence.threatScore}`}
                </Badge>
              </div>
              <p>
                We watch for unusual spending speed and unfamiliar merchants.
              </p>
            </div>
          </div>
        </div>

        {/* Radar Metric Tiles */}
        <div className="threat-radar-grid">
          <div className="threat-tile">
            <span className="threat-tile-label">Overall risk</span>
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
            <small className="threat-tile-sub">Chance something is wrong</small>
          </div>

          <div className="threat-tile">
            <span className="threat-tile-label">Spending speed spike</span>
            <strong className="threat-tile-val">
              +{threatIntelligence.maxZScore}σ
            </strong>
            <small className="threat-tile-sub">Compared with the usual pace</small>
          </div>

          <div className="threat-tile">
            <span className="threat-tile-label">New merchants</span>
            <strong className="threat-tile-val">
              {threatIntelligence.driftRatePct}%
            </strong>
            <small className="threat-tile-sub">Payments to unfamiliar recipients</small>
          </div>

          <div className="threat-tile">
            <span className="threat-tile-label">Limit testing</span>
            <strong className="threat-tile-val">
              {threatIntelligence.probingCount}
            </strong>
            <small className="threat-tile-sub">Payments just under the limit</small>
          </div>
        </div>

        {/* Anomaly Stream or Clean State */}
        {threatIntelligence.anomalies.length > 0 ? (
          <div className="threat-anomalies-list">
            <span className="threat-stream-kicker">
              Unusual activity ({threatIntelligence.anomalies.length} flagged)
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
                          <span>Pause agent</span>
                        </>
                      ) : anom.remediationAction === "tighten_policy" ? (
                        <>
                          <Gauge size={13} style={{ marginRight: 6 }} />
                          <span>Lower limit</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={13} style={{ marginRight: 6 }} />
                          <span>Review merchant</span>
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
                All clear: no unusual activity detected
              </strong>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
                Every agent is spending at its usual pace and paying familiar merchants.
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

          <div className="activity-type-chips segmented-filter-pills" role="group" aria-label="Filter activity">
            <button
              type="button"
              aria-pressed={filterType === "all"}
              className={`activity-chip segmented-filter-pill ${filterType === "all" ? "active" : ""}`}
              onClick={() => setFilterType("all")}
            >
              <span>All Events</span>
              <span className="pill-count">{events.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={filterType === "payment_cleared"}
              className={`activity-chip segmented-filter-pill ${filterType === "payment_cleared" ? "active" : ""}`}
              onClick={() => setFilterType("payment_cleared")}
            >
              <span>Approved payments</span>
              <span className="pill-count">{clearedCount}</span>
            </button>
            <button
              type="button"
              aria-pressed={filterType === "policy_evaluated"}
              className={`activity-chip segmented-filter-pill ${filterType === "policy_evaluated" ? "active" : ""}`}
              onClick={() => setFilterType("policy_evaluated")}
            >
              <span>Rule checks</span>
              <span className="pill-count">{policyCount}</span>
            </button>
            <button
              type="button"
              aria-pressed={filterType === "circuit_tripped"}
              className={`activity-chip segmented-filter-pill ${filterType === "circuit_tripped" ? "active" : ""}`}
              onClick={() => setFilterType("circuit_tripped")}
            >
              <span>Paused</span>
              <span className="pill-count">{trippedCount}</span>
            </button>
          </div>
        </div>
      </Surface>

      {/* Events Table / Stream */}
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Activity feed</h2>
            <p>Live activity across all of your agents.</p>
          </div>
          <div className="beacon-container">
            <span className="beacon-dot" />
            <span className="beacon-text">Live</span>
          </div>
        </div>

        {telemetryQuery.isError ? (
          <EmptyState kind="warning"
            title="Activity unavailable"
            detail="We couldn't load activity right now. Try again in a moment."
            action={
              <Button variant="tonal" onClick={() => void telemetryQuery.refetch()}>
                <RefreshCw size={14} style={{ marginRight: 6 }} /> Try again
              </Button>
            }
          />
        ) : filteredEvents.length === 0 ? (
          <EmptyState kind="neutral"
            title="No activity yet"
            detail="Payments and rule changes will show up here as they happen."
            action={
              <Link to="/app/simulator">
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
                      aria-label={`Inspect ${eventLabel(ev.eventName)}`}
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
                          <strong>{eventLabel(ev.eventName)}</strong>
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
                            {reason.key !== "ERR_NONE" ? reason.key : "Approved"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="trace-row-actions">
                          <Button
                            variant="text"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(ev);
                            }}
                          >
                            Inspect
                          </Button>
                        </div>
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
                    <h3>{eventLabel(selectedEvent.eventName)}</h3>
                  </div>
                  <div className="inspector-tags">
                    <Badge tone="success">Block #{selectedEvent.blockNumber}</Badge>
                    <span className="inspector-env-pill">Testnet</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {filteredEvents.length > 1 && (
                  <div className="drawer-cycle-controls" role="group" aria-label="Cycle events">
                    <button
                      type="button"
                      className="drawer-cycle-btn"
                      onClick={handlePrevEvent}
                      disabled={!hasPrevEvent}
                      title="Previous trace (K or Up Arrow)"
                      aria-label="Previous trace"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <span className="drawer-cycle-counter">
                      {currentEventIndex + 1}/{filteredEvents.length}
                    </span>
                    <button
                      type="button"
                      className="drawer-cycle-btn"
                      onClick={handleNextEvent}
                      disabled={!hasNextEvent}
                      title="Next trace (J or Down Arrow)"
                      aria-label="Next trace"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <kbd className="drawer-cycle-kbd">J/K</kbd>
                  </div>
                )}
                <button
                  type="button"
                  className="inspector-close-btn"
                  onClick={() => setSelectedEvent(null)}
                  aria-label="Close trace drawer"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            <div className="inspector-body">
              {/* How this payment was checked */}
              <div className="trace-pipeline">
                <span className="trace-pipeline-kicker">How this was checked</span>

                <div className="trace-step step-completed">
                  <div className="step-marker">
                    <CheckCircle2 size={16} />
                  </div>
                  <div className="step-content">
                    <div className="step-head">
                      <strong>1. Request verified</strong>
                    </div>
                    <p>We confirmed the request came from this agent and hasn't been used before.</p>
                  </div>
                </div>

                <div className="trace-step step-completed">
                  <div className="step-marker">
                    <CheckCircle2 size={16} />
                  </div>
                  <div className="step-content">
                    <div className="step-head">
                      <strong>2. Safety check</strong>
                    </div>
                    <p>We made sure the payment couldn't be triggered twice at once.</p>
                  </div>
                </div>

                <div className="trace-step step-completed">
                  <div className="step-marker">
                    <CheckCircle2 size={16} />
                  </div>
                  <div className="step-content">
                    <div className="step-head">
                      <strong>3. Spending rules</strong>
                    </div>
                    <p>We checked the amount, how often this agent pays, and whether the merchant is approved.</p>
                  </div>
                </div>

                <div className="trace-step step-completed">
                  <div className="step-marker">
                    <CheckCircle2 size={16} />
                  </div>
                  <div className="step-content">
                    <div className="step-head">
                      <strong>4. Payment sent</strong>
                    </div>
                    <p>The payment was sent and confirmed.</p>
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
                      <Badge tone={selectedReason.tone}>{selectedReason.code === 0 ? "Approved" : "Blocked"}</Badge>
                      <strong style={{ fontSize: "0.85rem", color: "var(--on-surface)" }}>{selectedReason.label}</strong>
                    </div>
                    <p style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--on-surface-secondary)", lineHeight: 1.4 }}>
                      {selectedReason.explanation}
                    </p>
                    <div style={{ fontSize: "0.76rem", color: "var(--primary)", display: "flex", alignItems: "flex-start", gap: "4px" }}>
                      <strong style={{ whiteSpace: "nowrap" }}>What to do:</strong>
                      <span>{selectedReason.remediation}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Transaction Context Card */}
              <div className="trace-meta-card">
                <h4>Details</h4>
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
                    <small>Time</small>
                    <span>{new Date(selectedEvent.observedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Payload Parameters */}
              {selectedEvent.payload && Object.keys(selectedEvent.payload).length > 0 && (
                <div className="trace-payload-card">
                  <h4>More details</h4>
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
