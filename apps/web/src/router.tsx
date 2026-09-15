import { Outlet, createRootRoute, createRoute, createRouter, redirect, useNavigate } from "@tanstack/react-router";
import { Radio, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { configuration, networkLabel } from "./configuration";
import { useIdentity } from "./identity";
import { AdminNav, TenantNav, SubheaderTabs, tenantNavItems, adminNavItems } from "./navigation";
import { TopBar } from "./components/TopBar";
import { CommandPalette } from "./command-palette";
import { AICopilot } from "./components/AICopilot";
import { UndoToastContainer, type ToastAction } from "./components/UndoToast";
import { TenantOnboarding } from "./onboarding";
import { InlineSignIn } from "./signin";
import { AdminAccess } from "./screens/admin/Access";
import { AdminLedger } from "./screens/admin/Ledger";
import { AdminOverview } from "./screens/admin/Overview";
import { AdminPlans } from "./screens/admin/Plans";
import { AdminReconciliation } from "./screens/admin/Reconciliation";
import { AdminRevenue } from "./screens/admin/Revenue";
import { AdminSubscriptions } from "./screens/admin/Subscriptions";
import { AdminTenants } from "./screens/admin/Tenants";
import { Billing } from "./screens/tenant/Billing";
import { Fleet } from "./screens/tenant/Fleet";
import { Overview } from "./screens/tenant/Overview";
import { Policy } from "./screens/tenant/Policy";
import { Settings } from "./screens/tenant/Settings";
import { Treasury } from "./screens/tenant/Treasury";

function Landing() {
  const identity = useIdentity();
  return (
    <main className="landing">
      <div className="landing-split">
        <div className="landing-content">
          <span className="brand-mark">A</span>
          <span className="eyebrow">{identity.ready ? "Sign in to continue" : "Preparing your workspace"}</span>
          <h1>Govern autonomous spend with clear authority.</h1>
          <p>
            Private policy for your organization, verified settlement, and chain-derived evidence
            for every agent action.
          </p>
          <div className="landing-points">
            <div>
              <ShieldCheck size={18} />
              <span>Policy enforced onchain, private to your organization</span>
            </div>
            <div>
              <Wallet size={18} />
              <span>Non-custodial settlement — your private key never leaves your wallet</span>
            </div>
            <div>
              <Radio size={18} />
              <span>Live, chain-derived evidence for every agent action</span>
            </div>
          </div>
          <InlineSignIn />
          <div className="landing-trust">
            <span className="status-dot status-dot-success" />
            {networkLabel} · verified contract bytecode
          </div>
        </div>
        <div className="landing-visual" aria-hidden="true">
          <div className="landing-mock-window">
            <div className="landing-mock-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="landing-mock-stats">
              <div className="landing-mock-stat">
                <span className="stat-tile-icon accent-blue">
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <strong>Ready</strong>
                  <small>Policy posture</small>
                </div>
              </div>
              <div className="landing-mock-stat">
                <span className="stat-tile-icon accent-aqua">
                  <Radio size={16} />
                </span>
                <div>
                  <strong>Live</strong>
                  <small>Telemetry</small>
                </div>
              </div>
            </div>
            <div className="landing-mock-trend" />
            <div className="breakdown-track landing-mock-breakdown">
              <span style={{ width: "38%", background: "#2a78d6" }} />
              <span style={{ width: "26%", background: "#1baf7a" }} />
              <span style={{ width: "20%", background: "#eda100" }} />
              <span style={{ width: "16%", background: "#4a3aa7" }} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function useStalled(active: boolean, ms = 9000) {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!active) {
      setStalled(false);
      return;
    }
    const timer = window.setTimeout(() => setStalled(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return stalled;
}

function WorkspaceStatus({
  identity,
  waitingLabel,
}: {
  identity: ReturnType<typeof useIdentity>;
  waitingLabel: string;
}) {
  const waiting = identity.authenticated && (identity.membershipLoading || identity.platformAccessLoading);
  const stalled = useStalled(waiting);
  if (identity.membershipUnavailable || stalled) {
    return (
      <div className="app-loading">
        <div className="status-panel">
          <strong>{identity.membershipUnavailable ? "Your workspace could not be reached." : "This is taking longer than expected."}</strong>
          <p>
            {identity.membershipUnavailable && identity.membershipError instanceof Error
              ? identity.membershipError.message
              : "The identity service has not responded yet. You can retry or sign out and back in."}
          </p>
          <div className="status-panel-actions">
            <button type="button" className="control control-filled" onClick={identity.refreshIdentity}>
              Try again
            </button>
            <button type="button" className="control control-text" onClick={() => void identity.logout()}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <div className="app-loading">{waitingLabel}</div>;
}

function IndexScreen() {
  const identity = useIdentity();
  const navigate = useNavigate();
  useEffect(() => {
    if (!identity.ready || !identity.authenticated) return;
    if (identity.membershipLoading || identity.membershipUnavailable) return;
    navigate({ to: identity.needsOnboarding ? "/onboarding" : "/app/overview", replace: true });
  }, [
    identity.ready,
    identity.authenticated,
    identity.membershipLoading,
    identity.membershipUnavailable,
    identity.needsOnboarding,
    navigate,
  ]);
  if (identity.authenticated && (identity.membershipLoading || identity.membershipUnavailable)) {
    return <WorkspaceStatus identity={identity} waitingLabel="Loading your organization workspace…" />;
  }
  if (identity.authenticated) return null;
  return <Landing />;
}

function OnboardingScreen() {
  const identity = useIdentity();
  const navigate = useNavigate();
  useEffect(() => {
    if (!identity.ready) return;
    if (!identity.authenticated) {
      navigate({ to: "/", replace: true });
      return;
    }
    if (!identity.membershipLoading && !identity.needsOnboarding && !identity.membershipUnavailable) {
      navigate({ to: "/app/overview", replace: true });
    }
  }, [
    identity.ready,
    identity.authenticated,
    identity.membershipLoading,
    identity.needsOnboarding,
    identity.membershipUnavailable,
    navigate,
  ]);
  if (!identity.authenticated) return null;
  if (identity.membershipLoading || identity.membershipUnavailable) {
    return <WorkspaceStatus identity={identity} waitingLabel="Loading your organization workspace…" />;
  }
  if (!identity.needsOnboarding) return null;
  return <TenantOnboarding identity={identity} />;
}

function AppLayout() {
  const identity = useIdentity();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [toastActions, setToastActions] = useState<ToastAction[]>([]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleDismissToast = (id: string) => {
    setToastActions((prev) => prev.filter((a) => a.id !== id));
  };

  const handleUndoToast = (id: string) => {
    const action = toastActions.find((a) => a.id === id);
    if (action) {
      action.onUndo();
      setToastActions((prev) => prev.filter((a) => a.id !== id));
    }
  };

  useEffect(() => {
    if (!identity.ready) return;
    if (!identity.authenticated) {
      navigate({ to: "/", replace: true });
      return;
    }
    if (!identity.membershipLoading && identity.needsOnboarding) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [identity.ready, identity.authenticated, identity.membershipLoading, identity.needsOnboarding, navigate]);

  if (!identity.authenticated || identity.membershipLoading || identity.membershipUnavailable) {
    return <WorkspaceStatus identity={identity} waitingLabel="Loading your organization workspace…" />;
  }
  if (identity.needsOnboarding) return null;

  return (
    <div className="app-shell">
      <TenantNav />
      <div className="content-container">
        <TopBar
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onOpenCopilot={() => setCopilotOpen(true)}
        />
        <SubheaderTabs items={tenantNavItems} />
        <main className="content">
          <Outlet />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenCopilot={() => {
          setPaletteOpen(false);
          setCopilotOpen(true);
        }}
      />
      <AICopilot
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
      />
      <UndoToastContainer
        actions={toastActions}
        onUndo={handleUndoToast}
        onDismiss={handleDismissToast}
      />
    </div>
  );
}

function AdminLayout() {
  const identity = useIdentity();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const platformResolved = !identity.platformAccessLoading;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!identity.ready) return;
    if (!identity.authenticated) {
      navigate({ to: "/", replace: true });
      return;
    }
    if (identity.membershipLoading) return;
    if (identity.needsOnboarding) {
      navigate({ to: "/onboarding", replace: true });
      return;
    }
    if (platformResolved && !identity.platformAccess) {
      navigate({ to: "/app/overview", replace: true });
    }
  }, [
    identity.ready,
    identity.authenticated,
    identity.membershipLoading,
    identity.needsOnboarding,
    identity.platformAccess,
    platformResolved,
    navigate,
  ]);

  if (identity.authenticated && (identity.membershipLoading || identity.membershipUnavailable || !platformResolved)) {
    return <WorkspaceStatus identity={identity} waitingLabel="Loading platform administration…" />;
  }
  if (!identity.authenticated || identity.needsOnboarding || !identity.platformAccess) {
    return <div className="app-loading">Loading platform administration…</div>;
  }

  return (
    <div className="app-shell">
      <AdminNav />
      <div className="content-container">
        <TopBar
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onOpenCopilot={() => setCopilotOpen(true)}
        />
        <SubheaderTabs items={adminNavItems} />
        <main className="content">
          <Outlet />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenCopilot={() => {
          setPaletteOpen(false);
          setCopilotOpen(true);
        }}
      />
      <AICopilot
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
      />
    </div>
  );
}

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: IndexScreen });
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingScreen,
});

const appLayoutRoute = createRoute({ getParentRoute: () => rootRoute, path: "/app", component: AppLayout });
const appIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/app/overview" });
  },
});
const appOverviewRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/overview", component: Overview });
const appFleetRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/fleet", component: Fleet });
const appTreasuryRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/treasury", component: Treasury });
const appPolicyRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/policy", component: Policy });
const appBillingRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/billing", component: Billing });
const appSettingsRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/settings", component: Settings });

const adminLayoutRoute = createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: AdminLayout });
const adminIndexRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/admin/overview" });
  },
});
const adminOverviewRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/overview",
  component: AdminOverview,
});
const adminTenantsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/tenants",
  component: AdminTenants,
});
const adminPlansRoute = createRoute({ getParentRoute: () => adminLayoutRoute, path: "/plans", component: AdminPlans });
const adminSubscriptionsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/subscriptions",
  component: AdminSubscriptions,
});
const adminBillingRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/billing",
  component: AdminLedger,
});
const adminReconciliationRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/reconciliation",
  component: AdminReconciliation,
});
const adminRevenueRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/revenue",
  component: AdminRevenue,
});
const adminAccessRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/access",
  component: AdminAccess,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  appLayoutRoute.addChildren([
    appIndexRoute,
    appOverviewRoute,
    appFleetRoute,
    appTreasuryRoute,
    appPolicyRoute,
    appBillingRoute,
    appSettingsRoute,
  ]),
  adminLayoutRoute.addChildren([
    adminIndexRoute,
    adminOverviewRoute,
    adminTenantsRoute,
    adminPlansRoute,
    adminSubscriptionsRoute,
    adminBillingRoute,
    adminReconciliationRoute,
    adminRevenueRoute,
    adminAccessRoute,
  ]),
]);

export const router = createRouter({ routeTree });
