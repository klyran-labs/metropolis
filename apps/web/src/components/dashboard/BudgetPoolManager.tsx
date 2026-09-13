import React, { useMemo, useState } from 'react';
import { type Address, type Hash, formatEther, parseEther, toHex, keccak256 } from 'viem';
import { Layers, Plus, Users, ShieldAlert, CheckCircle2, DollarSign, Lock } from 'lucide-react';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { Pagination } from '../common/Pagination';
import { useDashboard } from '../../context/DashboardContext';
import { useRbac } from '../../context/RbacContext';
import { formatWeb3ErrorMessage } from '../../utils/errors';

export const BudgetPoolManager: React.FC = () => {
  const {
    agents,
    budgetPools,
    handleCreateBudgetPool,
    handleAssignAgentToPool,
    selectedAgentAddress,
  } = useDashboard();

  const { can, roleConfig } = useRbac();
  const [isCreating, setIsCreating] = useState(false);
  const [newPoolName, setNewPoolName] = useState('');
  const [newPoolBudget, setNewPoolBudget] = useState('10.0');
  const [newPoolWindow, setNewPoolWindow] = useState('3600');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [assigningAgent, setAssigningAgent] = useState<Address | ''>('');
  const [assigningPool, setAssigningPool] = useState<Hash | ''>('');

  const [poolPage, setPoolPage] = useState(1);
  const [poolPageSize, setPoolPageSize] = useState(6);

  const paginatedPools = useMemo(() => {
    const start = (poolPage - 1) * poolPageSize;
    return budgetPools.slice(start, start + poolPageSize);
  }, [budgetPools, poolPage, poolPageSize]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newPoolName.trim()) {
      setError('Please provide a name for the Budget Pool.');
      return;
    }
    const budgetVal = Number(newPoolBudget);
    if (isNaN(budgetVal) || budgetVal <= 0) {
      setError('Please provide a valid budget amount in MON.');
      return;
    }

    setLoading(true);
    try {
      const poolId = keccak256(toHex(`pool-${Date.now()}-${newPoolName}`));
      const orgId = keccak256(toHex('agentguard-primary-org'));
      await handleCreateBudgetPool(
        poolId,
        orgId,
        newPoolName.trim(),
        parseEther(newPoolBudget),
        Number(newPoolWindow)
      );
      setIsCreating(false);
      setNewPoolName('');
    } catch (err: any) {
      setError(formatWeb3ErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningAgent || !assigningPool) return;
    setLoading(true);
    try {
      await handleAssignAgentToPool(assigningAgent, assigningPool);
      setAssigningAgent('');
      setAssigningPool('');
    } catch (err: any) {
      setError(formatWeb3ErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const totalPoolBudget = budgetPools.reduce((sum, p) => sum + p.totalBudget, 0n);
  const totalPoolSpent = budgetPools.reduce((sum, p) => sum + p.spentBudget, 0n);

  return (
    <div className="space-y-4">
      {/* Org Summary Banner */}
      <Card padding="md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                <Layers className="h-4 w-4" />
              </span>
              <h2 className="text-base font-bold text-fg">Org → BudgetPool → Agent Governance</h2>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              Enforce hierarchical organizational budget constraints. When a pool limit is exceeded, transactions are rejected onchain with reason code{' '}
              <span className="font-mono font-semibold text-danger">ERR_BUDGET_DEPLETED (Code 6)</span>.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {can('canManageBudgetPools') ? (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setIsCreating(!isCreating)}
              >
                {isCreating ? 'Cancel' : 'Create Budget Pool'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled
                leftIcon={<Lock className="h-3.5 w-3.5 text-fg-subtle" />}
                title={`Budget pool creation disabled for ${roleConfig.label}. Requires Treasury Manager or Super Admin.`}
              >
                Create Pool (Treasury Only)
              </Button>
            )}
          </div>
        </div>

        {/* Global Pool Utilization Metric */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 border-t border-card-border pt-4">
          <div>
            <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Active Budget Pools</p>
            <p className="mt-1 text-lg font-bold text-fg">{budgetPools.length}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Total Allocated Pool Cap</p>
            <p className="mt-1 text-lg font-bold text-fg font-mono">{formatEther(totalPoolBudget)} MON</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider">Current Pool Spend</p>
            <p className="mt-1 text-lg font-bold text-fg font-mono">{formatEther(totalPoolSpent)} MON</p>
          </div>
        </div>
      </Card>

      {/* Creation Modal / Inline Drawer */}
      {isCreating && (
        <Card padding="md" className="border-primary/40 bg-primary-subtle/10">
          <h3 className="text-sm font-bold text-fg">New Team Budget Pool</h3>
          <p className="text-xs text-fg-muted">Commits a shared organizational budget partition on Monad with automatic sliding window reset.</p>

          <form onSubmit={handleCreate} className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-fg">Pool Name</label>
              <input
                type="text"
                value={newPoolName}
                onChange={(e) => setNewPoolName(e.target.value)}
                placeholder="e.g. AI Inference Pool"
                className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-fg">Total Pool Cap (MON)</label>
              <input
                type="number"
                step="0.1"
                value={newPoolBudget}
                onChange={(e) => setNewPoolBudget(e.target.value)}
                className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-xs font-mono outline-none focus:border-primary"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-fg">Sliding Window (seconds)</label>
              <input
                type="number"
                value={newPoolWindow}
                onChange={(e) => setNewPoolWindow(e.target.value)}
                className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-xs font-mono outline-none focus:border-primary"
                required
              />
            </div>

            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={loading}>
                Deploy Pool Onchain
              </Button>
            </div>
          </form>

          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        </Card>
      )}

      {/* Pool Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {budgetPools.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-dashed border-card-border p-8 text-center text-xs text-fg-muted">
            <Layers className="mx-auto h-8 w-8 text-fg-subtle" />
            <p className="mt-2 font-semibold text-fg">No shared budget pools provisioned</p>
            <p className="mt-1">
              Create a pool above to allocate shared team spending caps across your agent fleet.
            </p>
          </div>
        ) : (
          paginatedPools.map((pool) => {
            const spentNum = Number(formatEther(pool.spentBudget));
            const totalNum = Number(formatEther(pool.totalBudget)) || 1;
            const pct = Math.min(100, Math.round((spentNum / totalNum) * 100));
            const assignedAgents = agents.filter(
              (a) => a.poolId && a.poolId.toLowerCase() === pool.poolId.toLowerCase()
            );

            return (
              <Card key={pool.poolId} padding="md" className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-fg">{pool.name}</h4>
                    <p className="text-[11px] font-mono text-fg-muted">
                      ID: {pool.poolId.slice(0, 10)}…{pool.poolId.slice(-6)}
                    </p>
                  </div>
                  <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-bold text-success">
                    ACTIVE
                  </span>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-fg-muted">Spent: {formatEther(pool.spentBudget)} MON</span>
                    <span className="font-semibold text-fg">Cap: {formatEther(pool.totalBudget)} MON</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-card-muted">
                    <div
                      className={`h-full transition-all duration-300 ${
                        pct > 85 ? 'bg-danger' : pct > 60 ? 'bg-warning' : 'bg-primary'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-[10px] text-fg-muted">{pct}% utilized</p>
                </div>

                <div className="border-t border-card-border pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-fg-muted">
                      <Users className="h-3.5 w-3.5" />
                      Assigned Agents ({assignedAgents.length})
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {assignedAgents.length === 0 ? (
                      <span className="text-[11px] text-fg-subtle">No agents linked yet</span>
                    ) : (
                      assignedAgents.map((a) => (
                        <span
                          key={a.address}
                          className="rounded-lg bg-card-muted border border-card-border px-2 py-0.5 text-[10px] font-mono text-fg"
                        >
                          {a.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Pagination for Budget Pools */}
      {budgetPools.length > poolPageSize && (
        <Card padding="none" className="overflow-hidden">
          <Pagination
            currentPage={poolPage}
            totalItems={budgetPools.length}
            pageSize={poolPageSize}
            onPageChange={setPoolPage}
            onPageSizeChange={(size) => {
              setPoolPageSize(size);
              setPoolPage(1);
            }}
            pageSizeOptions={[4, 6, 12, 24]}
          />
        </Card>
      )}

      {/* Quick Agent-to-Pool Assignment Form */}
      {budgetPools.length > 0 && agents.length > 0 && (
        <Card padding="md">
          <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
            Assign Fleet Agent to Shared Budget Pool
          </h4>
          <form onSubmit={handleAssign} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="text-xs font-semibold text-fg">Select Agent</label>
              <select
                value={assigningAgent}
                onChange={(e) => setAssigningAgent(e.target.value as Address)}
                className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
              >
                <option value="">Choose agent...</option>
                {agents.map((a) => (
                  <option key={a.address} value={a.address}>
                    {a.name} ({a.address.slice(0, 6)}…{a.address.slice(-4)})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label className="text-xs font-semibold text-fg">Assign to Pool</label>
              <select
                value={assigningPool}
                onChange={(e) => setAssigningPool(e.target.value as Hash)}
                className="mt-1 w-full rounded-xl border border-card-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
              >
                <option value="">Choose pool...</option>
                {budgetPools.map((p) => (
                  <option key={p.poolId} value={p.poolId}>
                    {p.name} (Cap: {formatEther(p.totalBudget)} MON)
                  </option>
                ))}
              </select>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!can('canManageBudgetPools') || !assigningAgent || !assigningPool}
              title={!can('canManageBudgetPools') ? `Requires Treasury Manager or Super Admin (Current: ${roleConfig.label})` : undefined}
              loading={loading}
            >
              {!can('canManageBudgetPools') ? 'Assign Locked' : 'Assign Onchain'}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
};
