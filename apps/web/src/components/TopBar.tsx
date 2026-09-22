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
} from "lucide-react";
import { useIdentity } from "../identity";
import { Badge, Mono, ThemeToggle, roleLabel, truncateMiddle } from "../design-system";
import { networkLabel } from "../configuration";

export function TopBar({
  onOpenCommandPalette,
  onOpenCopilot,
}: {
  onOpenCommandPalette: () => void;
  onOpenCopilot: () => void;
}) {
  const identity = useIdentity();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const isPlatformAdmin = pathname.startsWith("/admin");
  const tenantLabel = identity.tenantName || "Enterprise Workspace";
  const userLabel = identity.user?.email?.address ?? (identity.subject ? truncateMiddle(identity.subject, 10, 4) : "Operator");

  const getSectionName = () => {
    if (pathname.startsWith("/admin/tenants")) return "Tenants";
    if (pathname.startsWith("/admin/plans")) return "Plans";
    if (pathname.startsWith("/admin/subscriptions")) return "Subscriptions";
    if (pathname.startsWith("/admin/billing")) return "Billing Ledger";
    if (pathname.startsWith("/admin/reconciliation")) return "Reconciliation";
    if (pathname.startsWith("/admin/revenue")) return "Revenue";
    if (pathname.startsWith("/admin/access")) return "Access Governance";
    if (pathname.startsWith("/admin")) return "Platform Administration";

    if (pathname.startsWith("/app/fleet")) return "Fleet Orchestration";
    if (pathname.startsWith("/app/policy")) return "Policy Studio";
    if (pathname.startsWith("/app/simulator")) return "Policy Simulator";
    if (pathname.startsWith("/app/activity")) return "Activity & Audit";
    if (pathname.startsWith("/app/merchants")) return "Merchant Directory";
    if (pathname.startsWith("/app/quorum")) return "Quorum Approvals";
    if (pathname.startsWith("/app/treasury")) return "Treasury & Reserves";
    if (pathname.startsWith("/app/billing")) return "Billing & Subscriptions";
    if (pathname.startsWith("/app/settings")) return "Settings & Access";
    return "Spend Operations";
  };
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
        {identity.platformAccess ? (
          <div className="workspace-dropdown-container" ref={workspaceRef}>
            <button
              type="button"
              className="workspace-dropdown-trigger"
              onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
              aria-expanded={workspaceMenuOpen}
              title="Switch Workspace Context"
            >
              <span className="top-bar-tenant-name">{isPlatformAdmin ? "Platform Operations" : tenantLabel}</span>
              <span className="top-bar-slash">/</span>
              <span className="top-bar-section-name">{sectionName}</span>
              <ChevronDown size={14} className={`dropdown-chevron ${workspaceMenuOpen ? "rotated" : ""}`} />
            </button>

            {workspaceMenuOpen && (
              <div className="workspace-dropdown-menu">
                <div className="dropdown-section-title">Switch Context</div>
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
                    <strong>Tenant Workspace</strong>
                    <small>{tenantLabel} · Autonomous fleet & policies</small>
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
                    <strong>Platform Administration</strong>
                    <small>Multi-tenant registry & global ledger</small>
                  </div>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="top-bar-breadcrumbs" aria-label="Current Workspace Location">
            <span className="top-bar-tenant-name">{tenantLabel}</span>
            <span className="top-bar-slash">/</span>
            <span className="top-bar-section-name">{sectionName}</span>
          </div>
        )}
      </div>

      {/* Right: Actions, Global Search, Copilot, Monad Beacon, Profile */}
      <div className="top-bar-right">
        {/* Quick Action Button */}
        <Link to="/app/fleet" className="top-bar-primary-btn">
          <Plus size={15} />
          <span>New Agent</span>
        </Link>

        {/* Search / Command Palette Shortcut */}
        <button
          type="button"
          className="top-bar-search-btn"
          onClick={onOpenCommandPalette}
          title="Search or run command (Cmd+K)"
        >
          <Search size={15} />
          <span className="search-placeholder">Quick search...</span>
          <kbd className="cmd-k-badge">⌘K</kbd>
        </button>

        {/* AI Copilot Quick Launcher */}
        <button
          type="button"
          className="top-bar-icon-btn copilot-trigger"
          onClick={onOpenCopilot}
          title="AI Risk Copilot"
        >
          <Sparkles size={16} />
          <span className="copilot-pill">AI Copilot</span>
        </button>

        {/* Ambient Monad Finality Beacon */}
        <div className="top-bar-finality-beacon" title="Configured Monad block cadence (400ms blocks)">
          <span className="beacon-radar" aria-hidden="true">
            <span className="beacon-radar-ping" />
            <span className="beacon-radar-dot" />
          </span>
          <span className="beacon-text">{networkLabel}</span>
          <span className="beacon-speed">400ms</span>
        </div>

        {/* User Profile Menu */}
        <div className="user-dropdown-container" ref={userRef}>
          <button
            type="button"
            className="user-avatar-trigger"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-label="User profile menu"
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
