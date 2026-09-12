import React from 'react';
import { Layers } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { LifecycleStudio } from './LifecycleStudio';
import { Card } from '../common/Card';

/** /lifecycle — requires a selected agent; the fleet view is where one gets picked. */
export const LifecycleView: React.FC = () => {
  const { selectedAgent, handleSavePolicy, handleToggleKillSwitch } = useDashboard();

  if (!selectedAgent) {
    return (
      <Card padding="lg" className="text-center">
        <Layers className="mx-auto h-10 w-10 text-fg-subtle" />
        <h2 className="mt-3 text-base font-semibold text-fg">No agent selected</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">
          Select an agent from the Fleet view to inspect its lifecycle — policy, kill-switch state, and recent evaluations.
        </p>
      </Card>
    );
  }

  return (
    <LifecycleStudio agent={selectedAgent} onSavePolicy={handleSavePolicy} onToggleKillSwitch={handleToggleKillSwitch} />
  );
};

export default LifecycleView;
