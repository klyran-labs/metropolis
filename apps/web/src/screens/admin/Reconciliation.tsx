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
    header: "Checked",
    cell: (info) =>
      info.row.original.status === "confirmed" ? (
        <Badge tone={info.getValue() ? "success" : "critical"}>
          {info.getValue() ? "Matched" : "Needs review"}
        </Badge>
      ) : (
        <Badge tone="neutral">Not applicable</Badge>
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
          <h1>Payment checks</h1>
          <p>We check every payment against the record. Anything that doesn't match shows up here.</p>
        </div>
      </header>
      {report.data && (
        <div className="stat-row">
          <StatTile
            label="Matched"
            value={String(report.data.summary.confirmedReconciled)}
            icon={<CheckCircle2 size={18} />}
            accent={2}
          />
          <StatTile
            label="Needs review"
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
          <EmptyState kind="warning" title="Couldn't load payment checks" detail="Try refreshing the page." />
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
          <EmptyState kind="neutral" title="No payment attempts yet" detail="Rows appear here once a tenant attempts checkout." />
        )}
      </Surface>
    </div>
  );
}
