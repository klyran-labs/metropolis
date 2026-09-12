import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useRecentActivity } from '../../hooks/usePolicyEvents';
import { AuditLedger, type AuditRecord } from './AuditLedger';
import { Card } from '../common/Card';

/**
 * /audit — self-sufficient: reads SpendEvaluated events directly from the
 * chain (fleet-wide, not scoped to the selected agent, since an audit trail
 * needs to cover everyone) rather than depending on a prop nobody ever
 * populated. Only decided evaluations become audit rows — no fabricated
 * "allowedAmount" or evaluation timestamp beyond what the event itself and
 * its owning block attest to.
 */
export const AuditLedgerView: React.FC = () => {
  const { events, loading, error, refresh } = useRecentActivity(undefined, 200);

  const records: AuditRecord[] = useMemo(
    () =>
      events
        .filter((e) => e.kind === 'SPEND_EVALUATED' && e.merchant !== undefined && e.amount !== undefined)
        .map((e) => ({
          id: e.id,
          txHash: e.transactionHash,
          agent: e.agent,
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
        })),
    [events]
  );

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

  return <AuditLedger records={records} />;
};

export default AuditLedgerView;
