import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { usePlatformLedger, type PlatformLedgerEntry } from "../../api";
import { Badge, EmptyState, Mono, Surface, TokenAmount } from "../../design-system";
import { useIdentity } from "../../identity";

const entryTypeLabel: Record<string, string> = {
  refund: "Refund",
  charge: "Payment",
  settlement: "Payment",
};

const ledgerFeatures = tableFeatures({});
const columnHelper = createColumnHelper<typeof ledgerFeatures, PlatformLedgerEntry>();
const columns = columnHelper.columns([
  columnHelper.accessor("tenantName", { header: "Tenant" }),
  columnHelper.accessor("entryType", {
    header: "Type",
    cell: (info) => (
      <Badge tone={info.getValue() === "refund" ? "warning" : "success"}>
        {entryTypeLabel[info.getValue()] ?? info.getValue()}
      </Badge>
    ),
  }),
  columnHelper.accessor("amountBaseUnits", {
    header: "Amount",
    cell: (info) => <TokenAmount baseUnits={info.getValue()} />,
  }),
  columnHelper.accessor("transactionHash", {
    header: "Receipt",
    cell: (info) => (
      <Mono>
        {info.getValue().slice(0, 10)}…{info.getValue().slice(-8)}
      </Mono>
    ),
  }),
  columnHelper.accessor("createdAt", {
    header: "Date",
    cell: (info) => new Date(info.getValue()).toLocaleString(),
  }),
]);

export function AdminLedger() {
  const identity = useIdentity();
  const ledger = usePlatformLedger(identity.platformAccess);
  const rows = ledger.data ?? [];
  const table = useTable({ data: rows, columns, features: ledgerFeatures });
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Payment history</h1>
          <p>Confirmed payments and refunds, with receipts.</p>
        </div>
      </header>
      <Surface>
        {ledger.isError ? (
          <EmptyState title="Couldn't load payment history" detail="Try refreshing the page." />
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
          <EmptyState title="No payments yet" detail="Confirmed payments will appear here." />
        )}
      </Surface>
    </div>
  );
}
