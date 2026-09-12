import React from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { PolicyStudio } from './PolicyStudio';

/** /studio — PolicyStudio already renders its own "no agent selected" state. */
export const PolicyStudioView: React.FC = () => {
  const { selectedAgent, handleSavePolicy } = useDashboard();
  return <PolicyStudio agent={selectedAgent} onSavePolicy={handleSavePolicy} />;
};

export default PolicyStudioView;
