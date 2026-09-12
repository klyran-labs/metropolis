import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, type Address, type Log } from 'viem';
import { MONAD_CHAIN_ID, MONAD_RPC_URL, CONTRACT_ADDRESSES, POLICY_ENGINE_ABI } from '../config/contracts';
import { APP_CONFIG } from '../config/env';
import { ReasonCode, REASON_CODE_MESSAGES } from '@agentguard/shared-types';

const publicClient = createPublicClient({
  chain: { id: MONAD_CHAIN_ID, name: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [MONAD_RPC_URL] } } },
  transport: http(MONAD_RPC_URL),
});

const DEPLOY_BLOCK = APP_CONFIG.policyEngineDeployBlock;

/**
 * Every agent that has ever had a policy set on PolicyEngine, discovered from
 * the PolicySet event's indexed `agent` topic — no local registry, no
 * localStorage, no assumption that "the fleet" is just the connected wallet.
 * This is the real, honest source of truth for "which agents exist": the
 * chain itself.
 */
export function useAgentRoster() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const logs = await publicClient.getContractEvents({
        address: CONTRACT_ADDRESSES.policyEngine,
        abi: POLICY_ENGINE_ABI,
        eventName: 'PolicySet',
        fromBlock: DEPLOY_BLOCK,
        toBlock: 'latest',
      });
      if (requestId !== requestSequence.current) return;
      const unique = Array.from(
        new Set(logs.map((log) => (log.args as { agent?: Address }).agent).filter((a): a is Address => Boolean(a)).map((a) => a.toLowerCase()))
      ) as Address[];
      setAddresses(unique);
    } catch (err: any) {
      if (requestId === requestSequence.current) {
        setError(err?.message || 'Failed to read PolicySet history from Monad Testnet.');
        setAddresses([]);
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { addresses, loading, error, refresh };
}

export type ActivityEventKind = 'POLICY_SET' | 'KILL_SWITCH' | 'SPEND_EVALUATED' | 'SPEND_RECORDED';

export interface ActivityEvent {
  id: string;
  kind: ActivityEventKind;
  agent: Address;
  merchant?: Address;
  amount?: bigint;
  allowed?: boolean;
  reasonCode?: ReasonCode;
  reasonMessage?: string;
  active?: boolean;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  /** Null until the owning block's timestamp has been fetched. */
  timestamp: bigint | null;
}

const EVENT_NAMES = ['PolicySet', 'KillSwitchUpdated', 'SpendEvaluated', 'SpendRecorded'] as const;

function toActivityEvent(log: Log & { eventName?: string; args?: any }): ActivityEvent | null {
  const base = {
    id: `${log.transactionHash}-${log.logIndex}`,
    blockNumber: log.blockNumber as bigint,
    transactionHash: log.transactionHash as `0x${string}`,
    timestamp: null,
  };
  switch (log.eventName) {
    case 'PolicySet':
      return { ...base, kind: 'POLICY_SET', agent: log.args.agent };
    case 'KillSwitchUpdated':
      return { ...base, kind: 'KILL_SWITCH', agent: log.args.agent, active: log.args.active };
    case 'SpendEvaluated': {
      const reasonCode = Number(log.args.reasonCode) as ReasonCode;
      return {
        ...base,
        kind: 'SPEND_EVALUATED',
        agent: log.args.agent,
        merchant: log.args.merchant,
        amount: log.args.amount,
        allowed: log.args.allowed,
        reasonCode,
        reasonMessage: REASON_CODE_MESSAGES[reasonCode] || `Reason code ${reasonCode}`,
      };
    }
    case 'SpendRecorded':
      return { ...base, kind: 'SPEND_RECORDED', agent: log.args.agent, amount: log.args.amount };
    default:
      return null;
  }
}

/**
 * Real recent activity decoded from PolicyEngine events — the feed a
 * financial risk-control app needs but this codebase never had (the
 * notification drawer previously showed one hardcoded line; the audit
 * ledger's local state was declared and never populated). Pass `agent` to
 * scope to one address, or omit it for the fleet-wide feed.
 */
export function useRecentActivity(agent?: Address | null, limit = 50) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const perEventLogs = await Promise.all(
        EVENT_NAMES.map((eventName) =>
          publicClient.getContractEvents({
            address: CONTRACT_ADDRESSES.policyEngine,
            abi: POLICY_ENGINE_ABI,
            eventName,
            args: agent ? ({ agent } as any) : undefined,
            fromBlock: DEPLOY_BLOCK,
            toBlock: 'latest',
          })
        )
      );
      if (requestId !== requestSequence.current) return;

      const decoded = perEventLogs
        .flat()
        .map((log) => toActivityEvent(log as any))
        .filter((event): event is ActivityEvent => event !== null)
        .sort((a, b) => (b.blockNumber === a.blockNumber ? 0 : b.blockNumber > a.blockNumber ? 1 : -1))
        .slice(0, limit);

      // Fetch real block timestamps only for the events we're actually
      // going to show, not the whole scanned range.
      const uniqueBlocks = Array.from(new Set(decoded.map((e) => e.blockNumber)));
      const blockTimestamps = new Map<bigint, bigint>();
      await Promise.all(
        uniqueBlocks.map(async (blockNumber) => {
          try {
            const block = await publicClient.getBlock({ blockNumber });
            blockTimestamps.set(blockNumber, block.timestamp);
          } catch {
            // Leave timestamp null for this block rather than fabricating one.
          }
        })
      );
      if (requestId !== requestSequence.current) return;

      setEvents(decoded.map((e) => ({ ...e, timestamp: blockTimestamps.get(e.blockNumber) ?? null })));
    } catch (err: any) {
      if (requestId === requestSequence.current) {
        setError(err?.message || 'Failed to read policy activity from Monad Testnet.');
        setEvents([]);
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [agent, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { events, loading, error, refresh };
}
