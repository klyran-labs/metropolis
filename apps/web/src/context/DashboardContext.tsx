import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { type FleetAgent, type SpendPolicy, type SpendRequest, type PolicyDecision, type BudgetPool } from '@agentguard/shared-types';
import { type Address, type Hash, parseEther } from 'viem';
import { useAgentRoster } from '../hooks/usePolicyEvents';
import { useFleetAgents } from '../hooks/useFleetAgents';
import { usePolicyContracts } from '../hooks/usePolicyContracts';
import { useWeb3Wallet } from '../hooks/useWeb3Wallet';
import { useToast } from './ToastContext';
import { useRbac } from './RbacContext';
import { getUserProvisionedAgents, addUserProvisionedAgent, saveAgentCredentials } from '../utils/agentVault';
import knownAgents from '@deployments/monad-testnet/agents.json';

export type FleetScope = 'my_agents' | 'network';

export interface SimulatedAuditRecord {
  id: string;
  txHash?: `0x${string}`;
  agent: Address;
  merchant: Address;
  amountWei: bigint;
  decision: PolicyDecision;
  timestamp: bigint;
  simulated: boolean;
}

export interface DashboardContextValue {
  connectedUser: Address | null;
  balanceMon: string;
  agents: FleetAgent[];
  allNetworkAgents: FleetAgent[];
  fleetScope: FleetScope;
  setFleetScope: (scope: FleetScope) => void;
  myAgentsCount: number;
  totalNetworkAgentsCount: number;
  budgetPools: BudgetPool[];
  rosterLoading: boolean;
  rosterError: string | null;
  refreshRoster: () => void;
  selectedAgentAddress: Address | null;
  setSelectedAgentAddress: (address: Address | null) => void;
  selectedAgent: FleetAgent | null;
  handleToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
  handleSavePolicy: (agentAddress: Address, policy: SpendPolicy) => Promise<void>;
  handleExecuteSimulation: (req: SpendRequest) => Promise<PolicyDecision>;
  handleRegisterAgent: (input: { name: string; role: string; policy: SpendPolicy; privateKey?: `0x${string}`; saveToVault?: boolean }) => Promise<void>;
  handleBatchProvision: (count: number) => Promise<void>;
  handleCreateBudgetPool: (poolId: Hash, orgId: Hash, name: string, totalBudget: bigint, windowSeconds: number) => Promise<void>;
  handleAssignAgentToPool: (agent: Address, poolId: Hash) => Promise<void>;
  simulatedRecords: SimulatedAuditRecord[];
  addSimulatedRecord: (rec: SimulatedAuditRecord) => void;
  isOnboardingOpen: boolean;
  openOnboarding: () => void;
  closeOnboarding: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { address: connectedUser, balanceMon } = useWeb3Wallet();
  const { addresses: rosterAddresses, loading: rosterFetchLoading, error: rosterError, refresh: refreshRoster } = useAgentRoster();
  const {
    policy: ownPolicy,
    setPolicyOnchain,
    batchSetPoliciesOnchain,
    createBudgetPoolOnchain,
    assignAgentToPoolOnchain,
    getBudgetPool,
    setKillSwitchOnchain,
    evaluatePolicy,
  } = usePolicyContracts(connectedUser);
  const toast = useToast();
  const { role } = useRbac();
  const [fleetScope, setFleetScope] = useState<FleetScope>('my_agents');

  // Load user's provisioned agents from vault / localStorage
  const [provisionedAddresses, setProvisionedAddresses] = useState<Address[]>(() => {
    return getUserProvisionedAgents(connectedUser);
  });

  useEffect(() => {
    if (connectedUser) {
      const stored = getUserProvisionedAgents(connectedUser);
      setProvisionedAddresses((prev) => {
        const set = new Set([...prev.map((a) => a.toLowerCase()), ...stored.map((a) => a.toLowerCase())]);
        return Array.from(set) as Address[];
      });
    }
  }, [connectedUser]);

  const [budgetPools, setBudgetPools] = useState<BudgetPool[]>([]);
  const [simulatedRecords, setSimulatedRecords] = useState<SimulatedAuditRecord[]>([]);

  const [selectedAgentAddress, setSelectedAgentAddress] = useState<Address | null>(connectedUser);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  useEffect(() => {
    setSelectedAgentAddress((prev) => prev ?? connectedUser);
  }, [connectedUser]);

  // The connected wallet's own policy or newly provisioned addresses may exist onchain
  // a moment before getLogs indexing catches up.
  const addressesToRead = useMemo(() => {
    const set = new Set(rosterAddresses.map((a) => a.toLowerCase()));
    if (connectedUser && ownPolicy) set.add(connectedUser.toLowerCase());
    provisionedAddresses.forEach((a) => set.add(a.toLowerCase()));
    if (selectedAgentAddress && selectedAgentAddress.startsWith('0x')) {
      set.add(selectedAgentAddress.toLowerCase());
    }
    if (Array.isArray(knownAgents)) {
      knownAgents.forEach((a: any) => {
        if (a.address) set.add(a.address.toLowerCase());
      });
    }
    return Array.from(set) as Address[];
  }, [rosterAddresses, connectedUser, ownPolicy, provisionedAddresses, selectedAgentAddress]);

  const { agents: allNetworkAgents, loading: fleetReadLoading, refresh: refreshFleet } = useFleetAgents(addressesToRead);

  // Scoped agents under Principle of Least Privilege:
  // In 'my_agents' mode, display strictly the connected user's own address + provisioned agents
  const myAgents = useMemo(() => {
    const myAddresses = new Set<string>();
    if (connectedUser) myAddresses.add(connectedUser.toLowerCase());
    provisionedAddresses.forEach((a) => myAddresses.add(a.toLowerCase()));

    return allNetworkAgents.filter((a) => myAddresses.has(a.address.toLowerCase()));
  }, [allNetworkAgents, connectedUser, provisionedAddresses]);

  const activeAgents = fleetScope === 'my_agents' ? myAgents : allNetworkAgents;
  const myAgentsCount = myAgents.length;
  const totalNetworkAgentsCount = allNetworkAgents.length;

  const selectedAgent = useMemo(() => {
    if (selectedAgentAddress) {
      const match = activeAgents.find((a) => a.address.toLowerCase() === selectedAgentAddress.toLowerCase());
      if (match) return match;
    }
    return activeAgents[0] || null;
  }, [activeAgents, selectedAgentAddress]);

  const refresh = useCallback(() => {
    refreshRoster();
    refreshFleet();
  }, [refreshRoster, refreshFleet]);

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

  const addSimulatedRecord = useCallback((rec: SimulatedAuditRecord) => {
    setSimulatedRecords((prev) => [rec, ...prev].slice(0, 200));
  }, []);

  const handleExecuteSimulation = async (req: SpendRequest): Promise<PolicyDecision> => {
    const decision = await evaluatePolicy(req);
    addSimulatedRecord({
      id: `sim-${Date.now()}-${Math.floor(Number(req.nonce))}`,
      agent: req.agent,
      merchant: req.merchant,
      amountWei: req.amount,
      decision,
      timestamp: req.timestamp,
      simulated: true,
    });
    return decision;
  };

  const handleRegisterAgent = async (input: {
    name: string;
    role: string;
    policy: SpendPolicy;
    privateKey?: `0x${string}`;
    saveToVault?: boolean;
  }) => {
    try {
      const hash = await setPolicyOnchain(input.policy);
      toast.success('Agent provisioned', `${input.name} registered on Monad`, hash);
      if (connectedUser) {
        addUserProvisionedAgent(connectedUser, input.policy.agent);
        if (input.saveToVault && input.privateKey) {
          saveAgentCredentials(connectedUser, {
            address: input.policy.agent,
            name: input.name,
            role: input.role,
            privateKey: input.privateKey,
            createdAt: new Date().toISOString(),
          });
        }
      }
      setProvisionedAddresses((prev) => Array.from(new Set([...prev, input.policy.agent])));
      setSelectedAgentAddress(input.policy.agent);
      setFleetScope('my_agents');
      refresh();
    } catch (err: any) {
      toast.error('Agent provisioning failed', err?.message || 'The policy transaction was rejected or reverted.');
      throw err;
    }
  };

  const handleBatchProvision = async (count = 20) => {
    try {
      const demoAgents: Address[] = [];
      const demoPolicies: SpendPolicy[] = [];
      // Deterministically derive 20-50 real agent addresses based on connected user
      const basePrefix = (connectedUser || '0x1014300000000000000000000000000000000000').slice(0, 36);
      for (let i = 1; i <= count; i++) {
        const suffix = i.toString(16).padStart(4, '0');
        const agentAddr = `${basePrefix}${suffix}`.toLowerCase() as Address;
        demoAgents.push(agentAddr);
        demoPolicies.push({
          agent: agentAddr,
          maxPerTx: parseEther('0.5'),
          maxPerWindow: parseEther('2.5'),
          windowSeconds: 3600,
          maxVelocity: 5,
          killSwitch: false,
          whitelistEnabled: false,
        });
      }

      const hash = await batchSetPoliciesOnchain(demoAgents, demoPolicies);
      toast.success(
        `Fleet provisioned: ${count} agents`,
        `Batch onchain registration confirmed on Monad Parallel EVM`,
        hash
      );
      if (connectedUser) {
        demoAgents.forEach((a) => addUserProvisionedAgent(connectedUser, a));
      }
      setProvisionedAddresses((prev) => Array.from(new Set([...prev, ...demoAgents])));
      refresh();
    } catch (err: any) {
      toast.error('Batch provisioning failed', err?.message || 'The batch transaction failed.');
      throw err;
    }
  };

  const handleCreateBudgetPool = async (
    poolId: Hash,
    orgId: Hash,
    name: string,
    totalBudget: bigint,
    windowSeconds: number
  ) => {
    try {
      const hash = await createBudgetPoolOnchain(poolId, orgId, totalBudget, windowSeconds);
      toast.success('Budget pool created', `${name} confirmed on Monad`, hash);
      refresh();
    } catch (err: any) {
      toast.error('Failed to create budget pool', err?.message || 'Transaction failed.');
      throw err;
    }
  };

  const handleAssignAgentToPool = async (agent: Address, poolId: Hash) => {
    try {
      const hash = await assignAgentToPoolOnchain(agent, poolId);
      toast.success('Agent assigned to pool', `Policy updated for ${agent.slice(0, 6)}…${agent.slice(-4)}`, hash);
      refresh();
    } catch (err: any) {
      toast.error('Assignment failed', err?.message || 'Transaction failed.');
      throw err;
    }
  };

  const value: DashboardContextValue = {
    connectedUser,
    balanceMon,
    agents: activeAgents,
    allNetworkAgents,
    fleetScope,
    setFleetScope,
    myAgentsCount,
    totalNetworkAgentsCount,
    budgetPools,
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
    handleBatchProvision,
    handleCreateBudgetPool,
    handleAssignAgentToPool,
    simulatedRecords,
    addSimulatedRecord,
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
