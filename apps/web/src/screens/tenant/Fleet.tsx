import { useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "@tanstack/react-router";
import { Activity, Bot, Download, Filter, Layers, Network, PauseCircle, RefreshCw, Search, ShieldAlert, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { request, toUserFacingError, useAgents, useOrganizationWallets, type Agent } from "../../api";
import { Badge, Button, EmptyState, Select, Surface, TextField, truncateMiddle, formatRiskTier, TableViewport } from "../../design-system";
import { StatTile } from "../../charts";
import { useIdentity } from "../../identity";
import { useTripKillSwitch } from "../../hooks/usePolicyContracts";
import { AgentInspector } from "./AgentInspector";
import { AgentOnboardingModal } from "../../components/AgentOnboardingModal";
import { AgentStatusGrid } from "../../components/AgentStatusGrid";
import { useToast } from "../../components/UndoToast";
import { CopyAddressButton } from "./fleet/CopyAddressButton";
import { AgentWalletPanel } from "./fleet/AgentWalletPanel";

const fleetFeatures = tableFeatures({});
const fleetColumnHelper = createColumnHelper<typeof fleetFeatures, Agent>();
export function Fleet() {
  const identity = useIdentity();
  const { toast } = useToast();
  const query = useAgents(Boolean(identity.authenticated));
  const treasuryWallets = useOrganizationWallets(Boolean(identity.authenticated));
  const client = useQueryClient();
  const [address, setAddress] = useState("");
  const [walletSource, setWalletSource] = useState<"external" | "sovereign" | "tba">("sovereign");
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const parent = useRef<HTMLDivElement>(null);
  const rows = query.data ?? [];
  const active = rows.filter((agent) => agent.status === "active").length;
  const sovereign = rows.filter((agent) => agent.walletSource === "sovereign").length;
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "tripped">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "sovereign" | "external">("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "tier1_critical" | "tier2_standard" | "tier3_low">("all");
  const [batchWorking, setBatchWorking] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "swarm">("table");
  const tripKillSwitch = useTripKillSwitch();

  const filteredRows = useMemo(() => {
    return rows.filter((agent) => {
      if (statusFilter !== "all") {
        const isAgentActive = agent.status === "active";
        if (statusFilter === "active" && !isAgentActive) return false;
        if (statusFilter === "tripped" && isAgentActive) return false;
      }
      if (sourceFilter !== "all" && agent.walletSource !== sourceFilter) return false;
      if (riskFilter !== "all" && agent.riskTier !== riskFilter) return false;
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matchLabel = agent.label?.toLowerCase().includes(q);
        const matchAddr = agent.address.toLowerCase().includes(q);
        if (!matchLabel && !matchAddr) return false;
      }
      return true;
    });
  }, [rows, statusFilter, sourceFilter, riskFilter, searchFilter]);

  const handleBatchFreeze = async () => {
    if (selectedAgents.size === 0) return;
    setBatchWorking(true);
    let successCount = 0;
    try {
      for (const agentAddress of selectedAgents) {
        await tripKillSwitch.mutateAsync({ agentAddress, active: true });
        successCount++;
      }
      toast({
        title: "Agents paused",
        message: `Paused ${successCount} agents.`,
        tone: "critical",
      });
      void client.invalidateQueries({ queryKey: ["agents"] });
    } catch (err) {
      toast({
        title: "Batch Action Error",
        message: toUserFacingError(err, "Some agents could not be paused."),
        tone: "warning",
      });
    } finally {
      setBatchWorking(false);
    }
  };

  const handleBatchResume = async () => {
    if (selectedAgents.size === 0) return;
    setBatchWorking(true);
    let successCount = 0;
    try {
      for (const agentAddress of selectedAgents) {
        await tripKillSwitch.mutateAsync({ agentAddress, active: false });
        successCount++;
      }
      toast({
        title: "Batch Operational Recovery",
        message: `Resumed ${successCount} agents.`,
        tone: "success",
      });
      void client.invalidateQueries({ queryKey: ["agents"] });
    } catch (err) {
      toast({
        title: "Batch Action Error",
        message: toUserFacingError(err, "Some agents could not be resumed."),
        tone: "warning",
      });
    } finally {
      setBatchWorking(false);
    }
  };

  const handleExportJson = () => {
    const dataToExport = rows.filter((a) => selectedAgents.has(a.address));
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agentguard-fleet-manifest-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Manifest Exported",
      message: `Exported ${dataToExport.length} agents to JSON manifest.`,
      tone: "info",
    });
  };

  const handleExportCsv = () => {
    const dataToExport = rows.filter((a) => selectedAgents.has(a.address));
    const header = "Label,Address,WalletSource,Environment,RiskTier,Status\n";
    const body = dataToExport
      .map((a) => `"${a.label || ""}","${a.address}","${a.walletSource}","${a.environment}","${a.riskTier}","${a.status}"`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agentguard-fleet-manifest-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Manifest Exported",
      message: `Exported ${dataToExport.length} agents to CSV manifest.`,
      tone: "info",
    });
  };

  const columns = useMemo(() => {
    return fleetColumnHelper.columns([
      fleetColumnHelper.display({
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all filtered agents"
            checked={filteredRows.length > 0 && selectedAgents.size === filteredRows.length}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedAgents(new Set(filteredRows.map((a) => a.address)));
              } else {
                setSelectedAgents(new Set());
              }
            }}
            style={{ cursor: "pointer", width: "16px", height: "16px", accentColor: "var(--primary)", margin: 0 }}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select agent ${row.original.label || row.original.address}`}
            checked={selectedAgents.has(row.original.address)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = new Set(selectedAgents);
              if (e.target.checked) next.add(row.original.address);
              else next.delete(row.original.address);
              setSelectedAgents(next);
            }}
            style={{ cursor: "pointer", width: "16px", height: "16px", accentColor: "var(--primary)", margin: 0 }}
          />
        ),
      }),
      fleetColumnHelper.accessor("address", {
        header: "Agent",
        cell: (info) => {
          const agent = info.row.original;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {agent.label ? (
                <strong style={{ fontSize: "0.85rem", color: "var(--on-surface)" }}>{agent.label}</strong>
              ) : null}
              <CopyAddressButton address={info.getValue()} />
            </div>
          );
        },
      }),
      fleetColumnHelper.accessor("walletSource", {
        header: "Wallet",
        cell: (info) => (
          <span title={info.getValue() === "sovereign" ? "Secure wallet: hosted for you, signs payments automatically." : "Connected wallet: a wallet you manage yourself."}>
            <Badge tone={info.getValue() === "sovereign" ? "info" : "neutral"}>
              {info.getValue() === "sovereign" ? "Secure wallet" : "Connected wallet"}
            </Badge>
          </span>
        ),
      }),
      fleetColumnHelper.accessor("environment", { header: "Environment" }),
      fleetColumnHelper.accessor("riskTier", {
        header: "Risk tier",
        cell: (info) => (
          <Badge tone={info.getValue() === "tier1_critical" ? "critical" : info.getValue() === "tier2_standard" ? "info" : "neutral"}>
            {formatRiskTier(info.getValue())}
          </Badge>
        ),
      }),
      fleetColumnHelper.accessor("status", {
        header: "State",
        cell: (info) => (
          <div
            className="agent-state-pill"
            title={info.getValue() === "active" ? "Active: every payment is checked against its rules." : "Paused: this agent cannot spend."}
          >
            <span
              className={`status-dot ${info.getValue() === "active" ? "status-dot-success" : "status-dot-warning"}`}
            />
            <span>{info.getValue()}</span>
          </div>
        ),
      }),
      fleetColumnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const agent = row.original;
          const isAgentActive = agent.status === "active";
          return (
            <div className="fleet-row-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`fleet-quick-action-btn ${isAgentActive ? "freeze-btn" : "resume-btn"}`}
                title={isAgentActive ? "Pause this agent" : "Resume spending authority"}
                onClick={async () => {
                  try {
                    await tripKillSwitch.mutateAsync({
                      agentAddress: agent.address,
                      active: isAgentActive,
                    });
                    toast({
                      title: isAgentActive ? "Agent paused" : "Spending Restored",
                      message: isAgentActive
                        ? `Agent ${truncateMiddle(agent.address, 8, 4)} is paused.`
                        : `Agent ${truncateMiddle(agent.address, 8, 4)} spending authority resumed.`,
                      tone: isAgentActive ? "critical" : "success",
                      onUndo: async () => {
                        await tripKillSwitch.mutateAsync({
                          agentAddress: agent.address,
                          active: !isAgentActive,
                        });
                        void client.invalidateQueries({ queryKey: ["agents"] });
                        toast({
                          title: "Action Reverted",
                          message: `State reverted for ${truncateMiddle(agent.address, 8, 4)}.`,
                          tone: "info",
                        });
                      },
                    });
                    void client.invalidateQueries({ queryKey: ["agents"] });
                  } catch (err) {
                    toast({
                      title: "Action Failed",
                      message: toUserFacingError(err, "Could not update this agent."),
                      tone: "warning",
                    });
                  }
                }}
              >
                {isAgentActive ? <PauseCircle size={14} /> : <Activity size={14} />}
              </button>
              <Link
                to="/app/policy"
                search={{ agent: agent.address }}
                className="fleet-quick-action-btn"
                title="Configure spend policy"
              >
                <ShieldCheck size={14} />
              </Link>
              <button
                type="button"
                className="fleet-quick-action-btn"
                title="Inspect agent details"
                onClick={() => setSelected(agent.address)}
              >
                <Bot size={14} />
              </button>
            </div>
          );
        },
      }),
    ]);
  }, [filteredRows, selectedAgents]);

  const table = useTable({ data: filteredRows, columns, features: fleetFeatures });
  const virtual = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 44,
    overscan: 8,
  });
  const register = async () => {
    try {
      await request("/agents", {
        method: "POST",
        body: JSON.stringify(
          walletSource === "sovereign"
            ? { walletSource: "sovereign", label: label.trim(), environment: "production", riskTier: "tier2_standard" }
            : walletSource === "tba"
            ? { walletSource: "sovereign", label: `${label.trim() || "Passport Agent"} [Identity wallet]`, environment: "production", riskTier: "tier2_standard" }
            : { walletSource: "external", address, label: label.trim() || undefined, environment: "production", riskTier: "tier2_standard" },
        ),
      });
      toast({
        title: "Agent Registered",
        message: `Agent ${label.trim()} registered to organization fleet.`,
        tone: "success",
      });
      setAddress("");
      setLabel("");
      void client.invalidateQueries({ queryKey: ["agents"] });
    } catch (error) {
      toast({
        title: "Registration Failed",
        message: toUserFacingError(error, "The agent could not be registered."),
        tone: "critical",
      });
    }
  };
  const selectedAgent = rows.find((agent) => agent.address === selected) ?? null;
  const currentIndex = selected ? filteredRows.findIndex((agent) => agent.address === selected) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < filteredRows.length - 1;
  const handlePrevAgent = () => {
    if (hasPrev) setSelected(filteredRows[currentIndex - 1].address);
  };
  const handleNextAgent = () => {
    if (hasNext) setSelected(filteredRows[currentIndex + 1].address);
  };

  const linkTreasuryOptions = (treasuryWallets.data ?? []).map((w) => ({
    value: w.address,
    label: w.label,
    detail: `${w.kind === "sovereign" ? "Secure" : "Connected"} · ${truncateMiddle(w.address, 8, 4)}`,
    badge: <Badge tone="info">{w.kind === "sovereign" ? "Secure" : "Connected"}</Badge>,
  }));

  const hasActiveFilters = Boolean(searchFilter.trim() || statusFilter !== "all" || sourceFilter !== "all" || riskFilter !== "all");

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Agents</h1>
          <p>Autonomous agents registered to your organization.</p>
        </div>
        <div className="page-heading-actions">
          <Button onClick={() => setOnboardingOpen(true)}>
            <Sparkles size={14} />
            <span>Provision Agent</span>
          </Button>
        </div>
      </header>
      <div className="stat-row">
        <StatTile label="Total agents" value={String(rows.length)} icon={<Bot size={18} />} accent={0} />
        <StatTile label="Active" value={String(active)} icon={<Activity size={18} />} accent={2} />
        <StatTile label="Paused" value={String(rows.length - active)} icon={<PauseCircle size={18} />} accent={1} />
        <StatTile label="Managed wallets" value={String(sovereign)} icon={<Wallet size={18} />} accent={3} />
      </div>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Register Agent</h2>
            <p>Create a secure wallet, an identity wallet, or link your treasury.</p>
          </div>
        </div>
        <div className="wallet-kind-toggle" role="group" aria-label="Wallet source">
          <button
            type="button"
            aria-pressed={walletSource === "sovereign"}
            className={walletSource === "sovereign" ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setWalletSource("sovereign")}
          >
            <Sparkles size={14} /> Auto-generate wallet
          </button>
          <button
            type="button"
            aria-pressed={walletSource === "tba"}
            className={walletSource === "tba" ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setWalletSource("tba")}
          >
            <ShieldCheck size={14} /> Agent identity wallet
          </button>
          <button
            type="button"
            aria-pressed={walletSource === "external"}
            className={walletSource === "external" ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setWalletSource("external")}
          >
            <Wallet size={14} /> Link a treasury wallet
          </button>
        </div>
        <div className="inline-form">
          <TextField
            label={walletSource === "tba" ? "Passport agent label" : "Agent label"}
            placeholder={
              walletSource === "tba"
                ? "e.g. Autonomous Strategy Bot [TBA]"
                : walletSource === "external"
                  ? "e.g. Treasury Operations Bot"
                  : "e.g. Inference Agent"
            }
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />

          {walletSource === "external" && (
            (treasuryWallets.data?.length ?? 0) > 0 ? (
              <Select
                value={address}
                onChange={(selectedVal) => {
                  setAddress(selectedVal);
                  if (!label.trim()) {
                    const matched = treasuryWallets.data?.find((w) => w.address.toLowerCase() === selectedVal.toLowerCase());
                    if (matched) setLabel(matched.label);
                  }
                }}
                options={linkTreasuryOptions}
                placeholder="Select a registered treasury wallet"
              />
            ) : (
              <EmptyState
                kind="wallet"
                title="No treasury wallets yet"
                detail="Register one in Treasury first, then come back to link it to this agent."
              />
            )
          )}

          <Button
            onClick={register}
            disabled={walletSource === "external" ? !address || !label.trim() : !label.trim()}
          >
            Register
          </Button>
        </div>
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Fleet Directory</h2>
            <p>{rows.length} agents registered.</p>
          </div>
          <div className="fleet-view-toggle" role="group" aria-label="Fleet view">
            <button
              type="button"
              aria-pressed={viewMode === "table"}
              className={viewMode === "table" ? "workspace-tab active" : "workspace-tab"}
              onClick={() => setViewMode("table")}
            >
              <Layers size={14} style={{ marginRight: 6 }} /> Table View
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "swarm"}
              className={viewMode === "swarm" ? "workspace-tab active" : "workspace-tab"}
              onClick={() => setViewMode("swarm")}
            >
              <Network size={14} style={{ marginRight: 6 }} /> Card view
            </button>
          </div>
        </div>

        {viewMode === "swarm" ? (
          <AgentStatusGrid
            agents={rows}
            onInspectAgent={(addr) => setSelected(addr)}
            onProvisionAgent={() => setOnboardingOpen(true)}
          />
        ) : (
          <>
            {/* Segmented Filter Pills with Integrated Live Counters */}
            <div className="segmented-filter-pills" role="group" aria-label="Fleet quick status filters" style={{ marginBottom: "12px" }}>
              <button
                type="button"
                aria-pressed={statusFilter === "all" && sourceFilter === "all"}
                className={`segmented-filter-pill ${statusFilter === "all" && sourceFilter === "all" ? "active" : ""}`}
                onClick={() => {
                  setStatusFilter("all");
                  setSourceFilter("all");
                }}
              >
                <span>All</span>
                <span className="pill-count">{rows.length}</span>
              </button>
              <button
                type="button"
                aria-pressed={statusFilter === "active"}
                className={`segmented-filter-pill ${statusFilter === "active" ? "active" : ""}`}
                onClick={() => setStatusFilter("active")}
              >
                <span className="status-dot status-dot-success" style={{ width: 6, height: 6 }} />
                <span>Active</span>
                <span className="pill-count">{active}</span>
              </button>
              <button
                type="button"
                aria-pressed={statusFilter === "tripped"}
                className={`segmented-filter-pill ${statusFilter === "tripped" ? "active" : ""}`}
                onClick={() => setStatusFilter("tripped")}
              >
                <span className="status-dot status-dot-warning" style={{ width: 6, height: 6 }} />
                <span>Paused</span>
                <span className="pill-count">{rows.length - active}</span>
              </button>
              <button
                type="button"
                aria-pressed={sourceFilter === "sovereign"}
                className={`segmented-filter-pill ${sourceFilter === "sovereign" ? "active" : ""}`}
                onClick={() => setSourceFilter("sovereign")}
              >
                <span>Managed</span>
                <span className="pill-count">{sovereign}</span>
              </button>
            </div>

            {/* Real-time Fleet Search & Granular Filters */}
            <div className="fleet-filter-bar">
          <div className="fleet-search-box">
            <Search size={15} className="fleet-search-icon" />
            <input
              type="text"
              placeholder="Search by label or 0x address..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              aria-label="Filter fleet by agent name or address"
            />
          </div>

          <div style={{ minWidth: "160px" }}>
            <Select
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as any)}
              options={[
                { value: "all", label: "All States" },
                { value: "active", label: "Active Only" },
                { value: "tripped", label: "Tripped / Paused" },
              ]}
            />
          </div>

          <div style={{ minWidth: "180px" }}>
            <Select
              value={sourceFilter}
              onChange={(val) => setSourceFilter(val as any)}
              options={[
                { value: "all", label: "All Custody Models" },
                { value: "sovereign", label: "Secure wallet" },
                { value: "external", label: "Connected wallet" },
              ]}
            />
          </div>

          <div style={{ minWidth: "160px" }}>
            <Select
              value={riskFilter}
              onChange={(val) => setRiskFilter(val as any)}
              options={[
                { value: "all", label: "All Risk Tiers" },
                { value: "tier1_critical", label: "Tier 1 (Critical)" },
                { value: "tier2_standard", label: "Tier 2 (Standard)" },
                { value: "tier3_low", label: "Tier 3 (Low)" },
              ]}
            />
          </div>

          {hasActiveFilters && (
            <Button
              variant="tonal"
              onClick={() => {
                setSearchFilter("");
                setStatusFilter("all");
                setSourceFilter("all");
                setRiskFilter("all");
              }}
            >
              <RefreshCw size={13} style={{ marginRight: 6 }} /> Reset Filters
            </Button>
          )}
        </div>

        {/* Active Filters Pill Bar */}
        {hasActiveFilters && (
          <div className="active-filters-bar" style={{ marginTop: "8px" }}>
            <span style={{ color: "var(--muted)", fontWeight: 550, marginRight: "4px" }}>Active filters:</span>
            {searchFilter.trim() && (
              <span className="active-filter-chip">
                Search: "{searchFilter}"
                <button type="button" onClick={() => setSearchFilter("")} aria-label="Clear search">
                  <X size={12} />
                </button>
              </span>
            )}
            {statusFilter !== "all" && (
              <span className="active-filter-chip">
                State: {statusFilter === "active" ? "Active" : "Paused"}
                <button type="button" onClick={() => setStatusFilter("all")} aria-label="Clear state filter">
                  <X size={12} />
                </button>
              </span>
            )}
            {sourceFilter !== "all" && (
              <span className="active-filter-chip">
                Wallet: {sourceFilter === "sovereign" ? "Secure" : "Connected"}
                <button type="button" onClick={() => setSourceFilter("all")} aria-label="Clear custody filter">
                  <X size={12} />
                </button>
              </span>
            )}
            {riskFilter !== "all" && (
              <span className="active-filter-chip">
                Risk: {formatRiskTier(riskFilter)}
                <button type="button" onClick={() => setRiskFilter("all")} aria-label="Clear risk filter">
                  <X size={12} />
                </button>
              </span>
            )}
            <Button
              variant="text"
              style={{ fontSize: "0.74rem", padding: "2px 6px" }}
              onClick={() => {
                setSearchFilter("");
                setStatusFilter("all");
                setSourceFilter("all");
                setRiskFilter("all");
              }}
            >
              Clear all
            </Button>
          </div>
        )}

        {/* Sticky Batch Actions Command Bar */}
        {selectedAgents.size > 0 && (
          <div className="fleet-batch-bar" role="toolbar" aria-label="Batch Agent Actions">
            <div className="fleet-batch-left">
              <Badge tone="info">
                {selectedAgents.size} of {filteredRows.length} selected
              </Badge>
              <span style={{ fontSize: "0.82rem", color: "var(--on-surface)", fontWeight: 550 }}>
                Bulk Fleet Operations
              </span>
            </div>
            <div className="fleet-batch-actions">
              <Button
                variant="filled"
                className="control-critical"
                onClick={handleBatchFreeze}
                disabled={batchWorking}
                title="Pause all selected agents"
              >
                <ShieldAlert size={14} style={{ marginRight: 6 }} />
                <span>{batchWorking ? "Working…" : "Pause selected"}</span>
              </Button>
              <Button
                variant="tonal"
                onClick={handleBatchResume}
                disabled={batchWorking}
                title="Resume all selected agents"
              >
                <Activity size={14} style={{ marginRight: 6 }} />
                <span>Resume selected</span>
              </Button>
              <Button
                variant="tonal"
                onClick={handleExportJson}
                title="Export selected agents as JSON"
              >
                <Download size={14} style={{ marginRight: 6 }} />
                <span>Export JSON</span>
              </Button>
              <Button
                variant="tonal"
                onClick={handleExportCsv}
                title="Export selected agents as CSV"
              >
                <Download size={14} style={{ marginRight: 6 }} />
                <span>Export CSV</span>
              </Button>
              <button
                type="button"
                className="batch-dismiss-btn"
                onClick={() => setSelectedAgents(new Set())}
                aria-label="Clear selection"
                title="Clear selection"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  padding: "6px",
                  borderRadius: "6px",
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {query.isError ? (
          <EmptyState kind="warning" title="Fleet unavailable" detail="We couldn't load your fleet right now." />
        ) : rows.length === 0 ? (
          <EmptyState
            kind="agents"
            title="No agents registered"
            detail="Register your first agent to start enforcing spend policy."
            action={
              <Button onClick={() => setOnboardingOpen(true)}>
                <Sparkles size={14} />
                <span>Provision First Agent</span>
              </Button>
            }
          />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            kind="search"
            title="No matching agents found"
            detail="No autonomous agents match your active search and filter parameters."
            action={
              <Button
                variant="tonal"
                onClick={() => {
                  setSearchFilter("");
                  setStatusFilter("all");
                  setSourceFilter("all");
                  setRiskFilter("all");
                }}
              >
                <RefreshCw size={13} style={{ marginRight: 6 }} /> Reset Filters
              </Button>
            }
          />
        ) : (
          <TableViewport label="Agents" ref={parent}>
            <table>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th key={header.id}>
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {virtual.getVirtualItems().map((item) => {
                  const row = table.getRowModel().rows[item.index];
                  return (
                    <tr
                      key={row.id}
                      className={row.original.address === selected ? "row-selected" : undefined}
                      style={{ height: item.size, cursor: "pointer" }}
                      onClick={() => setSelected(row.original.address === selected ? null : row.original.address)}
                      tabIndex={0}
                      aria-label={`Inspect agent ${row.original.address}`}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(row.original.address === selected ? null : row.original.address);
                        }
                      }}
                    >
                      {row.getAllCells().map((cell) => (
                        <td key={cell.id}>
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableViewport>
        )}
        </>
        )}
      </Surface>
      {selectedAgent && (
        <AgentInspector
          agent={selectedAgent}
          onClose={() => setSelected(null)}
          onTripCircuit={() => void client.invalidateQueries({ queryKey: ["agents"] })}
          onPrevAgent={hasPrev ? handlePrevAgent : undefined}
          onNextAgent={hasNext ? handleNextAgent : undefined}
          currentIndex={currentIndex >= 0 ? currentIndex : undefined}
          totalCount={filteredRows.length}
        />
      )}
      <AgentOnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onSuccess={() => void client.invalidateQueries({ queryKey: ["agents"] })}
      />
    </div>
  );
}
