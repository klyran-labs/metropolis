/**
 * Named polling intervals (ms). Keeping them in one place makes the request load of the
 * dashboard auditable and lets us tune latency vs. load without hunting through hooks.
 * React Query pauses these while the tab is hidden.
 */
export const POLL = {
  /** Streams the user is actively watching (activity feed, live balances during a transfer). */
  live: 3_000,
  /** On-chain state shown beside an editable form. */
  fast: 4_000,
  /** Ambient dashboard data. */
  normal: 5_000,
  /** Slow-changing data such as reputation. */
  slow: 15_000,
  /** Background "needs attention" signals (sidebar badge, Home). */
  attention: 20_000,
} as const;
