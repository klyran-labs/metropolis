import { useMemo } from "react";
import { Building2, CircleDollarSign, ReceiptText, Undo2 } from "lucide-react";
import { usePlatformLedger, usePlatformTenants, useRevenueSummary } from "../../api";
import { Surface, formatTokenAmount } from "../../design-system";
import { Breakdown, Gauge, StatTile, TrendArea } from "../../charts";
import { useIdentity } from "../../identity";

export function AdminOverview() {
  const identity = useIdentity();
  const enabled = identity.platformAccess;
  const revenue = useRevenueSummary(enabled);
  const tenants = usePlatformTenants(enabled);
  const ledger = usePlatformLedger(enabled);

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

  const statusBreakdown = useMemo(
    () =>
      (revenue.data?.subscriptionsByStatus ?? []).map((row) => ({
        label: row.status,
        value: row.count,
      })),
    [revenue.data],
  );

  const activeSubscriptions =
    revenue.data?.subscriptionsByStatus.find((row) => row.status === "active")?.count ?? 0;
  const totalSubscriptions =
    revenue.data?.subscriptionsByStatus.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const recentLedger = ledger.data?.slice(0, 6) ?? [];

  return (
    <div className="dashboard-stack">
      <header className="dashboard-header">
        <div>
          <h1>Home</h1>
          <p>Tenants, revenue, and subscription health across the platform.</p>
        </div>
      </header>

      <div className="stat-row">
        <StatTile label="Tenants" value={String(tenants.data?.length ?? 0)} icon={<Building2 size={18} />} accent={0} />
        <StatTile
          label="Active subscriptions"
          value={String(activeSubscriptions)}
          icon={<ReceiptText size={18} />}
          accent={2}
        />
        <StatTile
          label="Total revenue"
          value={`$${formatTokenAmount(revenue.data?.totalRevenueBaseUnits)}`}
          trend={dailyRevenue.map((point) => point.value)}
          icon={<CircleDollarSign size={18} />}
          accent={1}
        />
        <StatTile
          label="Total refunds"
          value={`$${formatTokenAmount(revenue.data?.totalRefundsBaseUnits)}`}
          icon={<Undo2 size={18} />}
          accent={4}
        />
      </div>

      <div className="dashboard-grid">
        <Surface className="dashboard-card dashboard-card-wide">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Finance</span>
              <h2>Revenue, last 90 days</h2>
            </div>
          </div>
          <TrendArea
            data={dailyRevenue}
            seriesName="Net revenue"
            emptyTitle="No confirmed settlement yet"
            emptyDetail="Revenue appears once tenant subscriptions are paid."
            valueFormatter={(value) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          />
        </Surface>

        <Surface className="dashboard-card dashboard-card-medium">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Lifecycle</span>
              <h2>Active subscription ratio</h2>
            </div>
          </div>
          <Gauge
            label="Active"
            value={totalSubscriptions ? (activeSubscriptions / totalSubscriptions) * 100 : 0}
            detail={`${activeSubscriptions} of ${totalSubscriptions} subscriptions active`}
          />
        </Surface>

        <Surface className="dashboard-card dashboard-card-medium">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Lifecycle</span>
              <h2>Subscriptions by status</h2>
            </div>
          </div>
          <Breakdown
            data={statusBreakdown}
            emptyTitle="No subscriptions yet"
            emptyDetail="Subscription status will appear once a tenant subscribes."
          />
        </Surface>

        <Surface className="dashboard-card dashboard-card-large">
          <div className="card-heading">
            <div>
              <span className="card-kicker">Activity</span>
              <h2>Recent payments</h2>
            </div>
          </div>
          {recentLedger.length ? (
            <div className="activity-list">
              {recentLedger.map((entry) => (
                <div className="activity-row" key={entry.id}>
                  <span className="activity-icon">•</span>
                  <div>
                    <strong>{entry.tenantName}</strong>
                    <small>{entry.entryType === "refund" ? "Refund" : "Payment"}</small>
                  </div>
                  <time>{new Date(entry.createdAt).toLocaleDateString()}</time>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-empty">
              <strong>No recent activity.</strong>
              <p>Confirmed payments will appear here.</p>
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
