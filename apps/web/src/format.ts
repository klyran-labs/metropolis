// The single place that turns values into text people read: money, numbers, percentages, dates,
// times and relative times. Screens call these instead of hand-rolling toFixed / toLocaleString.
//
// Rules this module enforces:
//  * One locale for the whole app (the browser's preferred language, overridable for tests).
//  * Money never passes through binary floating point: base-unit integers are turned into exact
//    decimal strings and formatted by Intl, so large and tiny amounts stay correct.
//  * Intl formatters are built once per locale and options and reused; constructing them is
//    expensive and tables format thousands of cells.
//  * Missing or malformed values render as an em dash, never "NaN" or "Invalid Date".

const MISSING = "—";

let localeOverride: string | undefined;

/** Forces a locale (tests, or a future language picker). Pass nothing to follow the browser again. */
export function setFormatLocale(locale?: string) {
  localeOverride = locale;
}

export function formatLocale(): string {
  if (localeOverride) return localeOverride;
  if (typeof navigator !== "undefined") {
    const preferred = navigator.languages?.[0] ?? navigator.language;
    try {
      if (preferred && Intl.NumberFormat.supportedLocalesOf(preferred).length > 0) return preferred;
    } catch {
      // malformed language tag: fall through to the default
    }
  }
  return "en-US";
}

const formatterCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(
  kind: "number" | "date" | "relative",
  options: object,
  build: (locale: string) => T,
): T {
  const locale = formatLocale();
  const key = `${kind}|${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = build(locale);
    formatterCache.set(key, formatter);
  }
  return formatter as T;
}

// Intl formats exact decimal strings (not just numbers); the standard typings only say `number`.
const asIntlInput = (decimal: string) => decimal as unknown as number;

export type FractionDigits = { minimumFractionDigits?: number; maximumFractionDigits?: number };

function numberFormat(options: Intl.NumberFormatOptions) {
  return cached("number", options, (locale) => new Intl.NumberFormat(locale, options));
}

/**
 * Turns an integer count of base units (for example 1234567 micro-USDC) into an exact decimal
 * string ("1.234567"). Returns null when the input is not a whole number.
 */
export function decimalFromBaseUnits(
  baseUnits: bigint | string | number | null | undefined,
  decimals = 6,
): string | null {
  if (baseUnits === null || baseUnits === undefined || baseUnits === "") return null;
  let digits: string;
  let negative = false;
  if (typeof baseUnits === "bigint") {
    negative = baseUnits < 0n;
    digits = (negative ? -baseUnits : baseUnits).toString();
  } else if (typeof baseUnits === "number") {
    if (!Number.isFinite(baseUnits)) return null;
    const whole = Math.trunc(baseUnits);
    negative = whole < 0;
    digits = BigInt(Math.abs(whole)).toString();
  } else {
    const match = /^(-?)(\d+)$/.exec(baseUnits.trim());
    if (!match) return null;
    negative = match[1] === "-";
    digits = match[2].replace(/^0+(?=\d)/, "");
  }
  if (decimals <= 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(decimals + 1, "0");
  const point = padded.length - decimals;
  const text = `${padded.slice(0, point)}.${padded.slice(point)}`;
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

/**
 * A plain decimal string for a form input ("1.23"): locale independent, so number inputs accept it,
 * and truncated rather than rounded so a "use maximum" button can never offer more than is available.
 */
export function toInputAmount(
  baseUnits: bigint | string | number | null | undefined,
  options: { decimals?: number; digits?: number } = {},
): string {
  const digits = options.digits ?? 2;
  const decimal = decimalFromBaseUnits(baseUnits, options.decimals ?? 6);
  if (decimal === null || decimal.startsWith("-")) return digits > 0 ? `0.${"0".repeat(digits)}` : "0";
  const [whole, fraction = ""] = decimal.split(".");
  return digits > 0 ? `${whole}.${fraction.padEnd(digits, "0").slice(0, digits)}` : whole;
}

/** "1,234.50": an exact base-unit amount with grouping and a fixed number of decimals. */
export function formatBaseUnits(
  baseUnits: bigint | string | number | null | undefined,
  options: FractionDigits & { decimals?: number } = {},
): string {
  const decimal = decimalFromBaseUnits(baseUnits, options.decimals ?? 6);
  if (decimal === null) return MISSING;
  const minimumFractionDigits = options.minimumFractionDigits ?? 2;
  const maximumFractionDigits = Math.max(options.maximumFractionDigits ?? 2, minimumFractionDigits);
  return numberFormat({ minimumFractionDigits, maximumFractionDigits }).format(asIntlInput(decimal));
}

/** "$1,234.50" from a dollar amount that is already a number or a decimal string. */
export function formatUsd(value: number | string | null | undefined, options: FractionDigits = {}): string {
  if (value === null || value === undefined || value === "") return MISSING;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return MISSING;
  const minimumFractionDigits = options.minimumFractionDigits ?? 2;
  const maximumFractionDigits = Math.max(options.maximumFractionDigits ?? 2, minimumFractionDigits);
  return numberFormat({ style: "currency", currency: "USD", minimumFractionDigits, maximumFractionDigits }).format(
    typeof value === "string" ? asIntlInput(value.trim()) : value,
  );
}

/** "$1,234.50" from an exact base-unit amount. */
export function formatUsdBaseUnits(
  baseUnits: bigint | string | number | null | undefined,
  options: FractionDigits & { decimals?: number } = {},
): string {
  const decimal = decimalFromBaseUnits(baseUnits, options.decimals ?? 6);
  if (decimal === null) return MISSING;
  return formatUsd(decimal, options);
}

/** A small unit price from micro-dollars, with a fixed number of decimals ("$0.0020"). */
export function formatMicroUsd(micro: number | null | undefined, digits = 4): string {
  if (micro === null || micro === undefined || !Number.isFinite(micro)) return MISSING;
  return formatUsdBaseUnits(Math.round(micro), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatNumber(value: number | null | undefined, options: FractionDigits = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  return numberFormat({
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
  }).format(value);
}

/** A number with exactly `digits` decimals ("2.80"). */
export function formatFixed(value: number | null | undefined, digits: number): string {
  return formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "1.2K", "3.4M": for chart axes and tight tiles. */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  return numberFormat({ notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** A value already expressed in percentage points: formatPercent(10) is "10.0%". */
export function formatPercent(points: number | null | undefined, digits = 1): string {
  if (points === null || points === undefined || !Number.isFinite(points)) return MISSING;
  return numberFormat({ style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    points / 100,
  );
}

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFormat(options: Intl.DateTimeFormatOptions) {
  return cached("date", options, (locale) => new Intl.DateTimeFormat(locale, options));
}

/** "Oct 3, 2026" */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? dateFormat({ dateStyle: "medium" }).format(date) : MISSING;
}

/** "Oct 3, 2026, 12:00 PM" */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return date ? dateFormat({ dateStyle: "medium", timeStyle: "short" }).format(date) : MISSING;
}

/** "12:00 PM", or "12:00:05 PM" with seconds. */
export function formatTime(value: DateInput, options: { seconds?: boolean } = {}): string {
  const date = toDate(value);
  if (!date) return MISSING;
  return dateFormat(
    options.seconds ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : { hour: "numeric", minute: "2-digit" },
  ).format(date);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
];

/** "5 minutes ago", "in 2 hours"; falls back to a date once it is more than about a month away. */
export function formatRelativeTime(value: DateInput, now: number = Date.now()): string {
  const date = toDate(value);
  if (!date) return MISSING;
  let amount = Math.round((date.getTime() - now) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(amount) < size) {
      return cached("relative", { numeric: "auto" }, (locale) => new Intl.RelativeTimeFormat(locale, { numeric: "auto" })).format(
        amount,
        unit,
      );
    }
    amount = Math.round(amount / size);
  }
  return formatDate(date);
}
