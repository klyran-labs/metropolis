import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useRecentActivity } from '../../hooks/usePolicyEvents';
import { useDashboard } from '../../context/DashboardContext';
import { AuditLedger, type AuditRecord } from './AuditLedger';
import { Card } from '../common/Card';
import { PageHeader } from '../common/PageHeader';

/**
 * /audit — comprehensive and verifiable: reads SpendEvaluated events
 * directly from Monad Testnet and merges real-time simulated intent evaluations
 * from the local operator console with clear provenance tagging.
 */
export const AuditLedgerView: React.FC = () => {
  const { events, loading, error, refresh } = useRecentActivity(undefined, 200);
  const { simulatedRecords } = useDashboard();

  const records: AuditRecord[] = useMemo(() => {
    const onchainRecords: AuditRecord[] = events
      .filter((e) => e.kind === 'SPEND_EVALUATED' && e.merchant !== undefined && e.amount !== undefined && e.agent !== undefined)
      .map((e) => ({
        id: e.id,
        txHash: e.transactionHash,
        agent: e.agent as `0x${string}`,
        merchant: e.merchant as `0x${string}`,
        amountWei: e.amount as bigint,
        decision: {
          decision: e.allowed ? 'ALLOW' : 'DENY',
          allowedAmount: e.allowed ? (e.amount as bigint) : 0n,
          reasonCode: e.reasonCode!,
          reasonMessage: e.reasonMessage ?? '',
          evaluatedAtTimestamp: e.timestamp ?? 0n,
        },
        timestamp: e.timestamp ?? 0n,
        isSimulated: false,
      }));

    const dryRunRecords: AuditRecord[] = simulatedRecords.map((s) => ({
      id: s.id,
      txHash: s.txHash,
      agent: s.agent,
      merchant: s.merchant,
      amountWei: s.amountWei,
      decision: s.decision,
      timestamp: s.timestamp,
      isSimulated: true,
    }));

    return [...dryRunRecords, ...onchainRecords].sort((a, b) => {
      if (b.timestamp === a.timestamp) return 0;
      return b.timestamp > a.timestamp ? 1 : -1;
    });
  }, [events, simulatedRecords]);

  if (error) {
    return (
      <Card padding="lg" className="flex items-center justify-between gap-4 border-danger/30 bg-danger-subtle text-sm text-danger">
        <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</span>
        <button type="button" onClick={() => refresh()} className="font-semibold underline">Retry</button>
      </Card>
    );
  }

  if (loading && records.length === 0) {
    return (
      <Card padding="lg" className="text-center text-sm text-fg-muted" aria-busy="true">
        Reading SpendEvaluated history from Monad…
      </Card>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      <PageHeader
        title="Verifiable Policy Audit Trail"
        description="Machine-readable reason codes emitted by Monad PolicyEngine for every agent spend evaluation."
        breadcrumbs={[{ label: 'AgentGuard', href: '/' }, { label: 'Audit Trail' }]}
        badge={
          <span className="rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-xs font-mono">
            Monad Event Stream
          </span>
        }
      />
      <AuditLedger records={records} />
    </div>
  );
};

export default AuditLedgerView;
