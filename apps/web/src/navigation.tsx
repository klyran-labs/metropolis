import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Building2,
  CreditCard,
  Landmark,
  LayoutDashboard,
  ListTree,
  LogOut,
  Receipt,
  Scale,
  Settings2,
  ShieldCheck,
  UsersRound,
  Wallet,
  Sparkles,
  HelpCircle,
  PlayCircle,
  Radio,
  Store,
  CheckCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { configuration, networkLabel } from "./configuration";
import { Badge, Mono, ThemeToggle, roleLabel, truncateMiddle } from "./design-system";
import { useIdentity } from "./identity";

export type NavItemDef = {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: string;
};

export const tenantNavItems: NavItemDef[] = [
  { to: "/app/overview", label: "Overview", icon: <LayoutDashboard size={19} /> },
  { to: "/app/fleet", label: "Fleet", icon: <ListTree size={19} /> },
  { to: "/app/policy", label: "Policy", icon: <ShieldCheck size={19} /> },
  { to: "/app/simulator", label: "Simulator", icon: <PlayCircle size={19} />, badge: "Dry-Run" },
  { to: "/app/activity", label: "Activity", icon: <Radio size={19} />, badge: "Live" },
  { to: "/app/merchants", label: "Merchants", icon: <Store size={19} /> },
  { to: "/app/quorum", label: "Approvals", icon: <UsersRound size={19} /> },
  { to: "/app/treasury", label: "Treasury", icon: <Landmark size={19} /> },
  { to: "/app/billing", label: "Billing", icon: <CreditCard size={19} /> },
  { to: "/app/settings", label: "Settings", icon: <Settings2 size={19} /> },
];

export const adminNavItems: NavItemDef[] = [
  { to: "/admin/overview", label: "Overview", icon: <LayoutDashboard size={19} /> },
  { to: "/admin/tenants", label: "Tenants", icon: <Building2 size={19} /> },
  { to: "/admin/plans", label: "Plans", icon: <Scale size={19} /> },
  { to: "/admin/subscriptions", label: "Subscriptions", icon: <Receipt size={19} /> },
  { to: "/admin/billing", label: "Billing ledger", icon: <Wallet size={19} /> },
  { to: "/admin/reconciliation", label: "Reconciliation", icon: <BarChart3 size={19} /> },
  { to: "/admin/revenue", label: "Revenue", icon: <CreditCard size={19} /> },
  { to: "/admin/access", label: "Access", icon: <UsersRound size={19} /> },
];

export function SlimIconRail({
  items,
  area,
}: {
  items: NavItemDef[];
  area: "app" | "admin";
}) {
  const identity = useIdentity();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <aside className="slim-icon-rail" aria-label="Main Navigation">
      {/* Brand Mark */}
      <div className="rail-top">
        <Link to={area === "app" ? "/app/overview" : "/admin/overview"} className="rail-brand-mark" title={configuration.brand}>
          <span className="brand-letter">A</span>
        </Link>
      </div>

      {/* Primary Icon Stack */}
      <nav className="rail-nav" aria-label="Navigation Items">
        {items.map((item) => {
          const isActive = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`rail-nav-btn ${isActive ? "active" : ""}`}
              title={item.label}
              aria-label={item.label}
            >
              <span className="rail-icon-wrapper">
                {item.icon}
              </span>
              <span className="rail-tooltip">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Rail Bottom Actions */}
      <div className="rail-bottom">
        <div className="rail-action-btn" title="Theme">
          <ThemeToggle />
        </div>
        <button
          type="button"
          className="rail-nav-btn rail-logout-btn"
          onClick={() => void identity.logout()}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={17} />
          <span className="rail-tooltip">Sign out</span>
        </button>
      </div>
    </aside>
  );
}

export function SubheaderTabs({
  items,
}: {
  items: NavItemDef[];
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav className="subheader-tabs-bar" aria-label="Sub-navigation">
      <div className="subheader-tabs-list">
        {items.map((item) => {
          const isActive = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`subheader-tab-link ${isActive ? "active" : ""}`}
            >
              {item.label}
              {item.badge && <span className="tab-badge">{item.badge}</span>}
            </Link>
          );
        })}
      </div>
      <div className="subheader-epoch-info">
        <span className="epoch-pill">
          <span className="epoch-dot" />
          Live
        </span>
      </div>
    </nav>
  );
}

export function TenantNav() {
  return (
    <>
      <SlimIconRail items={tenantNavItems} area="app" />
    </>
  );
}

export function AdminNav() {
  return (
    <>
      <SlimIconRail items={adminNavItems} area="admin" />
    </>
  );
}
