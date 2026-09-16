import { Outlet, createRootRoute, createRoute, createRouter, redirect, useNavigate } from "@tanstack/react-router";
import { Layers, Radio, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { configuration, isAdminTarget, isTenantTarget, networkLabel } from "./configuration";
import { useIdentity } from "./identity";
import { AdminNav, TenantNav } from "./navigation";
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
import { PolicySimulator } from "./screens/tenant/PolicySimulator";
import { ActivityTrace } from "./screens/tenant/ActivityTrace";
import { MerchantDirectory } from "./screens/tenant/MerchantDirectory";
import { QuorumApprovals } from "./screens/tenant/QuorumApprovals";

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
