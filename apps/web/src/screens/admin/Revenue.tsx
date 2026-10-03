import { useMemo } from "react";
import { CircleDollarSign, Layers, Undo2 } from "lucide-react";
import { useRevenueSummary } from "../../api";
import { EmptyState, Surface, formatTokenAmount } from "../../design-system";
import { Bars, StatTile, TrendArea } from "../../charts";
import { useIdentity } from "../../identity";

export function AdminRevenue() {
  const identity = useIdentity();
  const revenue = useRevenueSummary(identity.platformAccess);

  const dailyRevenue = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const point of revenue.data?.dailySeries ?? []) {
      const day = point.day.slice(0, 10);
      const amount = Number(point.amountBaseUnits) / 1_000_000;
      const signed = point.entryType === "refund" ? -amount : amount;
      byDay.set(day, (byDay.get(day) ?? 0) + signed);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label: label.slice(5), value }));
  }, [revenue.data]);

  const byPlan = useMemo(
    () =>
      (revenue.data?.revenueByPlan ?? []).map((row) => ({
        label: row.name,
        value: Number(row.amountBaseUnits) / 1_000_000,
      })),
    [revenue.data],
  );

  const currencyFormatter = (value: number) =>
    `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Revenue</h1>
          <p>Confirmed revenue across all tenants.</p>
        </div>
      </header>

      {revenue.isError ? (
        <Surface>
          <EmptyState title="Couldn't load revenue" detail="Try refreshing the page." />
        </Surface>
      ) : (
        <>
          <div className="stat-row">
            <StatTile
              label="Total confirmed revenue"
              value={`$${formatTokenAmount(revenue.data?.totalRevenueBaseUnits)}`}
              icon={<CircleDollarSign size={18} />}
              accent={0}
            />
            <StatTile
              label="Total refunds"
              value={`$${formatTokenAmount(revenue.data?.totalRefundsBaseUnits)}`}
              icon={<Undo2 size={18} />}
              accent={4}
            />
            <StatTile
              label="Plans generating revenue"
              value={String(revenue.data?.revenueByPlan.length ?? 0)}
              icon={<Layers size={18} />}
              accent={5}
            />
          </div>
          <Surface>
            <div className="card-heading">
              <div>
                <span className="card-kicker">Trend</span>
                <h2>Net revenue, last 90 days</h2>
              </div>
            </div>
            <TrendArea
              data={dailyRevenue}
              seriesName="Net revenue"
              emptyTitle="No confirmed settlement yet"
              emptyDetail="Revenue appears once tenant subscriptions are paid."
              valueFormatter={currencyFormatter}
            />
          </Surface>
          <Surface>
            <div className="card-heading">
              <div>
                <span className="card-kicker">Breakdown</span>
                <h2>Revenue by plan</h2>
              </div>
            </div>
            <Bars
              data={byPlan}
              emptyTitle="No plan revenue yet"
              emptyDetail="Revenue by plan appears once a subscription settles."
              valueFormatter={currencyFormatter}
            />
          </Surface>
        </>
      )}
    </div>
  );
}
