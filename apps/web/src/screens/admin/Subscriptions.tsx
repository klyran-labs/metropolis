import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { usePlatformSubscriptions, type PlatformSubscription } from "../../api";
import { Badge, EmptyState, Surface, TokenAmount } from "../../design-system";
import { useIdentity } from "../../identity";

const statusTone = (status: string) =>
  status === "active" ? "success" : status === "past_due" ? "warning" : status === "cancelled" || status === "expired" ? "critical" : "neutral";

const statusLabel: Record<string, string> = {
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
  expired: "Expired",
};

const subscriptionFeatures = tableFeatures({});
const columnHelper = createColumnHelper<typeof subscriptionFeatures, PlatformSubscription>();
const columns = columnHelper.columns([
  columnHelper.accessor("tenantName", { header: "Tenant" }),
  columnHelper.accessor("planCode", { header: "Plan" }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => <Badge tone={statusTone(info.getValue())}>{statusLabel[info.getValue()] ?? info.getValue()}</Badge>,
  }),
  columnHelper.accessor("amountBaseUnits", {
    header: "Amount",
    cell: (info) => (
      <>
        <TokenAmount baseUnits={info.getValue()} /> / {info.row.original.interval}
      </>
    ),
  }),
  columnHelper.accessor("currentPeriodEnd", {
    header: "Renews",
    cell: (info) => new Date(info.getValue()).toLocaleDateString(),
  }),
]);

export function AdminSubscriptions() {
  const identity = useIdentity();
  const subscriptions = usePlatformSubscriptions(identity.platformAccess);
  const rows = subscriptions.data ?? [];
  const table = useTable({ data: rows, columns, features: subscriptionFeatures });
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Subscriptions</h1>
          <p>Lifecycle state for tenant subscriptions across the platform.</p>
        </div>
      </header>
      <Surface>
        {subscriptions.isError ? (
          <EmptyState title="Subscription directory unavailable" detail="We couldn't load subscriptions right now." />
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
          <EmptyState title="No subscriptions yet" detail="Subscriptions will appear once a tenant checks out a plan." />
        )}
      </Surface>
    </div>
  );
}
