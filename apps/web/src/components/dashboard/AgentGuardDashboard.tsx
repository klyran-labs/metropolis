import React, { useState, useEffect } from 'react';
import { type Address } from 'viem';
import { Shield, Sliders, Play, FileText, ExternalLink, Layers, Plus } from 'lucide-react';
import { FleetOverview } from './FleetOverview';
import { PolicyStudio } from './PolicyStudio';
import { RogueAgentSimulator } from './RogueAgentSimulator';
import { AuditLedger, type AuditRecord } from './AuditLedger';
import { LifecycleStudio } from './LifecycleStudio';
import { AgentOnboardingModal } from './AgentOnboardingModal';
import { useWeb3Wallet } from '../../hooks/useWeb3Wallet';
import { usePolicyContracts } from '../../hooks/usePolicyContracts';
import {
  type FleetAgent,
  type SpendPolicy,
  type SpendRequest,
  type PolicyDecision,
} from '@agentguard/shared-types';
import { MONAD_EXPLORER_URL, CONTRACT_ADDRESSES } from '../../config/contracts';
import { Button } from '../common/Button';
import { NavTabs } from '../common/NavTabs';

const DASHBOARD_TABS = [
  { value: 'fleet', label: 'Agent Fleet', icon: Shield },
  { value: 'lifecycle', label: 'Lifecycle Pipeline', icon: Layers },
  { value: 'studio', label: 'Policy Studio', icon: Sliders },
  { value: 'simulator', label: 'Rogue Agent Simulator', icon: Play },
  { value: 'audit', label: 'Audit Ledger', icon: FileText },
] as const;

export const AgentGuardDashboard: React.FC = () => {
  const { address: connectedUser, balanceMon } = useWeb3Wallet();
  const { policy, state, reputation, loading, error, refresh, setPolicyOnchain, setKillSwitchOnchain, evaluatePolicy } = usePolicyContracts(connectedUser);
  const [activeTab, setActiveTab] = useState<'fleet' | 'lifecycle' | 'studio' | 'simulator' | 'audit'>('fleet');
  const [selectedAgentAddress, setSelectedAgentAddress] = useState<Address | null>(connectedUser);
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  useEffect(() => setSelectedAgentAddress(connectedUser), [connectedUser]);

  const agents: FleetAgent[] = connectedUser && policy && state ? [{
    id: connectedUser.toLowerCase(),
    name: `Agent wallet ${connectedUser.slice(0, 6)}…${connectedUser.slice(-4)}`,
    address: connectedUser,
    role: 'Connected wallet policy',
    policy,
    state,
    reputation,
    status: policy.killSwitch ? 'REVOKED' : 'ACTIVE',
    recentEvaluations: [],
  }] : [];

  const selectedAgent = agents.find((a) => selectedAgentAddress && a.address.toLowerCase() === selectedAgentAddress.toLowerCase()) || null;

  const handleRegisterAgent = async (input: { name: string; role: string; policy: SpendPolicy }) => {
    await setPolicyOnchain(input.policy);
    setSelectedAgentAddress(input.policy.agent);
    await refresh();
    setActiveTab('studio');
  };

  // Toggle onchain kill-switch
  const handleToggleKillSwitch = async (agentAddress: Address, currentActive: boolean) => {
    await setKillSwitchOnchain(agentAddress, !currentActive);
  };

  // Update policy configuration
  const handleSavePolicy = async (agentAddress: Address, newPolicy: SpendPolicy) => {
    await setPolicyOnchain({ ...newPolicy, agent: agentAddress });
  };

  // Read-only evaluation against the deployed PolicyEngine. This deliberately
  // never mutates local spend/reputation state or fabricates an audit hash.
  const handleExecuteSimulation = async (req: SpendRequest): Promise<PolicyDecision> => {
    return evaluatePolicy(req);
  };

  return (
    <div className="space-y-6">
      {/* Top Navigation Bar */}
      <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 border-b border-card-border pb-4">
        <div>
          <h1 className="text-xl font-bold text-fg">
            AgentGuard: Agentic Risk & Spend Control Plane
          </h1>
          <p className="text-xs text-fg-muted">
            Monad Parallel EVM (Chain ID 10143) • Non-Custodial Budget Enforcement • x402 / AP2 Ready
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="rounded-xl border border-card-border bg-card px-3 py-1.5 font-mono text-xs text-fg-muted shadow-xs">
            <span>Treasury: </span>
            <span className="font-bold text-fg">{balanceMon} MON</span>
          </div>

          <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setIsOnboardingOpen(true)}>
            Register Agent
          </Button>

          <a
            href={`${MONAD_EXPLORER_URL}/address/${CONTRACT_ADDRESSES.policyEngine}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center space-x-1 rounded-xl border border-card-border bg-card px-3 py-1.5 text-xs font-semibold text-primary shadow-xs hover:bg-card-muted"
          >
            <span>PolicyEngine on Monad</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <NavTabs
        aria-label="Dashboard sections"
        options={DASHBOARD_TABS.map((tab) => ({
          ...tab,
          label: tab.value === 'fleet' ? `Agent Fleet (${agents.length})` : tab.value === 'audit' ? `Audit Ledger (${auditRecords.length})` : tab.label,
        }))}
        value={activeTab}
        onChange={setActiveTab}
      />

      {!connectedUser && (
        <div className="rounded-2xl border border-warning/30 bg-warning-subtle p-5 text-sm text-fg">
          Connect a Monad wallet to read or manage agent policies. No fleet, balances, reputation, or audit records are shown until an authenticated wallet and live contract state are available.
        </div>
      )}
      {connectedUser && loading && (
        <div className="rounded-2xl border border-card-border bg-card p-5 text-sm text-fg-muted" aria-busy="true">
          Reading policy, spend state, and reputation from Monad…
        </div>
      )}
      {connectedUser && error && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-danger/30 bg-danger-subtle p-5 text-sm text-danger" role="alert">
          <span>{error}</span>
          <Button variant="outline-danger" size="sm" onClick={() => void refresh()}>Retry</Button>
        </div>
      )}
      {connectedUser && !loading && !error && agents.length === 0 && (
        <div className="rounded-2xl border border-card-border bg-card p-8 text-center">
          <Shield className="mx-auto h-10 w-10 text-fg-subtle" />
          <h2 className="mt-3 text-base font-semibold text-fg">No agent policy configured</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-fg-muted">Register an agent wallet and authorize the policy transaction. AgentGuard will show it here only after the deployed PolicyEngine confirms the write.</p>
          <Button variant="primary" size="md" className="mt-5" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setIsOnboardingOpen(true)}>
            Register agent
          </Button>
        </div>
      )}

      {/* Main Content Area */}
      {activeTab === 'fleet' && (
        <FleetOverview
          agents={agents}
          onToggleKillSwitch={handleToggleKillSwitch}
          onSelectAgent={(agent) => {
            setSelectedAgentAddress(agent.address);
            setActiveTab('studio');
          }}
          selectedAgentAddress={selectedAgentAddress}
          onOpenOnboarding={() => setIsOnboardingOpen(true)}
          onRunLifecycle={(agent) => {
            setSelectedAgentAddress(agent.address);
            setActiveTab('lifecycle');
          }}
        />
      )}

      {activeTab === 'lifecycle' && selectedAgent && (
        <LifecycleStudio
          agent={selectedAgent}
          onSavePolicy={handleSavePolicy}
          onToggleKillSwitch={handleToggleKillSwitch}
        />
      )}

      {activeTab === 'studio' && selectedAgent && (
        <PolicyStudio
          agent={selectedAgent}
          onSavePolicy={handleSavePolicy}
        />
      )}

      {activeTab === 'simulator' && selectedAgent && (
        <RogueAgentSimulator
          agent={selectedAgent}
          onExecuteSimulation={handleExecuteSimulation}
          onToggleKillSwitch={handleToggleKillSwitch}
        />
      )}

      {activeTab === 'audit' && (
        <AuditLedger records={auditRecords} />
      )}

      {/* Agent Provisioning Modal */}
      <AgentOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onRegisterAgent={handleRegisterAgent}
      />
    </div>
  );
};
