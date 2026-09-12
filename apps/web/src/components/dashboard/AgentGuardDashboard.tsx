import React, { useState, useEffect } from 'react';
import { type Address } from 'viem';
import { Shield, Sliders, Play, FileText, RefreshCw, AlertTriangle, ExternalLink, Layers, Plus } from 'lucide-react';
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

export const AgentGuardDashboard: React.FC = () => {
  const { address: connectedUser, balanceMon } = useWeb3Wallet();
  const { policy, state, reputation, loading, error, refresh, writeLoading, setPolicyOnchain, setKillSwitchOnchain, evaluatePolicy } = usePolicyContracts(connectedUser);
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
      <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 border-b border-slate-200/80 pb-4 dark:border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            AgentGuard: Agentic Risk & Spend Control Plane
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Monad Parallel EVM (Chain ID 10143) • Non-Custodial Budget Enforcement • x402 / AP2 Ready
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 font-mono text-xs text-slate-700 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <span>Treasury: </span>
            <span className="font-bold text-slate-900 dark:text-white">{balanceMon} MON</span>
          </div>

          <button
            type="button"
            onClick={() => setIsOnboardingOpen(true)}
            className="inline-flex items-center space-x-1.5 rounded-xl bg-[#254BFF] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#1D40DF] transition cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Register Agent</span>
          </button>

          <a
            href={`${MONAD_EXPLORER_URL}/address/${CONTRACT_ADDRESSES.policyEngine}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center space-x-1 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-blue-600 shadow-xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-blue-400"
          >
            <span>PolicyEngine on Monad</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Navigation Pills */}
      <div className="flex space-x-2 border-b border-slate-200/80 pb-3 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setActiveTab('fleet')}
          className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
            activeTab === 'fleet'
              ? 'bg-[#254BFF] text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <Shield className="h-4 w-4" />
          <span>Agent Fleet ({agents.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('lifecycle')}
          className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
            activeTab === 'lifecycle'
              ? 'bg-[#254BFF] text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <Layers className="h-4 w-4" />
          <span>Lifecycle Pipeline</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('studio')}
          className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
            activeTab === 'studio'
              ? 'bg-[#254BFF] text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <Sliders className="h-4 w-4" />
          <span>Policy Studio</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('simulator')}
          className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
            activeTab === 'simulator'
              ? 'bg-[#254BFF] text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <Play className="h-4 w-4" />
          <span>Rogue Agent Simulator</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
            activeTab === 'audit'
              ? 'bg-[#254BFF] text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Audit Ledger ({auditRecords.length})</span>
        </button>
      </div>

      {!connectedUser && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          Connect a Monad wallet to read or manage agent policies. No fleet, balances, reputation, or audit records are shown until an authenticated wallet and live contract state are available.
        </div>
      )}
      {connectedUser && loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300" aria-busy="true">
          Reading policy, spend state, and reputation from Monad…
        </div>
      )}
      {connectedUser && error && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()} className="rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-950/60">Retry</button>
        </div>
      )}
      {connectedUser && !loading && !error && agents.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <Shield className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">No agent policy configured</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500 dark:text-slate-400">Register an agent wallet and authorize the policy transaction. AgentGuard will show it here only after the deployed PolicyEngine confirms the write.</p>
          <button type="button" onClick={() => setIsOnboardingOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#254BFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D40DF]">Register agent</button>
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
