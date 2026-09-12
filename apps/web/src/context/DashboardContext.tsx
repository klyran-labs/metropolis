import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { type Address } from 'viem';
import { useWeb3Wallet } from '../hooks/useWeb3Wallet';
import { useAgentRoster } from '../hooks/usePolicyEvents';
import { useFleetAgents } from '../hooks/useFleetAgents';
import { usePolicyContracts } from '../hooks/usePolicyContracts';
import { useToast } from './ToastContext';
import { type FleetAgent, type SpendPolicy, type SpendRequest, type PolicyDecision } from '@agentguard/shared-types';

export interface DashboardContextValue {
  connectedUser: Address | null;
  balanceMon: string;
  agents: FleetAgent[];
  rosterLoading: boolean;
  rosterError: string | null;
  refreshRoster: () => void;
  selectedAgentAddress: Address | null;
  setSelectedAgentAddress: (address: Address | null) => void;
  selectedAgent: FleetAgent | null;
  handleToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
  handleSavePolicy: (agentAddress: Address, policy: SpendPolicy) => Promise<void>;
  handleExecuteSimulation: (req: SpendRequest) => Promise<PolicyDecision>;
  handleRegisterAgent: (input: { name: string; role: string; policy: SpendPolicy }) => Promise<void>;
  isOnboardingOpen: boolean;
  openOnboarding: () => void;
  closeOnboarding: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { address: connectedUser, balanceMon } = useWeb3Wallet();
  const { addresses: rosterAddresses, loading: rosterFetchLoading, error: rosterError, refresh: refreshRoster } = useAgentRoster();
  const { policy: ownPolicy, setPolicyOnchain, setKillSwitchOnchain, evaluatePolicy } = usePolicyContracts(connectedUser);
  const toast = useToast();

  // The connected wallet's own policy may exist onchain a moment before the
  // getLogs-based roster scan has picked up its PolicySet event (RPC read
  // consistency lag). Always include it in the scanned set so a freshly
  // registered agent doesn't disappear from the fleet view for one refresh
  // cycle — this is a read-path merge, not fabricated data.
  const addressesToRead = useMemo(() => {
    const set = new Set(rosterAddresses.map((a) => a.toLowerCase()));
    if (connectedUser && ownPolicy) set.add(connectedUser.toLowerCase());
    return Array.from(set) as Address[];
  }, [rosterAddresses, connectedUser, ownPolicy]);

  const { agents, loading: fleetReadLoading, refresh: refreshFleet } = useFleetAgents(addressesToRead);

  const [selectedAgentAddress, setSelectedAgentAddress] = useState<Address | null>(connectedUser);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  useEffect(() => {
    setSelectedAgentAddress((prev) => prev ?? connectedUser);
  }, [connectedUser]);

  const selectedAgent = useMemo(
    () => agents.find((a) => selectedAgentAddress && a.address.toLowerCase() === selectedAgentAddress.toLowerCase()) || null,
    [agents, selectedAgentAddress]
  );

  const refresh = () => {
    refreshRoster();
    refreshFleet();
  };

  const handleToggleKillSwitch = async (agentAddress: Address, currentActive: boolean) => {
    try {
      const hash = await setKillSwitchOnchain(agentAddress, !currentActive);
      toast.success(
        !currentActive ? 'Kill switch activated' : 'Kill switch released',
        `Confirmed onchain for ${agentAddress.slice(0, 6)}…${agentAddress.slice(-4)}`,
        hash
      );
      refresh();
    } catch (err: any) {
      toast.error('Kill switch transaction failed', err?.message || 'The transaction was rejected or reverted.');
      throw err;
    }
  };

  const handleSavePolicy = async (agentAddress: Address, newPolicy: SpendPolicy) => {
    try {
      const hash = await setPolicyOnchain({ ...newPolicy, agent: agentAddress });
      toast.success('Policy confirmed onchain', `${agentAddress.slice(0, 6)}…${agentAddress.slice(-4)} updated on Monad`, hash);
      refresh();
    } catch (err: any) {
      toast.error('Policy update failed', err?.message || 'The transaction was rejected or reverted.');
      throw err;
    }
  };

  const handleExecuteSimulation = async (req: SpendRequest): Promise<PolicyDecision> => evaluatePolicy(req);

  const handleRegisterAgent = async (input: { name: string; role: string; policy: SpendPolicy }) => {
    try {
      const hash = await setPolicyOnchain(input.policy);
      toast.success('Agent provisioned', `${input.name} registered on Monad`, hash);
      setSelectedAgentAddress(input.policy.agent);
      refresh();
    } catch (err: any) {
      toast.error('Agent provisioning failed', err?.message || 'The policy transaction was rejected or reverted.');
      throw err;
    }
  };

  const value: DashboardContextValue = {
    connectedUser,
    balanceMon,
    agents,
    rosterLoading: rosterFetchLoading || fleetReadLoading,
    rosterError,
    refreshRoster: refresh,
    selectedAgentAddress,
    setSelectedAgentAddress,
    selectedAgent,
    handleToggleKillSwitch,
    handleSavePolicy,
    handleExecuteSimulation,
    handleRegisterAgent,
    isOnboardingOpen,
    openOnboarding: () => setIsOnboardingOpen(true),
    closeOnboarding: () => setIsOnboardingOpen(false),
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
};

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within a DashboardProvider');
  return ctx;
}
