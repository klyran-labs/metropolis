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
  const tenantLabel = identity.tenantId ? `Org ${identity.tenantId.slice(0, 8)}` : "Organization";
  const userLabel = identity.user?.email?.address ?? (identity.subject ? truncateMiddle(identity.subject, 10, 4) : "Operator");

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
        <div className="workspace-dropdown-container" ref={workspaceRef}>
          <button
            type="button"
            className="workspace-dropdown-trigger"
            onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
            aria-expanded={workspaceMenuOpen}
          >
            <span className="top-bar-tenant-name">{tenantLabel}</span>
            <span className="top-bar-slash">/</span>
            <span className="top-bar-section-name">
              {isPlatformAdmin ? "Platform Admin" : "Spend Operations"}
            </span>
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
                  <small>Autonomous agent fleet & spend policy</small>
                </div>
              </button>

              {identity.platformAccess && (
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
              )}
            </div>
          )}
        </div>
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
        <div className="top-bar-finality-beacon" title="Live Monad Parallel EVM settlement (400ms blocks)">
          <span className="beacon-dot" />
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
