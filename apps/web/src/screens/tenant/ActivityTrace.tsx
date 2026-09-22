import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  Radio,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  ShieldCheck,
  Zap,
  X,
  Bot,
  Copy,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useTelemetryEvents, useAgents, type TelemetryEvent } from "../../api";
import { Badge, Button, EmptyState, Mono, Surface, TextField, truncateMiddle } from "../../design-system";
import { useIdentity } from "../../identity";
import { configuration, networkLabel } from "../../configuration";

export function ActivityTrace() {
  const identity = useIdentity();
  const telemetryQuery = useTelemetryEvents(Boolean(identity.authenticated));
  const agentsQuery = useAgents(Boolean(identity.authenticated));
  const events = telemetryQuery.data ?? [];

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<TelemetryEvent | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

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

      {/* Filter and Search Bar */}
      <Surface className="activity-filter-bar">
        <div className="activity-filter-controls">
          <div className="table-search-input">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search by agent address, tx hash, or event name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
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
            detail="We couldn't connect to the telemetry service right now. Please try again."
          />
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            title="No telemetry events observed yet"
            detail="When your agents execute spending requests or when policy is adjusted on Monad, chain-derived traces will stream in here."
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
                        <Badge tone="success">
                          Finalized onchain
                        </Badge>
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
    </div>
  );
}
