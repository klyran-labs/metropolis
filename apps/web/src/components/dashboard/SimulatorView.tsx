import React from 'react';
import { Play } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { RogueAgentSimulator } from './RogueAgentSimulator';
import { Card } from '../common/Card';

/** /simulator — requires a selected agent to evaluate spend requests against its live policy. */
export const SimulatorView: React.FC = () => {
  const { selectedAgent, handleExecuteSimulation, handleToggleKillSwitch } = useDashboard();

  if (!selectedAgent) {
    return (
      <Card padding="lg" className="text-center">
        <Play className="mx-auto h-10 w-10 text-fg-subtle" />
        <h2 className="mt-3 text-base font-semibold text-fg">No agent selected</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">
          Select an agent from the Fleet view to run policy evaluations against it. Results come from a live, read-only call to PolicyEngine — nothing is simulated client-side.
        </p>
      </Card>
    );
  }

  return (
    <RogueAgentSimulator
      agent={selectedAgent}
      onExecuteSimulation={handleExecuteSimulation}
      onToggleKillSwitch={handleToggleKillSwitch}
    />
  );
};

export default SimulatorView;
