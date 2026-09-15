import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { usePlatformLedger, type PlatformLedgerEntry } from "../../api";
import { Badge, EmptyState, Mono, Surface, TokenAmount } from "../../design-system";
import { useIdentity } from "../../identity";

const ledgerFeatures = tableFeatures({});
const columnHelper = createColumnHelper<typeof ledgerFeatures, PlatformLedgerEntry>();
const columns = columnHelper.columns([
  columnHelper.accessor("tenantName", { header: "Tenant" }),
  columnHelper.accessor("entryType", {
    header: "Entry",
    cell: (info) => <Badge tone={info.getValue() === "refund" ? "warning" : "success"}>{info.getValue()}</Badge>,
  }),
  columnHelper.accessor("amountBaseUnits", {
    header: "Amount",
    cell: (info) => <TokenAmount baseUnits={info.getValue()} />,
  }),
  columnHelper.accessor("chainId", { header: "Chain" }),
  columnHelper.accessor("transactionHash", {
    header: "Transaction",
    cell: (info) => (
      <Mono>
        {info.getValue().slice(0, 10)}…{info.getValue().slice(-8)}
      </Mono>
    ),
  }),
  columnHelper.accessor("createdAt", {
    header: "Recorded",
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
          <span className="eyebrow">Admin / Billing ledger</span>
          <h1>Billing ledger</h1>
          <p>Only confirmed onchain settlement entries appear here.</p>
        </div>
      </header>
      <Surface>
        {ledger.isError ? (
          <EmptyState title="Billing ledger unavailable" detail="We couldn't load billing entries right now." />
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
          <EmptyState title="No confirmed billing entries" detail="Confirmed subscription settlements will appear here." />
        )}
      </Surface>
    </div>
  );
}
