/** Format an exact native-token amount from wei, without floating point math. */
export function formatMonAmount(amountWei: string | bigint, decimals = 4): string {
  return formatUnitsAmount(amountWei, 18, decimals);
}

/** Format token base units with deterministic truncation for display. */
export function formatUnitsAmount(amountBaseUnits: string | bigint, tokenDecimals: number, decimals = 4): string {
  const amount = BigInt(amountBaseUnits);
  const unit = 10n ** BigInt(tokenDecimals);
  const scale = 10n ** BigInt(decimals);
  const scaled = (amount * scale) / unit;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, '0');
  return `${whole}.${fraction}`;
}

/**
 * Format true basis points on a 0-10,000 scale (e.g. 9850 -> "98.50%").
 *
 * NOT for `scoreBps` from ReputationRegistry: despite the field's name, it is
 * on a 0-1,000,000 parts-per-million scale (see docs/ADR/0004 and
 * docs/GAP_ANALYSIS.md). This function is currently unused in the app; if you
 * reach for it to format a reputation score, use `value / 10_000` (as
 * FleetOverview.tsx and LifecycleStudio.tsx already do correctly), not this
 * function's `/ 100` — that would be off by 100x.
 */
export function formatBps(bps: number | bigint): string {
  const val = Number(bps);
  return `${(val / 100).toFixed(2)}%`;
}

/** Format a non-negative ratio without converting monetary values to Number. */
export function formatRatio(numerator: string | bigint, denominator: string | bigint, decimals = 1): string | null {
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  if (bottom <= 0n) return null;
  const scale = 10n ** BigInt(decimals);
  const scaled = (top * scale) / bottom;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, '0');
  return `${whole}.${fraction}`;
}
