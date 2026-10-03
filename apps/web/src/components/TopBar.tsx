import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Search,
  Sparkles,
  Radio,
  ChevronDown,
  User,
  LogOut,
  Plus,
  Shield,
  Bot,
  ExternalLink,
  Keyboard,
  Menu,
} from "lucide-react";
import { useIdentity } from "../identity";
import { Badge, Mono, ThemeToggle, roleLabel, truncateMiddle } from "../design-system";
import { networkLabel } from "../configuration";
import { TOGGLE_NAV_EVENT } from "../navigation";

export function TopBar({
  onOpenCommandPalette,
  onOpenCopilot,
  onOpenShortcuts,
}: {
  onOpenCommandPalette: () => void;
  onOpenCopilot: () => void;
  onOpenShortcuts?: () => void;
}) {
  const identity = useIdentity();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const isPlatformAdmin = pathname.startsWith("/admin");
  const tenantLabel = identity.tenantName || "Your workspace";
  const userLabel = identity.user?.email?.address ?? (identity.subject ? truncateMiddle(identity.subject, 10, 4) : "Operator");

  const sectionNames: Array<[string, string]> = [
    ["/admin/tenants", "Organizations"],
    ["/admin/plans", "Plans"],
    ["/admin/subscriptions", "Subscriptions"],
    ["/admin/billing", "Payments"],
    ["/admin/reconciliation", "Payment checks"],
    ["/admin/revenue", "Revenue"],
    ["/admin/access", "Team"],
    ["/admin", "Home"],
    ["/app/fleet", "Agents"],
    ["/app/policy", "Spending rules"],
    ["/app/simulator", "Test rules"],
    ["/app/activity", "Activity"],
    ["/app/merchants", "Merchants"],
    ["/app/quorum", "Approvals"],
    ["/app/treasury", "Treasury"],
    ["/app/billing", "Billing"],
    ["/app/settings", "Settings"],
  ];
  const getSectionName = () => sectionNames.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Home";
  const sectionName = getSectionName();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (workspaceRef.current && !workspaceRef.current.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="top-bar">
      {/* Left: Breadcrumbs and Workspace Context */}
      <div className="top-bar-left">
        <button
          type="button"
          className="top-bar-menu-btn"
          onClick={() => window.dispatchEvent(new Event(TOGGLE_NAV_EVENT))}
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        {identity.platformAccess ? (
          <div className="workspace-dropdown-container" ref={workspaceRef}>
            <button
              type="button"
              className="workspace-dropdown-trigger"
              onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
              aria-expanded={workspaceMenuOpen}
              title="Switch between your workspace and platform admin"
            >
              <span className="top-bar-tenant-name">{isPlatformAdmin ? "Platform" : tenantLabel}</span>
              <span className="top-bar-slash">/</span>
              <span className="top-bar-section-name">{sectionName}</span>
              <ChevronDown size={14} className={`dropdown-chevron ${workspaceMenuOpen ? "rotated" : ""}`} />
            </button>

            {workspaceMenuOpen && (
              <div className="workspace-dropdown-menu">
                <div className="dropdown-section-title">Switch to</div>
                <button
                  type="button"
                  className={`dropdown-menu-item ${!isPlatformAdmin ? "active" : ""}`}
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    navigate({ to: "/app/overview" });
                  }}
                >
                  <Bot size={15} />
                  <div className="dropdown-item-content">
                    <strong>Your workspace</strong>
                    <small>{tenantLabel} · agents, rules and money</small>
                  </div>
                </button>

                <button
                  type="button"
                  className={`dropdown-menu-item ${isPlatformAdmin ? "active" : ""}`}
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    navigate({ to: "/admin/overview" });
                  }}
                >
                  <Shield size={15} />
                  <div className="dropdown-item-content">
                    <strong>Platform admin</strong>
                    <small>Organizations, payments and plans</small>
                  </div>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="top-bar-breadcrumbs" aria-label="Where you are">
            <span className="top-bar-tenant-name">{tenantLabel}</span>
            <span className="top-bar-slash">/</span>
            <span className="top-bar-section-name">{sectionName}</span>
          </div>
        )}
      </div>

      {/* Right: Actions, Global Search, Copilot, Monad Beacon, Profile */}
      <div className="top-bar-right">
        {!isPlatformAdmin && (
          <Link to="/app/fleet" className="top-bar-primary-btn" aria-label="New agent">
            <Plus size={15} />
            <span>New agent</span>
          </Link>
        )}

        {/* Search / Command Palette Shortcut */}
        <button
          type="button"
          className="top-bar-search-btn"
          onClick={onOpenCommandPalette}
          title="Search or jump to a page (Cmd+K)"
        >
          <Search size={15} />
          <span className="search-placeholder">Search or jump to…</span>
          <kbd className="cmd-k-badge">⌘K</kbd>
        </button>

        {/* AI Copilot Quick Launcher */}
        <button
          type="button"
          className="top-bar-icon-btn copilot-trigger"
          onClick={onOpenCopilot}
          title="Ask the assistant to set up spending rules"
        >
          <Sparkles size={16} />
          <span className="copilot-pill">Assistant</span>
        </button>

        {/* Ambient Monad Finality Beacon */}
        <div className="top-bar-finality-beacon" title="Network status: live">
          <span className="beacon-radar" aria-hidden="true">
            <span className="beacon-radar-ping" />
            <span className="beacon-radar-dot" />
          </span>
          <span className="beacon-text">{networkLabel}</span>
        </div>

        {/* User Profile Menu */}
        <div className="user-dropdown-container" ref={userRef}>
          <button
            type="button"
            className="user-avatar-trigger"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-label="Account menu"
          >
            <div className="avatar-circle">
              {userLabel.slice(0, 2).toUpperCase()}
            </div>
          </button>

          {userMenuOpen && (
            <div className="user-dropdown-menu">
              <div className="user-info-header">
                <strong>{userLabel}</strong>
                <Badge tone="info">{roleLabel(identity.role)}</Badge>
              </div>
              <div className="dropdown-divider" />
              <div className="dropdown-menu-row">
                <span>Theme</span>
                <ThemeToggle />
              </div>
              {onOpenShortcuts && (
                <>
                  <div className="dropdown-divider" />
                  <button
                    type="button"
                    className="dropdown-menu-item"
                    onClick={() => {
                      setUserMenuOpen(false);
                      onOpenShortcuts();
                    }}
                    style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", background: "none", border: "none", color: "var(--on-surface)", cursor: "pointer", borderRadius: "6px" }}
                  >
                    <Keyboard size={14} />
                    <span style={{ fontSize: "0.85rem" }}>Keyboard shortcuts</span>
                    <kbd className="cmd-k-badge" style={{ marginLeft: "auto" }}>?</kbd>
                  </button>
                </>
              )}
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-signout-btn"
                onClick={() => {
                  setUserMenuOpen(false);
                  void identity.logout();
                }}
              >
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
