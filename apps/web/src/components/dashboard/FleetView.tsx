import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '../../context/DashboardContext';
import { FleetOverview } from './FleetOverview';
import { SpendAnalyticsPanel } from './SpendAnalyticsPanel';
import { ActivityFeed } from '../common/ActivityFeed';
import { Card } from '../common/Card';

/**
 * /fleet — the primary control-plane view. Two-column layout: fleet table +
 * real settled-spend analytics on the left, a live fleet-wide activity rail
 * on the right. Mirrors the reference dashboard's structural concept
 * (data panel + right-rail feed); every value is read from onchain state.
 */
export const FleetView: React.FC = () => {
  const navigate = useNavigate();
  const { agents, handleToggleKillSwitch, selectedAgentAddress, setSelectedAgentAddress, openOnboarding } =
    useDashboard();

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <FleetOverview
          agents={agents}
          onToggleKillSwitch={handleToggleKillSwitch}
          onSelectAgent={(agent) => setSelectedAgentAddress(agent.address)}
          selectedAgentAddress={selectedAgentAddress}
          onOpenOnboarding={openOnboarding}
          onRunLifecycle={(agent) => {
            setSelectedAgentAddress(agent.address);
            navigate('/lifecycle');
          }}
        />
        <SpendAnalyticsPanel
          agent={selectedAgentAddress}
          title={selectedAgentAddress ? undefined : 'Fleet-wide settled spend'}
        />
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <Card padding="none" className="overflow-hidden">
          <div className="border-b border-card-border px-5 py-4">
            <h2 className="text-sm font-semibold text-fg">Live policy activity</h2>
            <p className="mt-0.5 text-xs text-fg-muted">Decoded PolicyEngine events across the fleet, newest first.</p>
          </div>
          <div className="max-h-[720px] overflow-y-auto px-5 py-4">
            <ActivityFeed limit={30} emptyMessage="No policy events recorded onchain yet — this fills in as agents get registered, spend evaluated, or kill switches flipped." />
          </div>
        </Card>
      </div>
    </div>
  );
};

export default FleetView;
