import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
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
  PlayCircle,
  Store,
  UsersRound,
  Shield,
  Building2,
  Keyboard,
  type LucideIcon,
} from "lucide-react";
import { useAgents, type Agent } from "./api";
import { useIdentity } from "./identity";
import { configuration, isTenantTarget } from "./configuration";
import { applyTheme, getStoredTheme, resolveTheme, type ThemeMode } from "./theme";
import { Mono, truncateMiddle } from "./design-system";

export interface CommandItem {
  id: string;
  category: "Navigation" | "Fleet Actions" | "AI Copilot" | "System" | "Platform Admin";
  label: string;
  detail?: string;
  icon: LucideIcon;
  action: () => void;
  keywords?: string;
}

export function CommandPalette({
  open,
  onClose,
  onOpenCopilot,
  onOpenShortcuts,
}: {
  open: boolean;
  onClose: () => void;
  onOpenCopilot?: () => void;
  onOpenShortcuts?: () => void;
}) {
  const navigate = useNavigate();
  const identity = useIdentity();
  const agentsQuery = useAgents(Boolean(identity.authenticated));
  const agents = agentsQuery.data ?? [];
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input and lock body scroll on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
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
        detail: "Your agents, wallets, and pause controls",
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
        keywords: "policy rules spending limits caps abac pbac",
      },
      {
        id: "nav-simulator",
        category: "Navigation",
        label: "Go to Policy What-If Simulator",
        detail: "Try a payment against your spending rules",
        icon: PlayCircle,
        action: () => {
          void navigate({ to: "/app/simulator" });
          onClose();
        },
        keywords: "simulate dry run test sandbox spend policy invariants eval",
      },
      {
        id: "nav-activity",
        category: "Navigation",
        label: "Go to Live Spend Waterfall & Trace Explorer",
        detail: "Sub-second streaming settlement traces and failure post-mortems",
        icon: Radio,
        action: () => {
          void navigate({ to: "/app/activity" });
          onClose();
        },
        keywords: "activity waterfall traces audit logs settlement monad",
      },
      {
        id: "nav-merchants",
        category: "Navigation",
        label: "Go to Approved Merchant & Paywall Directory",
        detail: "Merchants your agents are allowed to pay",
        icon: Store,
        action: () => {
          void navigate({ to: "/app/merchants" });
          onClose();
        },
        keywords: "merchants vendors whitelist paywalls x402 ap2 anthropic openai",
      },
      {
        id: "nav-quorum",
        category: "Navigation",
        label: "Go to Approvals",
        detail: "Transfers waiting for more than one signature",
        icon: UsersRound,
        action: () => {
          void navigate({ to: "/app/quorum" });
          onClose();
        },
        keywords: "quorum approvals multisig escalation signatures consensus",
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
      // Platform Administration (Excluded in tenant packaging for zero counterparty reconnaissance)
      ...(!isTenantTarget()
        ? [
            {
              id: "nav-admin-overview",
              category: "Platform Admin" as const,
              label: "Go to Platform Administration Overview",
              detail: "Organizations, payments, and plans",
              icon: Shield,
              action: () => {
                void navigate({ to: "/admin/overview" });
                onClose();
              },
              keywords: "admin platform superadmin root overview",
            },
            {
              id: "nav-admin-tenants",
              category: "Platform Admin" as const,
              label: "Admin: Tenant Organization Registry",
              detail: "Manage tenant organizations, risk tiers, and spending authority",
              icon: Building2,
              action: () => {
                void navigate({ to: "/admin/tenants" });
                onClose();
              },
              keywords: "admin tenants organizations enterprise clients fleet",
            },
          ]
        : []),
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
      // Keyboard Shortcuts
      {
        id: "sys-shortcuts",
        category: "System",
        label: "View Keyboard Shortcuts Reference",
        detail: "Institutional hotkeys for high-velocity fleet operations",
        icon: Keyboard,
        action: () => {
          onClose();
          onOpenShortcuts?.();
        },
        keywords: "keyboard shortcuts hotkeys keys reference help legend",
      },
      // Fleet Actions
      {
        id: "action-provision-agent",
        category: "Fleet Actions",
        label: "Provision New Autonomous Agent",
        detail: "Create a new agent with its own wallet and spending limits",
        icon: Sparkles,
        action: () => {
          void navigate({ to: "/app/fleet" });
          onClose();
        },
        keywords: "provision agent create new onboard bot keypair deploy register",
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

  const modal = (
    <div
      className="command-palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Global Command Palette"
    >
      <div className="command-palette-window" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-header">
          <Search size={18} className="command-palette-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="command-palette-results"
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

        <div id="command-palette-results" className="command-palette-list" role="listbox">
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
                  id={`cmd-item-${item.id}`}
                  role="option"
                  aria-selected={isSelected}
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
                  {isSelected ? <ArrowRight size={14} className="command-palette-arrow" aria-hidden="true" /> : null}
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
            {onOpenShortcuts && (
              <button
                type="button"
                className="command-palette-shortcut-btn"
                onClick={() => {
                  onClose();
                  onOpenShortcuts();
                }}
                style={{ background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px", font: "inherit" }}
              >
                <kbd>?</kbd> Shortcuts
              </button>
            )}
          </div>
          <div className="command-palette-network-tag">
            <span className="status-dot status-dot-success" />
            Live
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}
