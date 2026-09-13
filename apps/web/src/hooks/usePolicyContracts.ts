import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem';
import { useWallets } from '@privy-io/react-auth';
import {
  MONAD_CHAIN_ID,
  MONAD_RPC_URL,
  CONTRACT_ADDRESSES,
  POLICY_ENGINE_ABI,
  REPUTATION_REGISTRY_ABI,
} from '../config/contracts';
import { type SpendPolicy, type AgentSpendState, type ReputationSummary, type SpendRequest, type PolicyDecision, ReasonCode, REASON_CODE_MESSAGES } from '@agentguard/shared-types';

const publicClient = createPublicClient({
  chain: { id: MONAD_CHAIN_ID, name: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [MONAD_RPC_URL] } } },
  transport: http(MONAD_RPC_URL),
});

export function usePolicyContracts(agentAddress: Address | null) {
  const [policy, setPolicy] = useState<SpendPolicy | null>(null);
  const [state, setState] = useState<AgentSpendState | null>(null);
  const [reputation, setReputation] = useState<ReputationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeLoading, setWriteLoading] = useState(false);
  const requestSequence = useRef(0);
  const { wallets } = useWallets();

  const getWalletClient = useCallback(async () => {
    const wallet = wallets.find((candidate: any) => candidate.address?.toLowerCase() === agentAddress?.toLowerCase()) || wallets[0];
    if (!wallet) throw new Error('A connected wallet is required to update an agent policy.');
    const provider = await wallet.getEthereumProvider();
    return createWalletClient({
      account: wallet.address as Address,
      chain: { id: MONAD_CHAIN_ID, name: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [MONAD_RPC_URL] } } },
      transport: custom(provider),
    });
  }, [agentAddress, wallets]);

  const fetchAgentData = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!agentAddress) {
      setPolicy(null);
      setState(null);
      setReputation(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch Policy
      try {
        const policyRes = await publicClient.readContract({
          address: CONTRACT_ADDRESSES.policyEngine,
          abi: POLICY_ENGINE_ABI,
          functionName: 'getAgentPolicy',
          args: [agentAddress],
        }) as any;

        if (requestId !== requestSequence.current) return;
        const nextPolicy: SpendPolicy = {
          agent: agentAddress,
          maxPerTx: policyRes.maxPerTx,
          maxPerWindow: policyRes.maxPerWindow,
          windowSeconds: policyRes.windowSeconds,
          maxVelocity: policyRes.maxVelocity,
          killSwitch: policyRes.killSwitch,
          whitelistEnabled: policyRes.whitelistEnabled,
        };
        const isUnconfigured = nextPolicy.maxPerTx === 0n && nextPolicy.maxPerWindow === 0n && nextPolicy.maxVelocity === 0;
        setPolicy(isUnconfigured ? null : nextPolicy);
      } catch {
        if (requestId === requestSequence.current) setPolicy(null);
      }

      // 2. Fetch State
      try {
        const stateRes = await publicClient.readContract({
          address: CONTRACT_ADDRESSES.policyEngine,
          abi: POLICY_ENGINE_ABI,
          functionName: 'getAgentState',
          args: [agentAddress],
        }) as any;

        if (requestId !== requestSequence.current) return;
        setState({
          spentInWindow: stateRes[0],
          windowStart: BigInt(stateRes[1]),
          txCountInWindow: stateRes[2],
          nonce: stateRes[3],
        });
      } catch {
        if (requestId === requestSequence.current) setState(null);
      }

      // 3. Fetch Reputation Metrics
      try {
        const metricsRes = await publicClient.readContract({
          address: CONTRACT_ADDRESSES.reputationRegistry,
          abi: REPUTATION_REGISTRY_ABI,
          functionName: 'getMetrics',
          args: [agentAddress],
        }) as any;

        if (requestId !== requestSequence.current) return;
        const nextReputation: ReputationSummary = {
          agent: agentAddress,
          rollingScoreBps: metricsRes.scoreBps,
          totalTransactions: metricsRes.totalTransactions,
          settledCount: metricsRes.settledCount,
          slashedCount: metricsRes.slashedCount,
          lastUpdatedTimestamp: BigInt(metricsRes.lastUpdatedTimestamp),
        };
        const hasRecord = nextReputation.totalTransactions > 0 || nextReputation.settledCount > 0 || nextReputation.slashedCount > 0 || nextReputation.lastUpdatedTimestamp > 0n;
        setReputation(hasRecord ? nextReputation : null);
      } catch {
        if (requestId === requestSequence.current) setReputation(null);
      }
    } catch (err: any) {
      if (requestId === requestSequence.current) {
        setPolicy(null);
        setState(null);
        setReputation(null);
        setError(err?.message || 'Failed to read agent policy from Monad Testnet');
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [agentAddress]);

  const setPolicyOnchain = useCallback(async (nextPolicy: SpendPolicy) => {
    setWriteLoading(true);
    setError(null);
    try {
      const client = await getWalletClient();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESSES.policyEngine,
        abi: POLICY_ENGINE_ABI,
        functionName: 'setPolicy',
        args: [nextPolicy.agent, {
          maxPerTx: nextPolicy.maxPerTx,
          maxPerWindow: nextPolicy.maxPerWindow,
          windowSeconds: nextPolicy.windowSeconds,
          maxVelocity: nextPolicy.maxVelocity,
          killSwitch: nextPolicy.killSwitch,
          whitelistEnabled: nextPolicy.whitelistEnabled,
        }],
        gas: 350000n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchAgentData();
      return hash;
    } finally {
      setWriteLoading(false);
    }
  }, [fetchAgentData, getWalletClient]);

  const batchSetPoliciesOnchain = useCallback(async (agents: Address[], policies: SpendPolicy[]) => {
    setWriteLoading(true);
    setError(null);
    try {
      const client = await getWalletClient();
      const formattedPolicies = policies.map((p) => ({
        maxPerTx: p.maxPerTx,
        maxPerWindow: p.maxPerWindow,
        windowSeconds: p.windowSeconds,
        maxVelocity: p.maxVelocity,
        killSwitch: p.killSwitch,
        whitelistEnabled: p.whitelistEnabled,
      }));
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESSES.policyEngine,
        abi: POLICY_ENGINE_ABI,
        functionName: 'batchSetPolicies',
        args: [agents, formattedPolicies],
        gas: 600000n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchAgentData();
      return hash;
    } finally {
      setWriteLoading(false);
    }
  }, [fetchAgentData, getWalletClient]);

  const createBudgetPoolOnchain = useCallback(async (poolId: `0x${string}`, orgId: `0x${string}`, totalBudget: bigint, windowSeconds: number) => {
    setWriteLoading(true);
    setError(null);
    try {
      const client = await getWalletClient();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESSES.policyEngine,
        abi: POLICY_ENGINE_ABI,
        functionName: 'createBudgetPool',
        args: [poolId, orgId, totalBudget, windowSeconds],
        gas: 300000n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    } finally {
      setWriteLoading(false);
    }
  }, [getWalletClient]);

  const assignAgentToPoolOnchain = useCallback(async (agent: Address, poolId: `0x${string}`) => {
    setWriteLoading(true);
    setError(null);
    try {
      const client = await getWalletClient();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESSES.policyEngine,
        abi: POLICY_ENGINE_ABI,
        functionName: 'assignAgentToPool',
        args: [agent, poolId],
        gas: 200000n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchAgentData();
      return hash;
    } finally {
      setWriteLoading(false);
    }
  }, [fetchAgentData, getWalletClient]);

  const getBudgetPool = useCallback(async (poolId: `0x${string}`) => {
    const res = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.policyEngine,
      abi: POLICY_ENGINE_ABI,
      functionName: 'getBudgetPool',
      args: [poolId],
    }) as any;
    return {
      poolId: res.poolId,
      orgId: res.orgId,
      name: `Pool ${res.poolId.slice(0, 8)}…`,
      totalBudget: res.totalBudget,
      spentBudget: res.spentBudget,
      windowSeconds: res.windowSeconds,
      windowStart: BigInt(res.windowStart),
      active: res.active,
    };
  }, []);

  const setKillSwitchOnchain = useCallback(async (targetAgent: Address, active: boolean) => {
    setWriteLoading(true);
    setError(null);
    try {
      const client = await getWalletClient();
      const hash = await client.writeContract({
        address: CONTRACT_ADDRESSES.policyEngine,
        abi: POLICY_ENGINE_ABI,
        functionName: 'setKillSwitch',
        args: [targetAgent, active],
        gas: 250000n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchAgentData();
      return hash;
    } finally {
      setWriteLoading(false);
    }
  }, [fetchAgentData, getWalletClient]);

  const evaluatePolicy = useCallback(async (request: SpendRequest): Promise<PolicyDecision> => {
    const result = await publicClient.readContract({ address: CONTRACT_ADDRESSES.policyEngine, abi: POLICY_ENGINE_ABI, functionName: 'evaluate', args: [request] }) as { allowed: boolean; allowedAmount: bigint; reasonCode: number; evaluatedAtTimestamp: bigint };
    const reasonCode = Number(result.reasonCode) as ReasonCode;
    return {
      decision: result.allowed ? 'ALLOW' : 'DENY',
      allowedAmount: result.allowedAmount,
      reasonCode,
      reasonMessage: REASON_CODE_MESSAGES[reasonCode] || `Policy engine returned reason code ${reasonCode}`,
      evaluatedAtTimestamp: result.evaluatedAtTimestamp,
    };
  }, []);

  useEffect(() => {
    fetchAgentData();
  }, [fetchAgentData]);

  return {
    policy,
    state,
    reputation,
    loading,
    error,
    refresh: fetchAgentData,
    writeLoading,
    setPolicyOnchain,
    batchSetPoliciesOnchain,
    createBudgetPoolOnchain,
    assignAgentToPoolOnchain,
    getBudgetPool,
    setKillSwitchOnchain,
    evaluatePolicy,
  };
}
