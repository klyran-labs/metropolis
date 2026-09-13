import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { type FleetAgent, type SpendPolicy, type SpendRequest, type PolicyDecision, type BudgetPool } from '@agentguard/shared-types';
import { type Address, type Hash, parseEther, formatEther } from 'viem';
import { useAgentRoster } from '../hooks/usePolicyEvents';
import { usePolicyContracts } from '../hooks/usePolicyContracts';
import { useWeb3Wallet } from '../hooks/useWeb3Wallet';
import { fleetSyncEngine } from '../services/fleetSyncEngine';
import { useFleetSync } from '../hooks/useFleetSync';
import { useToast } from './ToastContext';
import { useRbac } from './RbacContext';
import { getUserProvisionedAgents, addUserProvisionedAgent, saveAgentCredentials } from '../utils/agentVault';
import knownAgents from '@deployments/monad-testnet/agents.json';

import { formatWeb3ErrorMessage } from '../utils/errors';

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
  refreshBalance: () => Promise<string>;
  fundDevnetWallet: () => Promise<boolean>;
  isLocalDevnet: boolean;
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
  handleRegisterAgent: (input: {
    name: string;
    role: string;
    policy: SpendPolicy;
    privateKey?: `0x${string}`;
    openSignerWalletId?: string;
    signerType?: 'web_crypto' | 'opensigner' | 'imported';
    saveToVault?: boolean;
    architecture?: 'EOA' | 'ERC1271' | 'EIP7702' | 'TBA';
    securityTier?: 'STANDARD' | 'TEE_ENCLAVE';
    gasMode?: 'SELF_FUNDED' | 'PAYMASTER_SPONSORED';
    initialFundingWei?: bigint;
  }) => Promise<void>;
  handleFundAgent: (agentAddress: Address, amountWei: bigint) => Promise<Hash>;
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
  const { address: connectedUser, balanceMon, refreshBalance, fundDevnetWallet, isLocalDevnet } = useWeb3Wallet();
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
    fundAgentOnchain,
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
  const allAddressesToPoll = useMemo(() => {
    const combined = new Set<string>();
    if (connectedUser) combined.add(connectedUser.toLowerCase());
    provisionedAddresses.forEach((a) => combined.add(a.toLowerCase()));
    rosterAddresses.forEach((a) => combined.add(a.toLowerCase()));
    knownAgents.forEach((a: any) => combined.add(a.address.toLowerCase()));
    return Array.from(combined) as Address[];
  }, [connectedUser, provisionedAddresses, rosterAddresses]);

  useEffect(() => {
    fleetSyncEngine.setMonitoredAddresses(allAddressesToPoll);
  }, [allAddressesToPoll]);

  const {
    agents: allNetworkAgents,
    isInitialLoading,
    error: fleetSyncError,
  } = useFleetSync();

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
    refreshRoster({ silent: false });
    fleetSyncEngine.syncFleet({ silent: false });
  }, [refreshRoster]);

  const handleToggleKillSwitch = async (agentAddress: Address, currentActive: boolean) => {
    try {
      const nextActive = !currentActive;
      fleetSyncEngine.beginMutation();
      const existing = allNetworkAgents.find((a) => a.address.toLowerCase() === agentAddress.toLowerCase());
      if (existing) {
        fleetSyncEngine.applyOptimisticAgent({
          ...existing,
          policy: { ...existing.policy, killSwitch: nextActive },
          status: nextActive ? 'REVOKED' : 'ACTIVE',
        });
      }
      const hash = await setKillSwitchOnchain(agentAddress, nextActive);
      toast.success(
        nextActive ? 'Kill switch activated' : 'Kill switch deactivated',
        `Agent ${agentAddress.slice(0, 6)}...${agentAddress.slice(-4)} ${nextActive ? 'halted (O(1) abort)' : 'restored to active'}`,
        hash
      );
      fleetSyncEngine.syncFleet({ silent: true });
    } catch (err: any) {
      fleetSyncEngine.syncFleet({ silent: true });
      const errorMsg = formatWeb3ErrorMessage(err);
      toast.error('Kill switch update failed', errorMsg);
      throw new Error(errorMsg);
    }
  };

  const handleSavePolicy = async (agentAddress: Address, policy: SpendPolicy) => {
    try {
      fleetSyncEngine.beginMutation();
      const hash = await setPolicyOnchain(policy);
      toast.success('Policy updated', `Policy for ${agentAddress.slice(0, 6)}... committed on Monad`, hash);
      fleetSyncEngine.syncFleet({ silent: true });
    } catch (err: any) {
      const errorMsg = formatWeb3ErrorMessage(err);
      toast.error('Policy update failed', errorMsg);
      throw new Error(errorMsg);
    }
  };

  const addSimulatedRecord = useCallback((rec: SimulatedAuditRecord) => {
    setSimulatedRecords((prev) => [rec, ...prev].slice(0, 200));
  }, []);

  const handleExecuteSimulation = async (req: SpendRequest): Promise<PolicyDecision> => {
    const decision = await evaluatePolicy(req);
    addSimulatedRecord({
      id: `sim_${Date.now()}_${Math.floor(Date.now() % 100000)}`,
      agent: req.agent,
      merchant: req.merchant,
      amountWei: req.amount,
      decision,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      simulated: true,
    });
    return decision;
  };

  const handleFundAgent = async (agentAddress: Address, amountWei: bigint) => {
    try {
      const hash = await fundAgentOnchain(agentAddress, amountWei);
      toast.success('Agent funded', `${formatEther(amountWei)} MON transferred on Monad`, hash);
      refresh();
      refreshBalance();
      return hash;
    } catch (err: any) {
      const errorMsg = formatWeb3ErrorMessage(err);
      toast.error('Funding failed', errorMsg);
      throw new Error(errorMsg);
    }
  };

  const handleRegisterAgent = async (input: {
    name: string;
    role: string;
    policy: SpendPolicy;
    privateKey?: `0x${string}`;
    openSignerWalletId?: string;
    signerType?: 'web_crypto' | 'opensigner' | 'imported';
    saveToVault?: boolean;
    architecture?: 'EOA' | 'ERC1271' | 'EIP7702' | 'TBA';
    securityTier?: 'STANDARD' | 'TEE_ENCLAVE';
    gasMode?: 'SELF_FUNDED' | 'PAYMASTER_SPONSORED';
    initialFundingWei?: bigint;
  }) => {
    try {
      const hash = await setPolicyOnchain(input.policy);
      toast.success('Agent provisioned', `${input.name} registered on Monad`, hash);
      if (connectedUser) {
        addUserProvisionedAgent(connectedUser, input.policy.agent);
        if (input.saveToVault && (input.privateKey || input.openSignerWalletId)) {
          saveAgentCredentials(connectedUser, {
            address: input.policy.agent,
            name: input.name,
            role: input.role,
            privateKey: input.privateKey,
            openSignerWalletId: input.openSignerWalletId,
            signerType: input.signerType || (input.openSignerWalletId ? 'opensigner' : input.privateKey ? 'web_crypto' : 'imported'),
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Initial funding transfer if requested
      if (input.initialFundingWei && input.initialFundingWei > 0n) {
        try {
          const fundHash = await fundAgentOnchain(input.policy.agent, input.initialFundingWei);
          toast.success('Agent funded', `Transferred ${formatEther(input.initialFundingWei)} MON initial balance`, fundHash);
        } catch (fundErr: any) {
          toast.error('Funding failed', formatWeb3ErrorMessage(fundErr));
        }
      }

      setProvisionedAddresses((prev) => Array.from(new Set([...prev, input.policy.agent])));
      setSelectedAgentAddress(input.policy.agent);
      setFleetScope('my_agents');
      refresh();
      refreshBalance();
    } catch (err: any) {
      const errorMsg = formatWeb3ErrorMessage(err);
      toast.error('Agent provisioning failed', errorMsg);
      throw new Error(errorMsg);
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
      const errorMsg = formatWeb3ErrorMessage(err);
      toast.error('Batch provisioning failed', errorMsg);
      throw new Error(errorMsg);
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
      const errorMsg = formatWeb3ErrorMessage(err);
      toast.error('Failed to create budget pool', errorMsg);
      throw new Error(errorMsg);
    }
  };

  const handleAssignAgentToPool = async (agent: Address, poolId: Hash) => {
    try {
      const hash = await assignAgentToPoolOnchain(agent, poolId);
      toast.success('Agent assigned to pool', `Policy updated for ${agent.slice(0, 6)}…${agent.slice(-4)}`, hash);
      refresh();
    } catch (err: any) {
      const errorMsg = formatWeb3ErrorMessage(err);
      toast.error('Assignment failed', errorMsg);
      throw new Error(errorMsg);
    }
  };

  const value: DashboardContextValue = {
    connectedUser,
    balanceMon,
    refreshBalance,
    fundDevnetWallet,
    isLocalDevnet,
    agents: activeAgents,
    allNetworkAgents,
    fleetScope,
    setFleetScope,
    myAgentsCount,
    totalNetworkAgentsCount,
    budgetPools,
    rosterLoading: isInitialLoading && allNetworkAgents.length === 0,
    rosterError: rosterError || fleetSyncError,
    refreshRoster: refresh,
    selectedAgentAddress,
    setSelectedAgentAddress,
    selectedAgent,
    handleToggleKillSwitch,
    handleSavePolicy,
    handleExecuteSimulation,
    handleRegisterAgent,
    handleFundAgent,
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
