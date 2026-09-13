import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '../../context/DashboardContext';
import { FleetOverview } from './FleetOverview';

/**
 * /fleet — Focused Operational Fleet Command workspace.
 * Provides tenant-isolated agent table, search/filters, O(1) emergency halt controls,
 * bulk provisioning, and agent lifecycle navigation.
 */
export const FleetView: React.FC = () => {
  const navigate = useNavigate();
  const {
    agents,
    handleToggleKillSwitch,
    selectedAgentAddress,
    setSelectedAgentAddress,
    openOnboarding,
    handleBatchProvision,
  } = useDashboard();

  return (
    <div className="space-y-4">
      <FleetOverview
        agents={agents}
        onToggleKillSwitch={handleToggleKillSwitch}
        onSelectAgent={(agent) => setSelectedAgentAddress(agent.address)}
        selectedAgentAddress={selectedAgentAddress}
        onOpenOnboarding={openOnboarding}
        onBatchProvision={handleBatchProvision}
        onRunLifecycle={(agent) => {
          setSelectedAgentAddress(agent.address);
          navigate(`/lifecycle?agent=${agent.address}`);
        }}
      />
    </div>
  );
};

export default FleetView;
