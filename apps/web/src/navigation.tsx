import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  Building2,
  CheckCheck,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Home,
  Landmark,
  PlayCircle,
  Receipt,
  ReceiptText,
  Scale,
  Settings2,
  ShieldCheck,
  ShieldQuestion,
  Store,
  TrendingUp,
  UsersRound,
  X,
} from "lucide-react";
import { configuration } from "./configuration";
import { useIdentity } from "./identity";

export type NavItemDef = {
  to: string;
  label: string;
  icon: ReactNode;
  hint?: string;
};

export type NavGroupDef = {
  label?: string;
  items: NavItemDef[];
};

const ICON = 18;

export const tenantNavGroups: NavGroupDef[] = [
  {
    items: [{ to: "/app/overview", label: "Home", icon: <Home size={ICON} />, hint: "Your agents and spending at a glance" }],
  },
  {
    label: "Agents",
    items: [
      { to: "/app/fleet", label: "Agents", icon: <Bot size={ICON} />, hint: "Create, pause and manage agents" },
      { to: "/app/merchants", label: "Merchants", icon: <Store size={ICON} />, hint: "Who your agents may pay" },
    ],
  },
  {
    label: "Spending",
    items: [
      { to: "/app/policy", label: "Spending rules", icon: <ShieldCheck size={ICON} />, hint: "Limits and safety controls" },
      { to: "/app/simulator", label: "Test rules", icon: <PlayCircle size={ICON} />, hint: "Try a payment before it's real" },
      { to: "/app/quorum", label: "Approvals", icon: <CheckCheck size={ICON} />, hint: "Transfers that need a signature" },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/app/treasury", label: "Treasury", icon: <Landmark size={ICON} />, hint: "Wallets and funding" },
      { to: "/app/billing", label: "Billing", icon: <CreditCard size={ICON} />, hint: "Your plan and receipts" },
    ],
  },
  {
    label: "Insights",
    items: [{ to: "/app/activity", label: "Activity", icon: <Activity size={ICON} />, hint: "Every payment and why" }],
  },
];

export const tenantFooterItems: NavItemDef[] = [
  { to: "/app/settings", label: "Settings", icon: <Settings2 size={ICON} />, hint: "Team, access and pricing" },
];

export const adminNavGroups: NavGroupDef[] = [
  {
    items: [{ to: "/admin/overview", label: "Home", icon: <Home size={ICON} />, hint: "Platform at a glance" }],
  },
  {
    label: "Customers",
    items: [
      { to: "/admin/tenants", label: "Organizations", icon: <Building2 size={ICON} />, hint: "Add and manage customers" },
      { to: "/admin/subscriptions", label: "Subscriptions", icon: <Receipt size={ICON} />, hint: "Who is on which plan" },
    ],
  },
  {
    label: "Revenue",
    items: [
      { to: "/admin/plans", label: "Plans", icon: <Scale size={ICON} />, hint: "Pricing tiers" },
      { to: "/admin/billing", label: "Payments", icon: <ReceiptText size={ICON} />, hint: "Every payment and refund" },
      { to: "/admin/reconciliation", label: "Payment checks", icon: <ShieldQuestion size={ICON} />, hint: "Anything that needs review" },
      { to: "/admin/revenue", label: "Revenue", icon: <TrendingUp size={ICON} />, hint: "Revenue over time" },
    ],
  },
];

export const adminFooterItems: NavItemDef[] = [
  { to: "/admin/access", label: "Team", icon: <UsersRound size={ICON} />, hint: "Who can manage the platform" },
];

export const tenantNavItems: NavItemDef[] = [...tenantNavGroups.flatMap((g) => g.items), ...tenantFooterItems];
export const adminNavItems: NavItemDef[] = [...adminNavGroups.flatMap((g) => g.items), ...adminFooterItems];

export const TOGGLE_NAV_EVENT = "agentguard:toggle-nav";

const COLLAPSE_KEY = "agentguard-sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    // storage unavailable; collapsed state just won't persist
  }
}

function NavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItemDef;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = pathname.startsWith(item.to);
  return (
    <Link
      to={item.to}
      className={`sidebar-link ${isActive ? "active" : ""}`}
      aria-current={isActive ? "page" : undefined}
      title={collapsed ? item.label : item.hint}
      onClick={onNavigate}
    >
      <span className="sidebar-link-icon">{item.icon}</span>
      <span className="sidebar-link-label">{item.label}</span>
    </Link>
  );
}

function Sidebar({
  groups,
  footerItems,
  area,
  contextLabel,
}: {
  groups: NavGroupDef[];
  footerItems: NavItemDef[];
  area: "app" | "admin";
  contextLabel: string;
}) {
  const identity = useIdentity();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const toggle = () => setDrawerOpen((open) => !open);
    window.addEventListener(TOGGLE_NAV_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_NAV_EVENT, toggle);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  };

  const workspaceName = area === "app" ? identity.tenantName || "Your workspace" : "Platform";

  return (
    <>
      {drawerOpen && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <aside
        className={`sidebar ${collapsed ? "is-collapsed" : ""} ${drawerOpen ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <Link
            to={area === "app" ? "/app/overview" : "/admin/overview"}
            className="sidebar-brand"
            title={configuration.brand}
          >
            <span className="rail-brand-mark">
              <span className="brand-letter">A</span>
            </span>
            <span className="sidebar-brand-text">
              <strong>{configuration.brand}</strong>
              <small>{workspaceName}</small>
            </span>
          </Link>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label={contextLabel}>
          {groups.map((group, index) => (
            <div className="sidebar-group" key={group.label ?? `group-${index}`}>
              {group.label && <div className="sidebar-group-label">{group.label}</div>}
              {group.items.map((item) => (
                <NavLink key={item.to} item={item} collapsed={collapsed} onNavigate={() => setDrawerOpen(false)} />
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {footerItems.map((item) => (
            <NavLink key={item.to} item={item} collapsed={collapsed} onNavigate={() => setDrawerOpen(false)} />
          ))}
          <button
            type="button"
            className="sidebar-link sidebar-collapse-btn"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu" : "Collapse menu"}
          >
            <span className="sidebar-link-icon">
              {collapsed ? <ChevronsRight size={ICON} /> : <ChevronsLeft size={ICON} />}
            </span>
            <span className="sidebar-link-label">Collapse</span>
          </button>
        </div>
      </aside>
    </>
  );
}

export function TenantNav() {
  return <Sidebar groups={tenantNavGroups} footerItems={tenantFooterItems} area="app" contextLabel="Workspace" />;
}

export function AdminNav() {
  return <Sidebar groups={adminNavGroups} footerItems={adminFooterItems} area="admin" contextLabel="Platform" />;
}
