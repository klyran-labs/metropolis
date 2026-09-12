import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, type Address } from 'viem';
import { MONAD_CHAIN_ID, MONAD_RPC_URL, CONTRACT_ADDRESSES, POLICY_ENGINE_ABI, REPUTATION_REGISTRY_ABI } from '../config/contracts';
import { type FleetAgent, type SpendPolicy, type AgentSpendState, type ReputationSummary } from '@agentguard/shared-types';

const publicClient = createPublicClient({
  chain: { id: MONAD_CHAIN_ID, name: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [MONAD_RPC_URL] } } },
  transport: http(MONAD_RPC_URL),
});

async function readOneAgent(address: Address): Promise<FleetAgent | null> {
  const [policyRes, stateRes, metricsRes] = await Promise.all([
    publicClient.readContract({ address: CONTRACT_ADDRESSES.policyEngine, abi: POLICY_ENGINE_ABI, functionName: 'getAgentPolicy', args: [address] }).catch(() => null),
    publicClient.readContract({ address: CONTRACT_ADDRESSES.policyEngine, abi: POLICY_ENGINE_ABI, functionName: 'getAgentState', args: [address] }).catch(() => null),
    publicClient.readContract({ address: CONTRACT_ADDRESSES.reputationRegistry, abi: REPUTATION_REGISTRY_ABI, functionName: 'getMetrics', args: [address] }).catch(() => null),
  ]);

  if (!policyRes) return null;
  const policy: SpendPolicy = {
    agent: address,
    maxPerTx: (policyRes as any).maxPerTx,
    maxPerWindow: (policyRes as any).maxPerWindow,
    windowSeconds: (policyRes as any).windowSeconds,
    maxVelocity: (policyRes as any).maxVelocity,
    killSwitch: (policyRes as any).killSwitch,
    whitelistEnabled: (policyRes as any).whitelistEnabled,
  };
  const isUnconfigured = policy.maxPerTx === 0n && policy.maxPerWindow === 0n && policy.maxVelocity === 0;
  if (isUnconfigured) return null;

  const state: AgentSpendState = stateRes
    ? {
        spentInWindow: (stateRes as any)[0],
        windowStart: BigInt((stateRes as any)[1]),
        txCountInWindow: (stateRes as any)[2],
        nonce: (stateRes as any)[3],
      }
    : { spentInWindow: 0n, windowStart: 0n, txCountInWindow: 0, nonce: 0n };

  let reputation: ReputationSummary | null = null;
  if (metricsRes) {
    const m = metricsRes as any;
    const hasRecord = m.totalTransactions > 0 || m.settledCount > 0 || m.slashedCount > 0 || m.lastUpdatedTimestamp > 0;
    if (hasRecord) {
      reputation = {
        agent: address,
        rollingScoreBps: m.scoreBps,
        totalTransactions: m.totalTransactions,
        settledCount: m.settledCount,
        slashedCount: m.slashedCount,
        lastUpdatedTimestamp: BigInt(m.lastUpdatedTimestamp),
      };
    }
  }

  return {
    id: address.toLowerCase(),
    name: `Agent wallet ${address.slice(0, 6)}…${address.slice(-4)}`,
    address,
    role: 'Registered onchain policy',
    policy,
    state,
    reputation,
    status: policy.killSwitch ? 'REVOKED' : 'ACTIVE',
    recentEvaluations: [],
  };
}

/**
 * Batch-reads policy/state/reputation for a real list of agent addresses
 * (from useAgentRoster) so the fleet view shows every registered agent, not
 * just the connected wallet. Each address is read independently and
 * unconfigured/reverting addresses are dropped rather than shown as
 * fabricated placeholder rows.
 */
export function useFleetAgents(addresses: Address[]) {
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const addressKey = addresses.map((a) => a.toLowerCase()).sort().join(',');

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (addresses.length === 0) {
      setAgents([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(addresses.map((address) => readOneAgent(address)));
      if (requestId !== requestSequence.current) return;
      setAgents(results.filter((a): a is FleetAgent => a !== null));
    } catch (err: any) {
      if (requestId === requestSequence.current) {
        setError(err?.message || 'Failed to read agent fleet from Monad Testnet.');
        setAgents([]);
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, loading, error, refresh };
}
