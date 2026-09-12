const WEI_PER_MON = 1_000_000_000_000_000_000n;
const SECONDS_PER_HOUR = 3_600n;

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

/** Calculate an exact MON commitment from a wei/second rate and duration. */
export function formatMonCommitment(pricePerSecond: string | bigint, amountSeconds: string | bigint, decimals = 4): string {
  return formatMonAmount(BigInt(pricePerSecond) * BigInt(amountSeconds), decimals);
}

/** Format a wei/second price as an exact, fixed four-decimal MON/hour value. */
export function formatMonHourlyRate(pricePerSecond: string | bigint): string {
  const hourlyWei = BigInt(pricePerSecond) * SECONDS_PER_HOUR;
  const whole = hourlyWei / WEI_PER_MON;
  const fraction = (hourlyWei % WEI_PER_MON).toString().padStart(18, '0').slice(0, 4);
  return `${whole}.${fraction}`;
}

/** Format a capacity duration without converting the source seconds to Number. */
export function formatCapacityHours(amountSeconds: string | bigint, decimals = 2): string {
  const seconds = BigInt(amountSeconds);
  const scale = 10n ** BigInt(decimals);
  const scaled = (seconds * scale) / SECONDS_PER_HOUR;
  const whole = scaled / scale;
  if (decimals === 0) return whole.toString();
  const fraction = (scaled % scale).toString().padStart(decimals, '0');
  return `${whole}.${fraction}`;
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
