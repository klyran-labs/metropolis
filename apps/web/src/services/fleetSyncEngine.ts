import { type Address } from 'viem';
import { CONTRACT_ADDRESSES, POLICY_ENGINE_ABI, REPUTATION_REGISTRY_ABI, publicClient } from '../config/contracts';
import { type FleetAgent, type SpendPolicy, type AgentSpendState, type ReputationSummary } from '@agentguard/shared-types';
import knownAgents from '@deployments/monad-testnet/agents.json';
import { formatWeb3ErrorMessage } from '../utils/errors';

const AGENT_MANIFEST_MAP = new Map<string, { name: string; role: string }>();
if (Array.isArray(knownAgents)) {
  for (const item of knownAgents) {
    if (item.address) {
      AGENT_MANIFEST_MAP.set(item.address.toLowerCase(), { name: item.name, role: item.role });
    }
  }
}

export interface FleetSyncSnapshot {
  agents: FleetAgent[];
  currentBlock: bigint | null;
  isInitialLoading: boolean;
  isSyncing: boolean;
  isLiveSync: boolean;
  error: string | null;
  lastSyncedAt: number | null;
}

type Listener = () => void;

function isSameAgent(a: FleetAgent, b: FleetAgent): boolean {
  if (a.address.toLowerCase() !== b.address.toLowerCase()) return false;
  if (a.status !== b.status) return false;
  if (a.poolId !== b.poolId) return false;

  // Policy invariant comparison
  const pa = a.policy;
  const pb = b.policy;
  if (
    pa.maxPerTx !== pb.maxPerTx ||
    pa.maxPerWindow !== pb.maxPerWindow ||
    pa.windowSeconds !== pb.windowSeconds ||
    pa.maxVelocity !== pb.maxVelocity ||
    pa.killSwitch !== pb.killSwitch ||
    pa.whitelistEnabled !== pb.whitelistEnabled
  ) {
    return false;
  }

  // 32-Byte Monad PackedState comparison (spent, windowStart, txCount, nonce)
  const sa = a.state;
  const sb = b.state;
  if (
    sa.spentInWindow !== sb.spentInWindow ||
    sa.windowStart !== sb.windowStart ||
    sa.txCountInWindow !== sb.txCountInWindow ||
    sa.nonce !== sb.nonce
  ) {
    return false;
  }

  // Reputation metrics comparison
  if (!a.reputation && !b.reputation) return true;
  if (!a.reputation || !b.reputation) return false;
  return (
    a.reputation.rollingScoreBps === b.reputation.rollingScoreBps &&
    a.reputation.totalTransactions === b.reputation.totalTransactions &&
    a.reputation.settledCount === b.reputation.settledCount &&
    a.reputation.slashedCount === b.reputation.slashedCount &&
    a.reputation.lastUpdatedTimestamp === b.reputation.lastUpdatedTimestamp
  );
}

class FleetSyncEngine {
  private listeners: Set<Listener> = new Set();
  private addressesToPoll: Set<string> = new Set();
  private agentCache: Map<string, FleetAgent> = new Map();
  private unwatchBlock: (() => void) | null = null;
  private mutationEpoch = 0;
  private inFlightRequestId = 0;

  private snapshot: FleetSyncSnapshot = {
    agents: [],
    currentBlock: null,
    isInitialLoading: true,
    isSyncing: false,
    isLiveSync: true,
    error: null,
    lastSyncedAt: null,
  };

  constructor() {
    this.startBlockReactor();
  }

  /**
   * React 19 useSyncExternalStore subscription contract
   */
  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * React 19 useSyncExternalStore snapshot getter
   */
  public getSnapshot = (): FleetSyncSnapshot => {
    return this.snapshot;
  };

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private updateSnapshot(partial: Partial<FleetSyncSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
    };
    this.notifyListeners();
  }

  /**
   * Monad block reactor: triggered reactively upon block header emission
   */
  public startBlockReactor() {
    if (this.unwatchBlock) return;

    try {
      this.unwatchBlock = publicClient.watchBlockNumber({
        emitOnBegin: true,
        poll: true,
        pollingInterval: 3500,
        onBlockNumber: (blockNumber) => {
          if (this.snapshot.currentBlock !== blockNumber) {
            this.updateSnapshot({ currentBlock: blockNumber });
            if (this.snapshot.isLiveSync && this.addressesToPoll.size > 0) {
              this.syncFleet({ silent: true }).catch(() => {
                // background sync fallback
              });
            }
          }
        },
        onError: (err) => {
          console.warn('Block watcher warning (quiet fallback):', (err as any)?.message || err);
        },
      });
    } catch (err) {
      console.warn('Failed to start block watcher:', err);
    }
  }

  public stopBlockReactor() {
    if (this.unwatchBlock) {
      this.unwatchBlock();
      this.unwatchBlock = null;
    }
  }

  public setLiveSync(enabled: boolean) {
    if (this.snapshot.isLiveSync === enabled) return;
    this.updateSnapshot({ isLiveSync: enabled });
    if (enabled && this.addressesToPoll.size > 0) {
      this.syncFleet({ silent: true }).catch(() => {});
    }
  }

  /**
   * Updates monitored addresses (e.g. connected user, provisioned vault agents, roster)
   */
  public setMonitoredAddresses(addresses: Address[]) {
    const nextSet = new Set(addresses.map((a) => a.toLowerCase()));
    let changed = nextSet.size !== this.addressesToPoll.size;
    if (!changed) {
      for (const addr of nextSet) {
        if (!this.addressesToPoll.has(addr)) {
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      this.addressesToPoll = nextSet;
      this.syncFleet({ silent: this.agentCache.size > 0 }).catch(() => {});
    }
  }

  /**
   * Atomic mutation epoch fencing: increments client epoch and applies optimistic updates
   */
  public beginMutation(): number {
    this.mutationEpoch++;
    return this.mutationEpoch;
  }

  public applyOptimisticAgent(agent: FleetAgent) {
    const key = agent.address.toLowerCase();
    this.agentCache.set(key, agent);
    const nextAgents = Array.from(this.agentCache.values());
    this.updateSnapshot({ agents: nextAgents });
  }

  /**
   * Reads a single agent's onchain parameters with zero placeholder fabrication
   */
  private async readAgentOnchain(address: Address): Promise<FleetAgent | null> {
    const [policyRes, stateRes, metricsRes, poolIdRes] = await Promise.all([
      publicClient.readContract({ address: CONTRACT_ADDRESSES.policyEngine, abi: POLICY_ENGINE_ABI, functionName: 'getAgentPolicy', args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACT_ADDRESSES.policyEngine, abi: POLICY_ENGINE_ABI, functionName: 'getAgentState', args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACT_ADDRESSES.reputationRegistry, abi: REPUTATION_REGISTRY_ABI, functionName: 'getMetrics', args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACT_ADDRESSES.policyEngine, abi: POLICY_ENGINE_ABI, functionName: 'getAgentPoolId', args: [address] }).catch(() => null),
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

    const poolId = poolIdRes && typeof poolIdRes === 'string' && poolIdRes !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      ? (poolIdRes as `0x${string}`)
      : null;

    const manifestInfo = AGENT_MANIFEST_MAP.get(address.toLowerCase());
    const name = manifestInfo?.name || `Agent wallet ${address.slice(0, 6)}…${address.slice(-4)}`;
    const role = manifestInfo?.role || 'Autonomous Operational Agent';

    return {
      id: address.toLowerCase(),
      name,
      address,
      role,
      policy,
      state,
      reputation,
      status: policy.killSwitch ? 'REVOKED' : 'ACTIVE',
      recentEvaluations: [],
      poolId,
    };
  }

  /**
   * Executes atomic fleet synchronization with 32-byte slot dirty checking
   */
  public async syncFleet(options: { silent?: boolean } = {}): Promise<void> {
    const { silent = false } = options;
    const currentEpoch = this.mutationEpoch;
    const requestId = ++this.inFlightRequestId;

    if (this.addressesToPoll.size === 0) {
      this.agentCache.clear();
      this.updateSnapshot({
        agents: [],
        isInitialLoading: false,
        isSyncing: false,
        error: null,
        lastSyncedAt: Date.now(),
      });
      return;
    }

    if (!silent) {
      this.updateSnapshot({ isSyncing: true, error: null });
    }

    try {
      const addresses = Array.from(this.addressesToPoll) as Address[];
      const results = await Promise.all(addresses.map((addr) => this.readAgentOnchain(addr)));

      // If a newer user mutation or sync initiated while in flight, discard stale network response
      if (currentEpoch !== this.mutationEpoch || requestId !== this.inFlightRequestId) {
        return;
      }

      const activeList = results.filter((a): a is FleetAgent => a !== null);
      let anyAgentDirty = false;
      const nextCache = new Map<string, FleetAgent>();

      for (const newAgent of activeList) {
        const key = newAgent.address.toLowerCase();
        const existing = this.agentCache.get(key);

        if (existing && isSameAgent(existing, newAgent)) {
          // Zero-allocation: retain existing reference
          nextCache.set(key, existing);
        } else {
          anyAgentDirty = true;
          nextCache.set(key, newAgent);
        }
      }

      if (nextCache.size !== this.agentCache.size) {
        anyAgentDirty = true;
      }

      this.agentCache = nextCache;

      // Only allocate a new array reference if actual onchain values changed
      const nextAgents = anyAgentDirty ? Array.from(nextCache.values()) : this.snapshot.agents;

      this.updateSnapshot({
        agents: nextAgents,
        isInitialLoading: false,
        isSyncing: false,
        error: null,
        lastSyncedAt: Date.now(),
      });
    } catch (err: any) {
      if (currentEpoch === this.mutationEpoch && requestId === this.inFlightRequestId) {
        this.updateSnapshot({
          isInitialLoading: false,
          isSyncing: false,
          error: formatWeb3ErrorMessage(err),
        });
      }
    }
  }
}

export const fleetSyncEngine = new FleetSyncEngine();
