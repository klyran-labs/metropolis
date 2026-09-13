import React, { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, XCircle, ExternalLink, Download, Search, Sparkles } from 'lucide-react';
import { type PolicyDecision, ReasonCode } from '@agentguard/shared-types';
import { MONAD_EXPLORER_URL } from '../../config/contracts';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { SegmentedControl } from '../common/SegmentedControl';
import { Pagination } from '../common/Pagination';
import { diagnoseOnchainDenial } from '../../services/qwenCopilot';

export interface AuditRecord {
  id: string;
  txHash?: `0x${string}`;
  agent: `0x${string}`;
  merchant: `0x${string}`;
  amountWei: bigint;
  decision: PolicyDecision;
  timestamp: bigint;
  isSimulated?: boolean;
}

interface AuditLedgerProps {
  records: AuditRecord[];
}

const DECISION_FILTERS = [
  { value: 'ALL', label: 'ALL' },
  { value: 'ALLOW', label: 'ALLOW' },
  { value: 'DENY', label: 'DENY' },
] as const;

export const AuditLedger: React.FC<AuditLedgerProps> = ({ records }) => {
  const [decisionFilter, setDecisionFilter] = useState<'ALL' | 'ALLOW' | 'DENY'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedCopilotRecordId, setExpandedCopilotRecordId] = useState<string | null>(null);

  // Reset pagination when searching or changing filters
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, decisionFilter]);

  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      const matchesDecision =
        decisionFilter === 'ALL' || rec.decision.decision === decisionFilter;

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (rec.txHash && rec.txHash.toLowerCase().includes(q)) ||
        rec.agent.toLowerCase().includes(q) ||
        rec.merchant.toLowerCase().includes(q) ||
        rec.decision.reasonMessage.toLowerCase().includes(q) ||
        `err_${rec.decision.reasonCode}`.includes(q);

      return matchesDecision && matchesSearch;
    });
  }, [records, decisionFilter, searchQuery]);

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  const handleExportJSON = () => {
    const exportData = records.map((rec) => ({
      id: rec.id,
      txHash: rec.txHash || 'SIMULATED_DRY_RUN',
      agent: rec.agent,
      merchant: rec.merchant,
      amountWei: rec.amountWei.toString(),
      decision: rec.decision.decision,
      reasonCode: rec.decision.reasonCode,
      reasonMessage: rec.decision.reasonMessage,
      isSimulated: Boolean(rec.isSimulated),
      timestamp: Number(rec.timestamp),
      isoTime: new Date(Number(rec.timestamp) * 1000).toISOString(),
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentguard-audit-ledger-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Type', 'TxHash', 'Agent', 'Merchant', 'AmountWei', 'Decision', 'ReasonCode', 'ReasonMessage', 'Timestamp'];
    const rows = records.map((rec) => [
      rec.id,
      rec.isSimulated ? 'SIMULATION' : 'ONCHAIN',
      rec.txHash || 'N/A',
      rec.agent,
      rec.merchant,
      rec.amountWei.toString(),
      rec.decision.decision,
      rec.decision.reasonCode,
      `"${rec.decision.reasonMessage.replace(/"/g, '""')}"`,
      rec.timestamp.toString(),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentguard-audit-ledger-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card padding="none" className="font-sans">
      {/* Table Toolbar & Controls */}
      <div
        aria-label="Verifiable Policy Audit Trail"
        className="flex flex-col space-y-3 border-b border-card-border px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:space-y-0"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Audit Records</span>
          <span className="rounded-full bg-card-muted px-2.5 py-0.5 text-[11px] font-mono font-medium text-fg border border-card-border">
            {records.length} {records.length === 1 ? 'event' : 'events'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-fg-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code, agent, hash..."
              className="rounded-xl border border-card-border bg-card py-1.5 pl-8 pr-3 text-xs text-fg outline-none focus:border-primary"
            />
          </div>

          <SegmentedControl
            aria-label="Filter audit records by decision"
            options={DECISION_FILTERS}
            value={decisionFilter}
            onChange={setDecisionFilter}
          />

          {records.length > 0 && (
            <div className="flex items-center space-x-1">
              <Button variant="secondary" size="sm" leftIcon={<Download className="h-3 w-3" />} onClick={handleExportJSON} title="Export audit trail as JSON">
                JSON
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Download className="h-3 w-3" />} onClick={handleExportCSV} title="Export audit trail as CSV">
                CSV
              </Button>
            </div>
          )}
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="p-12 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-fg-subtle" />
          <h3 className="mt-4 text-sm font-semibold text-fg">No Evaluation Records</h3>
          <p className="mt-1 text-xs text-fg-muted">
            {records.length === 0
              ? 'Trigger a transaction in the Rogue Agent Simulator or submit an x402 payment intent to view live audit traces.'
              : 'No audit records match the current filter or search criteria.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-fg-muted">
            <thead className="border-b border-card-border bg-card-muted text-xs font-semibold text-fg-muted uppercase">
              <tr>
                <th scope="col" className="px-6 py-3">Decision & Reason</th>
                <th scope="col" className="px-6 py-3">Type</th>
                <th scope="col" className="px-6 py-3">Agent</th>
                <th scope="col" className="px-6 py-3">Merchant</th>
                <th scope="col" className="px-6 py-3">Amount</th>
                <th scope="col" className="px-6 py-3">Reason Code</th>
                <th scope="col" className="px-6 py-3 text-right">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {paginatedRecords.map((rec) => {
                const isAllow = rec.decision.decision === 'ALLOW';
                return (
                  <React.Fragment key={rec.id}>
                    <tr className="hover:bg-card-muted transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        {isAllow ? (
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-danger shrink-0" />
                        )}
                        <div>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${
                              isAllow ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'
                            }`}
                          >
                            {rec.decision.decision}
                          </span>
                          <p className="mt-0.5 text-[11px] text-fg-muted">{rec.decision.reasonMessage}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      {rec.isSimulated ? (
                        <span className="rounded-md bg-warning-subtle px-2 py-0.5 text-[10px] font-bold text-warning font-mono">
                          SIMULATED
                        </span>
                      ) : (
                        <span className="rounded-md bg-success-subtle px-2 py-0.5 text-[10px] font-bold text-success font-mono">
                          ONCHAIN
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs">
                      {rec.agent.slice(0, 6)}...{rec.agent.slice(-4)}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs">
                      {rec.merchant.slice(0, 6)}...{rec.merchant.slice(-4)}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs font-semibold text-fg">
                      {(Number(rec.amountWei) / 1e18).toFixed(4)} MON
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-fg-muted">
                          ERR_{rec.decision.reasonCode} ({ReasonCode[rec.decision.reasonCode]})
                        </span>
                        {!isAllow && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCopilotRecordId(
                                expandedCopilotRecordId === rec.id ? null : rec.id
                              )
                            }
                            className="inline-flex items-center gap-1 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 text-[10px] font-bold cursor-pointer transition shrink-0"
                            title="Diagnose onchain denial with Qwen 3.8 Max Copilot"
                          >
                            <Sparkles className="h-2.5 w-2.5" />
                            Ask Copilot
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-4 text-right font-mono text-xs">
                      {rec.txHash ? (
                        <a
                          href={`${MONAD_EXPLORER_URL}/tx/${rec.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center space-x-1 font-semibold text-primary hover:underline"
                        >
                          <span>{rec.txHash.slice(0, 8)}...</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-fg-subtle text-[11px]">Dry Run / View</span>
                      )}
                    </td>
                  </tr>

                  {expandedCopilotRecordId === rec.id && (
                    <tr key={`${rec.id}-copilot`} className="bg-purple-500/5 border-b border-card-border">
                      <td colSpan={7} className="px-6 py-3.5">
                        <div className="rounded-xl border border-purple-500/30 bg-card p-3.5 space-y-2 font-sans">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 font-bold text-xs text-purple-400">
                              <Sparkles className="h-4 w-4" />
                              <span>Qwen 3.8 Max Copilot Denial Diagnosis (ADR-0008)</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setExpandedCopilotRecordId(null)}
                              className="text-xs text-fg-muted hover:text-fg font-mono cursor-pointer"
                            >
                              ✕ Close
                            </button>
                          </div>
                          <p className="text-xs text-fg leading-relaxed">
                            {diagnoseOnchainDenial(rec.decision.reasonCode).rootCause}
                          </p>
                          <div className="text-[11px] text-fg-muted pt-1 border-t border-card-border flex items-center justify-between flex-wrap gap-2">
                            <span>
                              <strong>Actionable Fix:</strong>{' '}
                              {diagnoseOnchainDenial(rec.decision.reasonCode).remediationSteps[0]}
                            </span>
                            <span className="font-mono text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                              Remediation: {diagnoseOnchainDenial(rec.decision.reasonCode).recommendedAction}
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={filteredRecords.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCurrentPage(1);
        }}
      />
    </Card>
  );
};
