import React from 'react';
import { Outlet } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { AgentOnboardingModal } from './AgentOnboardingModal';
import { useDashboard } from '../../context/DashboardContext';
import { Button } from '../common/Button';

/**
 * Persistent dashboard chrome: connection/loading/error states,
 * and the onboarding modal — shared across every routed section rendered via <Outlet/>.
 */
export const DashboardShell: React.FC = () => {
  const {
    connectedUser,
    agents,
    rosterLoading,
    rosterError,
    refreshRoster,
    isOnboardingOpen,
    closeOnboarding,
    handleRegisterAgent,
  } = useDashboard();

  return (
    <div className="space-y-4">

      {!connectedUser && (
        <div className="rounded-2xl border border-warning/30 bg-warning-subtle/50 p-5 text-sm text-fg backdrop-blur-sm print:hidden">
          <p className="font-semibold">Connect Monad Wallet</p>
          <p className="text-xs text-fg-muted mt-1">
            Connect an authorized operator wallet to manage fleet policies. Live agent states, balances, and audit records derive strictly from real onchain contract evaluation.
          </p>
        </div>
      )}
      {connectedUser && rosterLoading && agents.length === 0 && (
        <div className="rounded-2xl border border-card-border bg-card/80 p-6 backdrop-blur-sm shadow-xs animate-pulse print:hidden" aria-busy="true">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">Synchronizing Autonomous Fleet State</p>
              <p className="text-xs text-fg-muted mt-0.5">Querying onchain spend limits, velocity counters, and reputation metrics from Monad node…</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="h-14 rounded-xl bg-card-muted" />
            <div className="h-14 rounded-xl bg-card-muted" />
            <div className="h-14 rounded-xl bg-card-muted" />
          </div>
        </div>
      )}
      {connectedUser && rosterError && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-danger/30 bg-danger-subtle/40 p-4 text-sm text-danger backdrop-blur-sm print:hidden" role="alert">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 shrink-0 text-danger" />
            <div>
              <p className="font-semibold text-danger">Settlement Node Synchronization Notice</p>
              <p className="text-xs text-danger/80 mt-0.5">Live node event query deferred. Agent policies continue to enforce invariants autonomously onchain.</p>
            </div>
          </div>
          <Button variant="outline-danger" size="sm" onClick={() => refreshRoster()}>Retry Sync</Button>
        </div>
      )}

      <Outlet />

      <AgentOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={closeOnboarding}
        onRegisterAgent={handleRegisterAgent}
      />
    </div>
  );
};

export default DashboardShell;
