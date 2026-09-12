import React from 'react';
import { Outlet } from 'react-router-dom';
import { Shield, ExternalLink, Plus } from 'lucide-react';
import { AgentOnboardingModal } from './AgentOnboardingModal';
import { useDashboard } from '../../context/DashboardContext';
import { MONAD_EXPLORER_URL, CONTRACT_ADDRESSES } from '../../config/contracts';
import { Button } from '../common/Button';

/**
 * Persistent dashboard chrome: the top summary bar, connection/loading/error/
 * empty states, and the onboarding modal — shared across every routed
 * section (/fleet, /lifecycle, /studio, /simulator, /audit) rendered via
 * <Outlet/>. Primary navigation itself lives in AgentGuardHeader as routed
 * pill links, not here.
 */
export const DashboardShell: React.FC = () => {
  const {
    connectedUser,
    balanceMon,
    agents,
    rosterLoading,
    rosterError,
    refreshRoster,
    isOnboardingOpen,
    openOnboarding,
    closeOnboarding,
    handleRegisterAgent,
  } = useDashboard();

  return (
    <div className="space-y-6">
      {/* Top Summary Bar */}
      <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 border-b border-card-border pb-4">
        <div>
          <h1 className="text-xl font-bold text-fg">
            AgentGuard: Agentic Risk & Spend Control Plane
          </h1>
          <p className="text-xs text-fg-muted">
            Monad Parallel EVM (Chain ID 10143) • Non-Custodial Budget Enforcement • x402 / AP2 Ready
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="rounded-xl border border-card-border bg-card px-3 py-1.5 font-mono text-xs text-fg-muted shadow-xs">
            <span>Treasury: </span>
            <span className="font-bold text-fg">{balanceMon} MON</span>
          </div>

          <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={openOnboarding}>
            Register Agent
          </Button>

          <a
            href={`${MONAD_EXPLORER_URL}/address/${CONTRACT_ADDRESSES.policyEngine}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center space-x-1 rounded-xl border border-card-border bg-card px-3 py-1.5 text-xs font-semibold text-primary shadow-xs hover:bg-card-muted"
          >
            <span>PolicyEngine on Monad</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {!connectedUser && (
        <div className="rounded-2xl border border-warning/30 bg-warning-subtle p-5 text-sm text-fg">
          Connect a Monad wallet to read or manage agent policies. No fleet, balances, reputation, or audit records are shown until an authenticated wallet and live contract state are available.
        </div>
      )}
      {connectedUser && rosterLoading && agents.length === 0 && (
        <div className="rounded-2xl border border-card-border bg-card p-5 text-sm text-fg-muted" aria-busy="true">
          Reading agent roster, policy, spend state, and reputation from Monad…
        </div>
      )}
      {connectedUser && rosterError && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-danger/30 bg-danger-subtle p-5 text-sm text-danger" role="alert">
          <span>{rosterError}</span>
          <Button variant="outline-danger" size="sm" onClick={() => refreshRoster()}>Retry</Button>
        </div>
      )}
      {connectedUser && !rosterLoading && !rosterError && agents.length === 0 && (
        <div className="rounded-2xl border border-card-border bg-card p-8 text-center">
          <Shield className="mx-auto h-10 w-10 text-fg-subtle" />
          <h2 className="mt-3 text-base font-semibold text-fg">No agent policy configured</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-fg-muted">Register an agent wallet and authorize the policy transaction. AgentGuard will show it here only after the deployed PolicyEngine confirms the write.</p>
          <Button variant="primary" size="md" className="mt-5" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={openOnboarding}>
            Register agent
          </Button>
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
