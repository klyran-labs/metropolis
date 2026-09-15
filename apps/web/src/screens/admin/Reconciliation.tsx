import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useReconciliation, type ReconciliationReport } from "../../api";
import { Badge, EmptyState, Surface, TokenAmount } from "../../design-system";
import { StatTile } from "../../charts";
import { useIdentity } from "../../identity";

type Entry = ReconciliationReport["entries"][number];

const statusTone = (status: string) =>
  status === "confirmed" ? "success" : status === "failed" ? "critical" : "warning";

const reconciliationFeatures = tableFeatures({});
const columnHelper = createColumnHelper<typeof reconciliationFeatures, Entry>();
const columns = columnHelper.columns([
  columnHelper.accessor("tenantName", { header: "Tenant" }),
  columnHelper.accessor("status", {
    header: "Payment status",
    cell: (info) => <Badge tone={statusTone(info.getValue())}>{info.getValue()}</Badge>,
  }),
  columnHelper.accessor("reconciled", {
    header: "Ledger match",
    cell: (info) =>
      info.row.original.status === "confirmed" ? (
        <Badge tone={info.getValue() ? "success" : "critical"}>
          {info.getValue() ? "Reconciled" : "Missing ledger entry"}
        </Badge>
      ) : (
        <Badge tone="neutral">n/a</Badge>
      ),
  }),
  columnHelper.accessor("amountBaseUnits", {
    header: "Amount",
    cell: (info) => <TokenAmount baseUnits={info.getValue()} />,
  }),
  columnHelper.accessor("failureReason", {
    header: "Failure reason",
    cell: (info) => info.getValue() ?? "—",
  }),
  columnHelper.accessor("createdAt", {
    header: "Created",
    cell: (info) => new Date(info.getValue()).toLocaleString(),
  }),
]);

export function AdminReconciliation() {
  const identity = useIdentity();
  const report = useReconciliation(identity.platformAccess);
  const rows = report.data?.entries ?? [];
  const table = useTable({ data: rows, columns, features: reconciliationFeatures });
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Admin / Reconciliation</span>
          <h1>Reconciliation</h1>
          <p>Every settlement attempt compared against its billing ledger entry.</p>
        </div>
      </header>
      {report.data && (
        <div className="stat-row">
          <StatTile
            label="Reconciled"
            value={String(report.data.summary.confirmedReconciled)}
            icon={<CheckCircle2 size={18} />}
            accent={2}
          />
          <StatTile
            label="Anomalies"
            value={String(report.data.summary.confirmedUnreconciled)}
            icon={<AlertTriangle size={18} />}
            accent={1}
          />
          <StatTile label="Pending" value={String(report.data.summary.pending)} icon={<Clock size={18} />} accent={3} />
          <StatTile label="Failed" value={String(report.data.summary.failed)} icon={<XCircle size={18} />} accent={4} />
        </div>
      )}
      <Surface>
        {report.isError ? (
          <EmptyState title="Reconciliation report unavailable" detail="We couldn't load the reconciliation report right now." />
        ) : rows.length ? (
          <div className="table-viewport">
            <table>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th key={header.id}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No payment attempts yet" detail="Reconciliation rows appear once a tenant attempts checkout." />
        )}
      </Surface>
    </div>
  );
}
