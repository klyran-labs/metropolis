import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Command,
  Search,
  Bot,
  ShieldAlert,
  Wallet,
  Settings,
  CreditCard,
  FileText,
  Sparkles,
  ArrowRight,
  Sun,
  Moon,
  CheckCircle2,
  X,
  Radio,
} from "lucide-react";
import { useAgents, type Agent } from "./api";
import { useIdentity } from "./identity";
import { applyTheme, getStoredTheme, resolveTheme, type ThemeMode } from "./theme";
import { Mono, truncateMiddle } from "./design-system";

export interface CommandItem {
  id: string;
  category: "Navigation" | "Fleet Actions" | "AI Copilot" | "System";
  label: string;
  detail?: string;
  icon: typeof Bot;
  action: () => void;
  keywords?: string;
}

export function CommandPalette({
  open,
  onClose,
  onOpenCopilot,
}: {
  open: boolean;
  onClose: () => void;
  onOpenCopilot?: () => void;
}) {
  const navigate = useNavigate();
  const identity = useIdentity();
  const agentsQuery = useAgents(Boolean(identity.authenticated));
  const agents = agentsQuery.data ?? [];
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Commands definition
  const commands: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      // Navigation
      {
        id: "nav-overview",
        category: "Navigation",
        label: "Go to Flight Deck Overview",
        detail: "Live solvency gauge, spend velocity, and threat telemetry",
        icon: Radio,
        action: () => {
          void navigate({ to: "/app/overview" });
          onClose();
        },
        keywords: "flight deck home dashboard metrics telemetry",
      },
      {
        id: "nav-fleet",
        category: "Navigation",
        label: "Go to Fleet Operations",
        detail: "Agent data grid, session keys, and circuit breakers",
        icon: Bot,
        action: () => {
          void navigate({ to: "/app/fleet" });
          onClose();
        },
        keywords: "agents bots workers fleet operations grid",
      },
      {
        id: "nav-policy",
        category: "Navigation",
        label: "Go to Policy Engine",
        detail: "EVM risk bounds, velocity caps, and approved targets",
        icon: ShieldAlert,
        action: () => {
          void navigate({ to: "/app/policy" });
          onClose();
        },
        keywords: "policy rules spending limits caps invariants abac pbac",
      },
      {
        id: "nav-treasury",
        category: "Navigation",
        label: "Go to Treasury & Float Custody",
        detail: "Deposit capital, manage timelocked withdrawals, and relayer floats",
        icon: Wallet,
        action: () => {
          void navigate({ to: "/app/treasury" });
          onClose();
        },
        keywords: "treasury deposit withdraw usdc float custody funds",
      },
      {
        id: "nav-billing",
        category: "Navigation",
        label: "Go to Billing & Rate Cards",
        detail: "Tiered volume discounts and committed-use reservations",
        icon: CreditCard,
        action: () => {
          void navigate({ to: "/app/billing" });
          onClose();
        },
        keywords: "billing rate cards pricing subscription enterprise discount",
      },
      {
        id: "nav-settings",
        category: "Navigation",
        label: "Go to Workspace Settings",
        detail: "IAM access roles, SSO federation, and API keys",
        icon: Settings,
        action: () => {
          void navigate({ to: "/app/settings" });
          onClose();
        },
        keywords: "settings iam rbac sso scim api keys security",
      },
      // AI Copilot
      {
        id: "ai-copilot",
        category: "AI Copilot",
        label: "Launch AI Risk Copilot",
        detail: "Natural language policy compilation & denial diagnostics",
        icon: Sparkles,
        action: () => {
          onClose();
          onOpenCopilot?.();
        },
        keywords: "ai copilot assistant prompt compiler qwen claude diagnostics",
      },
      // System Theme
      {
        id: "theme-toggle",
        category: "System",
        label: "Toggle Visual Theme (Light / Dark)",
        detail: "Switch between high-contrast dark mode and daylight theme",
        icon: Sun,
        action: () => {
          const current = getStoredTheme();
          const next: ThemeMode = current === "dark" ? "light" : "dark";
          applyTheme(next);
          onClose();
        },
        keywords: "theme dark light mode color visual appearance",
      },
    ];

    // Append agent quick actions
    for (const agent of agents.slice(0, 15)) {
      list.push({
        id: `agent-${agent.address}`,
        category: "Fleet Actions",
        label: `Inspect Agent ${truncateMiddle(agent.address, 6, 4)}`,
        detail: `${agent.environment} · Risk Tier: ${agent.riskTier} · ${agent.status}`,
        icon: Bot,
        action: () => {
          void navigate({ to: "/app/fleet", search: { agent: agent.address } });
          onClose();
        },
        keywords: `agent ${agent.address} ${agent.environment} ${agent.riskTier} ${agent.status}`,
      });
    }

    return list;
  }, [agents, navigate, onClose, onOpenCopilot]);

  // Filter commands
  const filtered = useMemo(() => {
    if (!search.trim()) return commands;
    const term = search.toLowerCase();
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(term) ||
        c.detail?.toLowerCase().includes(term) ||
        c.keywords?.toLowerCase().includes(term)
    );
  }, [commands, search]);

  // Keyboard navigation inside palette
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, filtered, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div className="command-palette-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="command-palette-window" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-header">
          <Search size={18} className="command-palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Search commands, navigate screens, or inspect agents… (Esc to close)"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <kbd className="command-palette-kbd">Esc</kbd>
        </div>

        <div className="command-palette-list">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">
              <span>No matching commands found for "{search}"</span>
            </div>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  className={`command-palette-item ${isSelected ? "command-palette-item-selected" : ""}`}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="command-palette-item-icon">
                    <Icon size={16} />
                  </div>
                  <div className="command-palette-item-content">
                    <div className="command-palette-item-title">
                      <span>{item.label}</span>
                      <span className="command-palette-badge">{item.category}</span>
                    </div>
                    {item.detail ? (
                      <p className="command-palette-item-detail">{item.detail}</p>
                    ) : null}
                  </div>
                  {isSelected ? <ArrowRight size={14} className="command-palette-arrow" /> : null}
                </div>
              );
            })
          )}
        </div>

        <div className="command-palette-footer">
          <div className="command-palette-shortcuts">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Execute
            </span>
            <span>
              <kbd>Esc</kbd> Dismiss
            </span>
          </div>
          <div className="command-palette-network-tag">
            <span className="status-dot status-dot-success" />
            Monad Parallel EVM · 400ms Cadence
          </div>
        </div>
      </div>
    </div>
  );
}
