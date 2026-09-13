import React, { Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AgentGuardProvider } from './context/AgentGuardContext';
import { ToastProvider } from './context/ToastContext';
import { DashboardProvider, useDashboard } from './context/DashboardContext';
import { RbacProvider, useRbac } from './context/RbacContext';
import { publicClient } from './hooks/usePolicyEvents';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AgentGuardSidebar } from './components/navigation/AgentGuardSidebar';
import { ConsoleSkeleton } from './components/common/ConsoleSkeleton';
import { CommandPalette } from './components/common/CommandPalette';
import { AssumeRoleModal } from './components/common/AssumeRoleModal';

const DashboardShell = React.lazy(() =>
  import('./components/dashboard/AgentGuardDashboard').then((module) => ({ default: module.DashboardShell }))
);
const FleetView = React.lazy(() => import('./components/dashboard/FleetView'));
const LifecycleView = React.lazy(() => import('./components/dashboard/LifecycleView'));
const PolicyStudioView = React.lazy(() => import('./components/dashboard/PolicyStudioView'));
const SimulatorView = React.lazy(() => import('./components/dashboard/SimulatorView'));
const AuditLedgerView = React.lazy(() => import('./components/dashboard/AuditLedgerView'));
const BudgetPoolManager = React.lazy(() =>
  import('./components/dashboard/BudgetPoolManager').then((module) => ({ default: module.BudgetPoolManager }))
);
const ComplianceReportView = React.lazy(() =>
  import('./components/dashboard/ComplianceReportView').then((module) => ({ default: module.ComplianceReportView }))
);
const AccessManagementView = React.lazy(() =>
  import('./components/dashboard/AccessManagementView').then((module) => ({ default: module.AccessManagementView }))
);

const PortalLoadingFallback: React.FC = () => (
  <ConsoleSkeleton isFullApp={false} />
);

const MainLayout: React.FC = () => {
  const [isShrunk, setIsShrunk] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const { agents } = useDashboard();
  const { roleConfig, isImpersonating, exitImpersonation } = useRbac();
  const [currentBlock, setCurrentBlock] = useState<bigint | null>(null);

  const activeAgents = agents.filter((a) => a.status === 'ACTIVE').length;
  const totalAgents = agents.length;

  useEffect(() => {
    let mounted = true;
    const fetchBlock = async () => {
      try {
        const block = await publicClient.getBlockNumber();
        if (mounted) setCurrentBlock(block);
      } catch {
        // quiet fallback
      }
    };
    fetchBlock();
    const timer = setInterval(fetchBlock, 3500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    // Trigger smooth visual shrink animation right after login / mount
    const anim = requestAnimationFrame(() => {
      setIsShrunk(true);
    });
    return () => cancelAnimationFrame(anim);
  }, []);

  // Global Cmd+K Keyboard Shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-app font-sans text-fg selection:bg-primary/30 selection:text-white print:static print:h-auto print:overflow-visible print:bg-white">
      {/* Ambient background glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden hidden dark:block z-0 print:hidden">
        <div className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full bg-primary/10 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 h-[600px] w-[600px] rounded-full bg-indigo-600/10 blur-[160px]" />
        <div className="absolute -bottom-20 left-1/3 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[140px]" />
      </div>

      <a
        href="#portal-main-content"
        className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:not-sr-only rounded-xl bg-primary px-4 py-2 font-bold text-white shadow-lg focus:outline-none print:hidden"
      >
        Skip to main content
      </a>

      {/* AgentGuard 64px Left Icon Sidebar */}
      <ErrorBoundary fallbackTitle="Sidebar Alert">
        <AgentGuardSidebar onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />
      </ErrorBoundary>

      {/* Modern Minimalist Desktop Workspace:
          Left sidebar is fixed 64px (w-16) with border-r; workspace occupies lg:left-16 to right-0; footer is bottom 32px (h-8) */}
      <div
        className={`absolute z-10 overflow-y-auto overflow-x-hidden transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] print:static print:h-auto print:w-full print:overflow-visible print:bg-white print:p-0 print:m-0 ${
          isShrunk
            ? 'top-0 left-0 lg:left-16 right-0 bottom-8 bg-app-subtle'
            : 'top-0 left-0 right-0 bottom-0 bg-app'
        }`}
      >
        {/* Institutional Impersonation Banner */}
        {isImpersonating && (
          <div
            role="alert"
            className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs text-amber-300 backdrop-blur-md print:hidden"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" />
              <span className="font-bold shrink-0">Role Simulation Active:</span>
              <span className="truncate text-zinc-200">
                Viewing control plane as <strong className="text-amber-200 font-semibold">{roleConfig.label}</strong> ({roleConfig.badge}). Smart contract onchain policy invariants remain strictly enforced.
              </span>
            </div>
            <button
              type="button"
              onClick={exitImpersonation}
              className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold bg-amber-500 text-black hover:bg-amber-400 transition cursor-pointer print:hidden"
            >
              Exit Simulation
            </button>
          </div>
        )}

        <div className="mx-auto flex w-full max-w-[1540px] flex-col min-h-full p-4 print:max-w-none print:p-0 print:m-0">
          <main id="portal-main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none pb-0 print:p-0 print:m-0">
            <ErrorBoundary fallbackTitle="AgentGuard Control Plane Alert">
              <Suspense fallback={<PortalLoadingFallback />}>
                <Routes>
                  <Route element={<DashboardShell />}>
                    <Route path="/fleet" element={<FleetView />} />
                    <Route path="/pools" element={<BudgetPoolManager />} />
                    <Route path="/lifecycle" element={<LifecycleView />} />
                    <Route path="/lifecycle/:agentAddress" element={<LifecycleView />} />
                    <Route path="/studio" element={<PolicyStudioView />} />
                    <Route path="/studio/:agentAddress" element={<PolicyStudioView />} />
                    <Route path="/simulator" element={<SimulatorView />} />
                    <Route path="/audit" element={<AuditLedgerView />} />
                    <Route path="/compliance" element={<ComplianceReportView />} />
                    <Route path="/access" element={<AccessManagementView />} />
                    <Route path="/" element={<Navigate to="/fleet" replace />} />
                    <Route path="/dashboard" element={<Navigate to="/fleet" replace />} />
                    <Route path="*" element={<Navigate to="/fleet" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>

      {/* Platform Body Footer: Positioned in the 32px bottom space outside the canvas */}
      <footer
        aria-label="Platform Telemetry & Status"
        className="fixed bottom-0 left-0 lg:left-16 right-0 h-8 z-30 border-t border-card-border bg-app flex items-center justify-between px-4 sm:px-6 text-[11px] text-fg-muted select-none pointer-events-auto print:hidden"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-fg tracking-tight">AgentGuard</span>
            <span className="text-zinc-600 dark:text-zinc-600">•</span>
            <span className="text-fg-muted hidden md:inline">Programmable Spend & Risk Control</span>
            <span className="text-zinc-600 dark:text-zinc-600 hidden md:inline">•</span>
            <span className="font-medium text-primary">Monad Testnet</span>
            <span className="rounded bg-card border border-card-border px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
              10143
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-zinc-400 pl-2 border-l border-zinc-800">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-zinc-300 font-medium">
              {currentBlock !== null ? `Block #${currentBlock.toString()}` : 'Syncing...'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-sans">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="text-emerald-400 font-semibold">{activeAgents}</span>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-300">{totalAgents}</span>
            <span className="text-zinc-400 hidden sm:inline">Agents Guarded</span>
          </div>
          <span className="text-zinc-600 hidden lg:inline">•</span>
          <span className="hidden lg:inline text-zinc-400">
            <span className="text-zinc-300 font-medium">Sub-Second</span> Finality
          </span>
          <span className="text-zinc-600 hidden xl:inline">•</span>
          <span className="hidden xl:inline text-zinc-400">
            <span className="text-zinc-300 font-medium">Instant</span> Freeze
          </span>
          <span className="text-zinc-600 hidden sm:inline">•</span>
          <span className="text-zinc-400">
            <span className="text-zinc-300 font-medium">x402</span> + <span className="text-zinc-300 font-medium">AP2</span>
          </span>
        </div>
      </footer>

      {/* Global Command Palette Dialog */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />

      {/* Super Admin Role Assumption Modal */}
      <AssumeRoleModal />
    </div>
  );
};

export const AuthenticatedConsole: React.FC = () => (
  <AgentGuardProvider>
    <ToastProvider>
      <RbacProvider>
        <BrowserRouter>
          <DashboardProvider>
            <MainLayout />
          </DashboardProvider>
        </BrowserRouter>
      </RbacProvider>
    </ToastProvider>
  </AgentGuardProvider>
);

export default AuthenticatedConsole;
