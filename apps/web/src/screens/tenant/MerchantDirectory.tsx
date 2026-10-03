import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  Store,
  ShieldCheck,
  ShieldAlert,
  Plus,
  ExternalLink,
  CheckCircle2,
  Lock,
  Bot,
  Zap,
  Tag,
  Sliders,
  DollarSign,
  Search,
  Filter,
  X,
  Copy,
} from "lucide-react";
import { isAddress } from "viem";
import { toUserFacingError, useAgents } from "../../api";
import { AgentSelect, Badge, Button, EmptyState, Mono, Select, Surface, TextField, TokenAmount, truncateMiddle, formatRiskTier } from "../../design-system";
import { useIdentity } from "../../identity";
import { useSetMerchantWhitelist, useIsMerchantWhitelisted } from "../../hooks/usePolicyContracts";

export interface MerchantEntry {
  id: string;
  name: string;
  category: "inference" | "compute" | "rpc" | "defi";
  address: string;
  endpointUrl: string;
  whitelisted: boolean;
}

const STORAGE_KEY = "agentguard_merchant_registry_v1";

function loadStoredMerchants(): MerchantEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore parsing errors
  }

  return [];
}

function saveStoredMerchants(merchants: MerchantEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merchants));
  } catch {
    // ignore storage errors
  }
}

function MerchantCard({
  merchant,
  agentAddress,
  onToggleWhitelist,
  onCopy,
  copiedAddress,
  isToggling,
}: {
  merchant: MerchantEntry;
  agentAddress?: string;
  onToggleWhitelist: (merchant: MerchantEntry) => void;
  onCopy: (addr: string) => void;
  copiedAddress: string | null;
  isToggling: boolean;
}) {
  const onchainCheck = useIsMerchantWhitelisted(
    agentAddress || "",
    merchant.address,
    Boolean(agentAddress),
  );

  const isWhitelisted = agentAddress && onchainCheck.data !== undefined
    ? Boolean(onchainCheck.data)
    : merchant.whitelisted;

  return (
    <Surface className="merchant-card">
      <div className="merchant-card-header">
        <div>
          <span className="card-kicker">{merchant.category.toUpperCase()}</span>
          <h3>{merchant.name}</h3>
        </div>
        <Badge tone={isWhitelisted ? "success" : "neutral"}>
          {isWhitelisted ? "Approved" : "Not approved"}
        </Badge>
      </div>

      <div className="merchant-address-row">
        <div className="address-copy-group">
          <Mono>{truncateMiddle(merchant.address, 10, 6)}</Mono>
          <button
            type="button"
            className={`inline-copy-btn table-copy-btn ${copiedAddress === merchant.address ? "copied-active" : ""}`}
            onClick={() => onCopy(merchant.address)}
            title="Copy merchant address"
            aria-label="Copy merchant address"
          >
            {copiedAddress === merchant.address ? (
              <>
                <CheckCircle2 size={13} className="copied-icon" />
                <span className="copied-pill-text">Copied</span>
              </>
            ) : (
              <Copy size={13} />
            )}
          </button>
        </div>
      </div>

      {merchant.endpointUrl && <p className="merchant-endpoint">{merchant.endpointUrl}</p>}

      <div className="merchant-metrics">
        <div className="merchant-metric-cell">
          <small>Status</small>
          <strong className="reputation-green">
            {isWhitelisted ? "Approved" : "Awaiting approval"}
          </strong>
        </div>
      </div>

      <div className="merchant-card-actions">
        <Button
          variant={isWhitelisted ? "tonal" : "filled"}
          onClick={() => onToggleWhitelist(merchant)}
          disabled={isToggling || !agentAddress}
        >
          {isWhitelisted ? "Remove approval" : "Approve merchant"}
        </Button>
        <Link to="/app/simulator" className="merchant-test-link">
          <span>Dry-Run in Simulator</span>
        </Link>
      </div>
    </Surface>
  );
}

export function MerchantDirectory() {
  const identity = useIdentity();
  const agentsQuery = useAgents(Boolean(identity.authenticated));
  const agents = agentsQuery.data ?? [];
  const [selectedAgentAddress, setSelectedAgentAddress] = useState<string>("");

  const [merchants, setMerchants] = useState<MerchantEntry[]>(loadStoredMerchants);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newCategory, setNewCategory] = useState<"inference" | "compute" | "rpc" | "defi">("inference");
  const [formMessage, setFormMessage] = useState("");
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAgentAddress && agents.length > 0) {
      setSelectedAgentAddress(agents[0].address);
    }
  }, [agents, selectedAgentAddress]);

  const activeAgent = useMemo(() => {
    return agents.find((a) => a.address === selectedAgentAddress) || agents[0] || null;
  }, [agents, selectedAgentAddress]);

  const setWhitelistMutation = useSetMerchantWhitelist(() => {
    setStatusMessage("Merchant list updated.");
    setTimeout(() => setStatusMessage(""), 5000);
  });

  const handleCopyAddress = (addr: string) => {
    void navigator.clipboard.writeText(addr);
    setCopiedAddress(addr);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const filteredMerchants = merchants.filter((m) => {
    if (selectedCategory !== "all" && m.category !== selectedCategory) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.address.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q)
    );
  });

  const handleToggleWhitelist = async (merchant: MerchantEntry) => {
    if (!activeAgent) {
      setStatusMessage("Choose an agent to manage its approved merchants.");
      return;
    }
    const nextAllowed = !merchant.whitelisted;
    setStatusMessage(`Updating ${truncateMiddle(merchant.address, 8, 4)}…`);
    try {
      await setWhitelistMutation.mutateAsync({
        agentAddress: activeAgent.address,
        merchantAddress: merchant.address,
        allowed: nextAllowed,
      });
      const updated = merchants.map((m) =>
        m.id === merchant.id ? { ...m, whitelisted: nextAllowed } : m,
      );
      setMerchants(updated);
      saveStoredMerchants(updated);
    } catch (err) {
      setStatusMessage(toUserFacingError(err, "The update was not completed."));
    }
  };

  const handleAddMerchant = async () => {
    setFormMessage("");
    if (!newName.trim() || !newAddress.trim()) {
      setFormMessage("Enter a merchant name and a valid address.");
      return;
    }
    if (!isAddress(newAddress.trim())) {
      setFormMessage("That address doesn't look valid.");
      return;
    }

    const newEntry: MerchantEntry = {
      id: `m-custom-${Date.now()}`,
      name: newName.trim(),
      category: newCategory,
      address: newAddress.trim(),
      endpointUrl: newEndpoint.trim(),
      whitelisted: true,
    };

    const nextList = [newEntry, ...merchants];
    setMerchants(nextList);
    saveStoredMerchants(nextList);

    if (activeAgent) {
      try {
        setStatusMessage(`Approving merchant ${truncateMiddle(newEntry.address, 8, 4)}…`);
        await setWhitelistMutation.mutateAsync({
          agentAddress: activeAgent.address,
          merchantAddress: newEntry.address,
          allowed: true,
        });
      } catch (err) {
        setStatusMessage("Merchant saved, but approval wasn't confirmed.");
      }
    }

    setNewName("");
    setNewAddress("");
    setNewEndpoint("");
    setShowAddModal(false);
  };

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Merchants</h1>
          <p>Merchants your agents are allowed to pay.</p>
        </div>
        <div className="page-heading-actions">
          <Button variant="filled" onClick={() => setShowAddModal(true)}>
            <Plus size={15} />
            <span>Add Merchant</span>
          </Button>
        </div>
      </header>

      {statusMessage && (
        <Surface className="transfer-message-banner">
          <CheckCircle2 size={16} />
          <span>{statusMessage}</span>
        </Surface>
      )}

      {/* Unified Merchant Controls Toolbar */}
      <Surface className="merchant-toolbar-card">
        {agents.length > 0 && (
          <div className="merchant-toolbar-agent-row">
            <AgentSelect
              label="Approved merchants for"
              value={selectedAgentAddress || (agents[0]?.address ?? "")}
              agents={agents}
              onChange={(val) => setSelectedAgentAddress(val)}
            />
          </div>
        )}

        <div className="activity-filter-controls">
          <div className="table-search-input">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search merchants…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="activity-type-chips">
            <button
              type="button"
              className={`activity-chip ${selectedCategory === "all" ? "active" : ""}`}
              onClick={() => setSelectedCategory("all")}
            >
              All Categories ({merchants.length})
            </button>
            <button
              type="button"
              className={`activity-chip ${selectedCategory === "inference" ? "active" : ""}`}
              onClick={() => setSelectedCategory("inference")}
            >
              AI Inference
            </button>
            <button
              type="button"
              className={`activity-chip ${selectedCategory === "compute" ? "active" : ""}`}
              onClick={() => setSelectedCategory("compute")}
            >
              Cloud & Compute
            </button>
            <button
              type="button"
              className={`activity-chip ${selectedCategory === "rpc" ? "active" : ""}`}
              onClick={() => setSelectedCategory("rpc")}
            >
              RPC & Oracles
            </button>
            <button
              type="button"
              className={`activity-chip ${selectedCategory === "defi" ? "active" : ""}`}
              onClick={() => setSelectedCategory("defi")}
            >
              DeFi Protocols
            </button>
          </div>
        </div>
      </Surface>

      {/* Merchant Grid */}
      {filteredMerchants.length > 0 ? (
        <div className="merchant-grid">
          {filteredMerchants.map((merchant) => (
            <MerchantCard
              key={merchant.id}
              merchant={merchant}
              agentAddress={activeAgent?.address}
              onToggleWhitelist={handleToggleWhitelist}
              onCopy={handleCopyAddress}
              copiedAddress={copiedAddress}
              isToggling={setWhitelistMutation.isPending}
            />
          ))}
        </div>
      ) : (
        <Surface>
          <EmptyState kind="agents"
            title="No merchants yet"
            detail="Add the first merchant your agents are allowed to pay."
          />
        </Surface>
      )}

      {/* Add Merchant Modal */}
      {showAddModal && (
        <div className="inspector-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="custom-modal-card" onClick={(e) => e.stopPropagation()}>
            <header className="custom-modal-head">
              <div className="modal-title-group">
                <Store size={20} />
                <div>
                  <h3>Add a merchant</h3>
                  <small>Allow your agents to pay this merchant</small>
                </div>
              </div>
              <button
                type="button"
                className="inspector-close-btn"
                onClick={() => setShowAddModal(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </header>

            <div className="custom-modal-body">
              <TextField
                label="Merchant name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Together AI GPU Cluster"
              />

              <TextField
                label="Merchant payment address"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="0x..."
              />

              <TextField
                label="Website or service address (optional)"
                value={newEndpoint}
                onChange={(e) => setNewEndpoint(e.target.value)}
                placeholder="https://api.vendor.com/v1/service"
              />

              <Select
                label="Category"
                value={newCategory}
                onChange={(val) => setNewCategory(val as any)}
                options={[
                  { value: "inference", label: "AI Inference (LLM / Embeddings)" },
                  { value: "compute", label: "Cloud & Compute Infrastructure" },
                  { value: "rpc", label: "RPC Nodes & Oracles" },
                  { value: "defi", label: "DeFi & DEX Execution" },
                ]}
              />

              {formMessage && <p className="form-message">{formMessage}</p>}
            </div>

            <footer className="custom-modal-footer">
              <Button variant="text" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button
                variant="filled"
                onClick={handleAddMerchant}
                disabled={setWhitelistMutation.isPending}
              >
                {setWhitelistMutation.isPending ? "Broadcasting…" : "Register & Whitelist onchain"}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
