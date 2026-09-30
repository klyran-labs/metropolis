import { Outlet, createRootRoute, createRoute, createRouter, redirect, useNavigate } from "@tanstack/react-router";
import { Layers, Radio, ShieldCheck, Wallet, Zap } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { configuration, isAdminTarget, isTenantTarget, networkLabel } from "./configuration";
import { useIdentity } from "./identity";
import { AdminNav, TenantNav } from "./navigation";
import { TopBar } from "./components/TopBar";
import { CommandPalette } from "./command-palette";
import { AICopilot } from "./components/AICopilot";
import { ToastProvider } from "./components/UndoToast";
import { KeyboardShortcutsModal } from "./components/KeyboardShortcutsModal";
import { TenantOnboarding } from "./onboarding";
import { InlineSignIn } from "./signin";

const AdminAccess = lazy(() => import("./screens/admin/Access").then(({ AdminAccess }) => ({ default: AdminAccess })));
const AdminLedger = lazy(() => import("./screens/admin/Ledger").then(({ AdminLedger }) => ({ default: AdminLedger })));
const AdminOverview = lazy(() => import("./screens/admin/Overview").then(({ AdminOverview }) => ({ default: AdminOverview })));
const AdminPlans = lazy(() => import("./screens/admin/Plans").then(({ AdminPlans }) => ({ default: AdminPlans })));
const AdminReconciliation = lazy(() => import("./screens/admin/Reconciliation").then(({ AdminReconciliation }) => ({ default: AdminReconciliation })));
const AdminRevenue = lazy(() => import("./screens/admin/Revenue").then(({ AdminRevenue }) => ({ default: AdminRevenue })));
const AdminSubscriptions = lazy(() => import("./screens/admin/Subscriptions").then(({ AdminSubscriptions }) => ({ default: AdminSubscriptions })));
const AdminTenants = lazy(() => import("./screens/admin/Tenants").then(({ AdminTenants }) => ({ default: AdminTenants })));
const Billing = lazy(() => import("./screens/tenant/Billing").then(({ Billing }) => ({ default: Billing })));
const Fleet = lazy(() => import("./screens/tenant/Fleet").then(({ Fleet }) => ({ default: Fleet })));
const Overview = lazy(() => import("./screens/tenant/Overview").then(({ Overview }) => ({ default: Overview })));
const Policy = lazy(() => import("./screens/tenant/Policy").then(({ Policy }) => ({ default: Policy })));
const Settings = lazy(() => import("./screens/tenant/Settings").then(({ Settings }) => ({ default: Settings })));
const Treasury = lazy(() => import("./screens/tenant/Treasury").then(({ Treasury }) => ({ default: Treasury })));
const PolicySimulator = lazy(() => import("./screens/tenant/PolicySimulator").then(({ PolicySimulator }) => ({ default: PolicySimulator })));
const ActivityTrace = lazy(() => import("./screens/tenant/ActivityTrace").then(({ ActivityTrace }) => ({ default: ActivityTrace })));
const MerchantDirectory = lazy(() => import("./screens/tenant/MerchantDirectory").then(({ MerchantDirectory }) => ({ default: MerchantDirectory })));
const QuorumApprovals = lazy(() => import("./screens/tenant/QuorumApprovals").then(({ QuorumApprovals }) => ({ default: QuorumApprovals })));

function Landing() {
  const identity = useIdentity();
  return (
    <main className="landing">
      <div className="landing-split">
        {/* Left Side: Brand, Mission & Live Telemetry Showcase */}
        <div className="landing-hero">
          <div className="landing-brand-row">
            <span className="brand-mark">A</span>
            <div className="landing-brand-meta">
              <span className="landing-brand-name">{configuration.brand}</span>
              <span className="landing-brand-tag">Autonomous Spend Guard</span>
            </div>
          </div>

          <div className="landing-hero-headline">
            <span className="eyebrow">
              {identity.ready ? "Enterprise Spend Governance" : "Preparing Workspace"}
            </span>
            <h1>Govern autonomous spend with clear authority.</h1>
            <p>
              Private policy for your organization, verified onchain settlement, and chain-derived
              evidence for every autonomous agent execution.
            </p>
          </div>

          <div className="landing-pillars">
            <div className="landing-pillar-card">
              <div className="pillar-icon-box accent-blue">
                <ShieldCheck size={18} />
              </div>
              <div className="pillar-content">
                <strong>Sub-Millisecond Policy Engine</strong>
                <p>Disjoint storage slot partitioning on Monad Parallel EVM eliminates write-lock contention.</p>
              </div>
            </div>

            <div className="landing-pillar-card">
              <div className="pillar-icon-box accent-amber">
                <Zap size={18} />
              </div>
              <div className="pillar-content">
                <strong>O(1) Instant Kill-Switch</strong>
                <p>Zero-allocation emergency circuit breaker halts compromised agents instantly.</p>
              </div>
            </div>

            <div className="landing-pillar-card">
              <div className="pillar-icon-box accent-aqua">
                <Wallet size={18} />
              </div>
              <div className="pillar-content">
                <strong>Non-Custodial Enclave Settlement</strong>
                <p>Autonomous agent keypairs sealed in sovereign vaults — private keys never leave local custody.</p>
              </div>
            </div>

            <div className="landing-pillar-card">
              <div className="pillar-icon-box accent-purple">
                <Layers size={18} />
              </div>
              <div className="pillar-content">
                <strong>Cryptographic Evidence Trail</strong>
                <p>Machine-readable onchain reason codes (ERR_NONE through ERR_SIGNATURE_INVALID) for all intents.</p>
              </div>
            </div>
          </div>

          <div className="landing-telemetry-bar">
            <div className="landing-telemetry-item">
              <div className="landing-telemetry-status">
                <span className="status-dot status-dot-success" />
                <span className="telemetry-label">{networkLabel}</span>
              </div>
              <span className="telemetry-sub">Chain ID 10143</span>
            </div>
            <div className="landing-telemetry-divider" />
            <div className="landing-telemetry-item">
              <span className="telemetry-metric">400ms</span>
              <span className="telemetry-sub">Block Finality</span>
            </div>
            <div className="landing-telemetry-divider" />
            <div className="landing-telemetry-item">
              <span className="telemetry-metric">O(1)</span>
              <span className="telemetry-sub">Emergency Freeze</span>
            </div>
            <div className="landing-telemetry-divider" />
            <div className="landing-telemetry-item">
              <span className="telemetry-metric">EIP-712</span>
              <span className="telemetry-sub">Intent Auth</span>
            </div>
          </div>
        </div>

        {/* Right Side: Redesigned Enterprise Authentication Panel */}
        <div className="landing-auth-panel">
          <InlineSignIn />
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
    const destination = configuration.appTarget === "admin"
      ? "/admin/overview"
      : identity.needsOnboarding
        ? "/onboarding"
        : "/app/overview";
    navigate({ to: destination, replace: true });
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (
        event.key === "?" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName)
      ) {
        event.preventDefault();
        setShortcutsOpen((prev) => !prev);
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
    if (!identity.membershipLoading && identity.needsOnboarding) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [identity.ready, identity.authenticated, identity.membershipLoading, identity.needsOnboarding, navigate]);

  if (!identity.authenticated || identity.membershipLoading || identity.membershipUnavailable) {
    return <WorkspaceStatus identity={identity} waitingLabel="Loading your organization workspace…" />;
  }
  if (identity.needsOnboarding) return null;

  return (
    <ToastProvider>
      <div className="app-shell">
        <TenantNav />
        <div className="content-container">
          <TopBar
            onOpenCommandPalette={() => setPaletteOpen(true)}
            onOpenCopilot={() => setCopilotOpen(true)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
          <main className="content">
            <Suspense fallback={<div className="app-loading">Loading workspace…</div>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onOpenCopilot={() => {
            setPaletteOpen(false);
            setCopilotOpen(true);
          }}
          onOpenShortcuts={() => {
            setPaletteOpen(false);
            setShortcutsOpen(true);
          }}
        />
        <AICopilot
          open={copilotOpen}
          onClose={() => setCopilotOpen(false)}
        />
        <KeyboardShortcutsModal
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
      </div>
    </ToastProvider>
  );
}

function AdminLayout() {
  const identity = useIdentity();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const platformResolved = !identity.platformAccessLoading;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (
        event.key === "?" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName)
      ) {
        event.preventDefault();
        setShortcutsOpen((prev) => !prev);
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
    <ToastProvider>
      <div className="app-shell">
        <AdminNav />
        <div className="content-container">
          <TopBar
            onOpenCommandPalette={() => setPaletteOpen(true)}
            onOpenCopilot={() => setCopilotOpen(true)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
          <main className="content">
            <Suspense fallback={<div className="app-loading">Loading administration…</div>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onOpenCopilot={() => {
            setPaletteOpen(false);
            setCopilotOpen(true);
          }}
          onOpenShortcuts={() => {
            setPaletteOpen(false);
            setShortcutsOpen(true);
          }}
        />
        <AICopilot
          open={copilotOpen}
          onClose={() => setCopilotOpen(false)}
        />
        <KeyboardShortcutsModal
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
      </div>
    </ToastProvider>
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
const appSimulatorRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/simulator", component: PolicySimulator });
const appActivityRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/activity", component: ActivityTrace });
const appMerchantsRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/merchants", component: MerchantDirectory });
const appQuorumRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/quorum", component: QuorumApprovals });
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

const appRoutes = [
  appIndexRoute,
  appOverviewRoute,
  appFleetRoute,
  appPolicyRoute,
  appSimulatorRoute,
  appActivityRoute,
  appMerchantsRoute,
  appQuorumRoute,
  appTreasuryRoute,
  appBillingRoute,
  appSettingsRoute,
];

const adminRoutes = [
  adminIndexRoute,
  adminOverviewRoute,
  adminTenantsRoute,
  adminPlansRoute,
  adminSubscriptionsRoute,
  adminBillingRoute,
  adminReconciliationRoute,
  adminRevenueRoute,
  adminAccessRoute,
];

// Target-partitioned route assembly (Principle of Least Privilege)
const routeTree = isTenantTarget()
  ? rootRoute.addChildren([
      indexRoute,
      onboardingRoute,
      appLayoutRoute.addChildren(appRoutes),
    ])
  : isAdminTarget()
    ? rootRoute.addChildren([
        indexRoute,
        onboardingRoute,
        adminLayoutRoute.addChildren(adminRoutes),
      ])
    : rootRoute.addChildren([
        indexRoute,
        onboardingRoute,
        appLayoutRoute.addChildren(appRoutes),
        adminLayoutRoute.addChildren(adminRoutes),
      ]);

export const router = createRouter({ routeTree });
