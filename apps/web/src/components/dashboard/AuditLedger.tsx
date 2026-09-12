import React, { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, ExternalLink, ShieldAlert, Download, Search, Filter } from 'lucide-react';
import { type PolicyDecision, ReasonCode, REASON_CODE_MESSAGES } from '@agentguard/shared-types';
import { MONAD_EXPLORER_URL } from '../../config/contracts';

export interface AuditRecord {
  id: string;
  txHash: `0x${string}`;
  agent: `0x${string}`;
  merchant: `0x${string}`;
  amountWei: bigint;
  decision: PolicyDecision;
  timestamp: bigint;
}

interface AuditLedgerProps {
  records: AuditRecord[];
}

export const AuditLedger: React.FC<AuditLedgerProps> = ({ records }) => {
  const [decisionFilter, setDecisionFilter] = useState<'ALL' | 'ALLOW' | 'DENY'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      const matchesDecision =
        decisionFilter === 'ALL' || rec.decision.decision === decisionFilter;

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        rec.txHash.toLowerCase().includes(q) ||
        rec.agent.toLowerCase().includes(q) ||
        rec.merchant.toLowerCase().includes(q) ||
        rec.decision.reasonMessage.toLowerCase().includes(q);

      return matchesDecision && matchesSearch;
    });
  }, [records, decisionFilter, searchQuery]);

  const handleExportJSON = () => {
    const exportData = records.map((rec) => ({
      id: rec.id,
      txHash: rec.txHash,
      agent: rec.agent,
      merchant: rec.merchant,
      amountWei: rec.amountWei.toString(),
      decision: rec.decision.decision,
      reasonCode: rec.decision.reasonCode,
      reasonMessage: rec.decision.reasonMessage,
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
    const headers = ['ID', 'TxHash', 'Agent', 'Merchant', 'AmountWei', 'Decision', 'ReasonCode', 'ReasonMessage', 'Timestamp'];
    const rows = records.map((rec) => [
      rec.id,
      rec.txHash,
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
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 font-sans">
      {/* Table Header & Controls */}
      <div className="flex flex-col space-y-3 border-b border-slate-200/80 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Verifiable Policy Audit Trail
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Machine-readable reason codes emitted by Monad `PolicyEngine` for every agent spend evaluation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tx, agent, reason..."
              className="rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-[#254BFF] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Decision Filter Pills */}
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
            {(['ALL', 'ALLOW', 'DENY'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setDecisionFilter(filter)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  decisionFilter === filter
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Export Dropdown / Buttons */}
          {records.length > 0 && (
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={handleExportJSON}
                className="inline-flex items-center space-x-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition-colors"
                title="Export audit trail as JSON"
              >
                <Download className="h-3 w-3" />
                <span>JSON</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center space-x-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition-colors"
                title="Export audit trail as CSV"
              >
                <Download className="h-3 w-3" />
                <span>CSV</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="p-12 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">No Evaluation Records</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {records.length === 0
              ? 'Trigger a transaction in the Rogue Agent Simulator or submit an x402 payment intent to view live audit traces.'
              : 'No audit records match the current filter or search criteria.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-6 py-3">Decision & Reason</th>
                <th scope="col" className="px-6 py-3">Agent</th>
                <th scope="col" className="px-6 py-3">Merchant</th>
                <th scope="col" className="px-6 py-3">Amount</th>
                <th scope="col" className="px-6 py-3">Reason Code</th>
                <th scope="col" className="px-6 py-3 text-right">Monad Explorer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
              {filteredRecords.map((rec) => {
                const isAllow = rec.decision.decision === 'ALLOW';
                return (
                  <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        {isAllow ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-rose-500 shrink-0" />
                        )}
                        <div>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${
                              isAllow
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {rec.decision.decision}
                          </span>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {rec.decision.reasonMessage}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4 font-mono text-xs">
                      {rec.agent.slice(0, 6)}...{rec.agent.slice(-4)}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs">
                      {rec.merchant.slice(0, 6)}...{rec.merchant.slice(-4)}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs font-semibold text-slate-900 dark:text-white">
                      {(Number(rec.amountWei) / 1e18).toFixed(4)} MON
                    </td>

                    <td className="px-6 py-4">
                      <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                        ERR_{rec.decision.reasonCode} ({ReasonCode[rec.decision.reasonCode]})
                      </span>
                    </td>

                    <td className="px-6 py-4 text-right">
                      <a
                        href={`${MONAD_EXPLORER_URL}/tx/${rec.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        <span>{rec.txHash.slice(0, 8)}...</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
