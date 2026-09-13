import React, { useEffect, useMemo } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { type Address } from 'viem';
import { Layers, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { LifecycleStudio } from './LifecycleStudio';
import { Card } from '../common/Card';
import { Button } from '../common/Button';

/**
 * /lifecycle — 100% contextual and sharable agent lifecycle command view.
 * Supports deep linking via ?agent=0x... or /lifecycle/:agentAddress.
 * Automatically synchronizes the URL search parameters whenever an agent is selected.
 */
export const LifecycleView: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ agentAddress?: string }>();
  const navigate = useNavigate();

  const {
    agents,
    selectedAgentAddress,
    setSelectedAgentAddress,
    handleSavePolicy,
    handleToggleKillSwitch,
    rosterLoading,
  } = useDashboard();

  // Target address from path param (/lifecycle/:agentAddress) or search param (?agent=0x... or ?address=0x...)
  const targetAddressRaw = params.agentAddress || searchParams.get('agent') || searchParams.get('address');
  const targetAddress = targetAddressRaw?.toLowerCase();

  // Synchronize targetAddress with context & URL
  useEffect(() => {
    if (targetAddress && targetAddress.startsWith('0x')) {
      if (selectedAgentAddress?.toLowerCase() !== targetAddress) {
        setSelectedAgentAddress(targetAddress as Address);
      }
      // If arrived via path param or missing ?agent, synchronize search params
      if (searchParams.get('agent')?.toLowerCase() !== targetAddress && !params.agentAddress) {
        setSearchParams({ agent: targetAddress }, { replace: true });
      }
    } else if (!targetAddress && agents.length > 0) {
      // If no address was specified in the URL, default to selectedAgentAddress or the first agent in the fleet
      const fallbackAddress = selectedAgentAddress || agents[0].address;
      setSelectedAgentAddress(fallbackAddress);
      setSearchParams({ agent: fallbackAddress }, { replace: true });
    }
  }, [targetAddress, agents, selectedAgentAddress, setSelectedAgentAddress, setSearchParams, params.agentAddress, searchParams]);

  // Find the agent matching targetAddress or selectedAgentAddress or agents[0]
  const currentAgent = useMemo(() => {
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

  const handleSelectAgent = (newAddress: Address) => {
    setSelectedAgentAddress(newAddress);
    setSearchParams({ agent: newAddress }, { replace: true });
  };

  // Loading state when agents are being read onchain
  if (rosterLoading && !currentAgent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3 font-sans">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-semibold text-zinc-300">
          Loading agent lifecycle telemetry from Monad...
        </p>
        <p className="text-xs text-zinc-500 font-mono">
          Querying PolicyEngine and ReputationRegistry state ledger
        </p>
      </div>
    );
  }

  // If a target address was given in the URL but not found in the monitored fleet
  if (targetAddress && !currentAgent && !rosterLoading) {
    return (
      <Card padding="lg" className="text-center font-sans border-card-border bg-card">
        <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
        <h2 className="mt-3 text-base font-bold text-fg">Agent Not Found In Monitored Fleet</h2>
        <p className="mx-auto mt-2 max-w-lg text-xs text-fg-muted leading-relaxed">
          The requested agent address <code className="text-fg font-mono bg-card-muted px-2 py-0.5 rounded border border-card-border">{targetAddressRaw}</code> has not been provisioned with onchain spend guardrails yet.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => navigate('/fleet')}>
            Back to Fleet Command
          </Button>
          {agents.length > 0 && (
            <Button variant="primary" size="sm" onClick={() => handleSelectAgent(agents[0].address)}>
              View {agents[0].name}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  // If no agents exist in the roster at all
  if (!currentAgent) {
    return (
      <Card padding="lg" className="text-center font-sans border-card-border bg-card">
        <Layers className="mx-auto h-10 w-10 text-fg-subtle" />
        <h2 className="mt-3 text-base font-semibold text-fg">No Monitored Agents Available</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">
          No autonomous agent policies are active on Monad. Register an agent to view its lifecycle, spend velocity, and cryptographic state records.
        </p>
        <div className="mt-5 flex justify-center">
          <Button variant="primary" size="sm" onClick={() => navigate('/fleet')}>
            Go to Fleet Command
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <LifecycleStudio
      agent={currentAgent}
      agents={agents}
      onSelectAgent={handleSelectAgent}
      onSavePolicy={handleSavePolicy}
      onToggleKillSwitch={handleToggleKillSwitch}
    />
  );
};

export default LifecycleView;
