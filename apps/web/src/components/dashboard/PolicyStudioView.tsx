import React, { useEffect, useMemo } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { type Address } from 'viem';
import { useDashboard } from '../../context/DashboardContext';
import { PolicyStudio } from './PolicyStudio';

/** /studio — Policy Studio with automatic agent fallback and master-detail authoring. */
export const PolicyStudioView: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ agentAddress?: string }>();
  const { agents, selectedAgentAddress, setSelectedAgentAddress, handleSavePolicy } = useDashboard();

  const targetAddressRaw = params.agentAddress || searchParams.get('agent') || searchParams.get('address');
  const targetAddress = targetAddressRaw?.toLowerCase();

  useEffect(() => {
    if (targetAddress && targetAddress.startsWith('0x')) {
      if (selectedAgentAddress?.toLowerCase() !== targetAddress) {
        setSelectedAgentAddress(targetAddress as Address);
      }
      if (searchParams.get('agent')?.toLowerCase() !== targetAddress && !params.agentAddress) {
        setSearchParams({ agent: targetAddress }, { replace: true });
      }
    } else if (!targetAddress && agents.length > 0) {
      const fallbackAddress = selectedAgentAddress || agents[0].address;
      setSelectedAgentAddress(fallbackAddress);
      setSearchParams({ agent: fallbackAddress }, { replace: true });
    }
  }, [targetAddress, agents, selectedAgentAddress, setSelectedAgentAddress, setSearchParams, params.agentAddress, searchParams]);

  const effectiveAgent = useMemo(() => {
    if (targetAddress) {
      const match = agents.find((a) => a.address.toLowerCase() === targetAddress);
      if (match) return match;
    }
    if (selectedAgentAddress) {
      const match = agents.find((a) => a.address.toLowerCase() === selectedAgentAddress.toLowerCase());
      if (match) return match;
    }
    return agents.length > 0 ? agents[0] : null;
  }, [agents, targetAddress, selectedAgentAddress]);

  const handleSelectAgent = (addr: Address) => {
    setSelectedAgentAddress(addr);
    setSearchParams({ agent: addr }, { replace: true });
  };

  return (
    <PolicyStudio
      agent={effectiveAgent}
      agents={agents}
      onSelectAgent={handleSelectAgent}
      onSavePolicy={handleSavePolicy}
    />
  );
};

export default PolicyStudioView;
