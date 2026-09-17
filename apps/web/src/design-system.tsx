import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";
import { clsx } from "clsx";
import { applyTheme, getStoredTheme, resolveTheme, type ResolvedTheme, type ThemeMode } from "./theme";

export function Mono({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode; className?: string }) {
  return (
    <span className={clsx("mono", className)} {...props}>
      {children}
    </span>
  );
}

/** Formats a raw onchain integer amount (no decimal point) as a human currency figure. */
export function formatTokenAmount(
  baseUnits: string | number | null | undefined,
  decimals = 6,
): string {
  if (baseUnits === null || baseUnits === undefined || baseUnits === "") return "—";
  let value: bigint;
  try {
    value = typeof baseUnits === "number" ? BigInt(Math.trunc(baseUnits)) : BigInt(baseUnits);
  } catch {
    return "—";
  }
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = magnitude / divisor;
  const fraction = magnitude % divisor;
  const fractionStr = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, 2);
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}.${fractionStr}`;
}

const roleLabels: Record<string, string> = {
  super_admin: "Owner",
  sec_ops: "Security",
  treasury: "Treasury",
  fleet_devops: "Fleet operator",
  agent_developer: "Developer",
  auditor: "Auditor",
};

/** Converts an internal RBAC role string into a name a teammate would recognize. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "Role pending";
  return roleLabels[role] ?? role.replace(/_/g, " ");
}

/** Shortens a long identifier (address, DID) to fit tight UI, keeping both ends readable. */
export function truncateMiddle(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function TokenAmount({
  baseUnits,
  symbol = "USDC",
  className,
}: {
  baseUnits: string | number | null | undefined;
  symbol?: string;
  className?: string;
}) {
  return (
    <span className={clsx("token-amount", className)}>
      {formatTokenAmount(baseUnits)} <small>{symbol}</small>
    </span>
  );
}

export function TextField({
  label,
  icon,
  className,
  placeholder: _placeholder,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; icon?: ReactNode }) {
  const id = useId();
  return (
    <div className={clsx("m3-field", icon && "m3-field-has-icon", className)}>
      {icon && <span className="m3-field-icon">{icon}</span>}
      <input id={id} placeholder=" " {...props} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function Button({
  className,
  variant = "filled",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "filled" | "tonal" | "text";
}) {
  return (
    <button
      type="button"
      className={clsx("control", `control-${variant}`, className)}
      {...props}
    />
  );
}

export function Surface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={clsx("surface", className)}>{children}</section>;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const handleClose = () => onClose();
    node.addEventListener("close", handleClose);
    return () => node.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="m3-dialog"
      aria-labelledby="m3-dialog-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          ref.current?.close();
        }
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          ref.current?.close();
        }
      }}
    >
      <div className="m3-dialog-header">
        <h2 id="m3-dialog-title">{title}</h2>
        {description && <p className="m3-dialog-description">{description}</p>}
      </div>
      <div className="m3-dialog-body">{children}</div>
      <div className="m3-dialog-footer">{footer}</div>
    </dialog>
  );
}

export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <span className="status-dot" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export type BadgeTone = "success" | "warning" | "critical" | "neutral" | "info";

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={clsx("badge", `badge-${tone}`, className)}>{children}</span>;
}

function titleCase(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

export function RecordSummary({
  record,
  labels = {},
}: {
  record: Record<string, unknown> | null | undefined;
  labels?: Record<string, string>;
}) {
  if (!record) return null;
  const entries = Object.entries(record).filter(([, value]) => value !== null && value !== undefined);
  return (
    <dl className="record-summary">
      {entries.map(([key, value]) => (
        <div className="record-summary-row" key={key}>
          <dt>{labels[key] ?? titleCase(key)}</dt>
          <dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredTheme());
  const [systemPrefers, setSystemPrefers] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSync = (e: Event) => {
      const ce = e as CustomEvent<{ mode: ThemeMode; resolved: ResolvedTheme }>;
      if (ce.detail?.mode && ce.detail.mode !== mode) {
        setModeState(ce.detail.mode);
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "agentguard-theme" && e.newValue) {
        const val = e.newValue as ThemeMode;
        if (val === "light" || val === "dark" || val === "system") {
          setModeState(val);
        }
      }
    };
    window.addEventListener("agentguard:theme-change", handleSync);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("agentguard:theme-change", handleSync);
      window.removeEventListener("storage", handleStorage);
    };
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemPrefers(e.matches ? "dark" : "light");
      if (mode === "system") {
        applyTheme("system");
      }
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [mode]);

  const resolved = mode === "system" ? systemPrefers : mode;

  const toggleTheme = () => {
    // 1-click direct toggle: if currently dark (system or manual), switch to light; if light, switch to dark
    const nextMode: ThemeMode = resolved === "dark" ? "light" : "dark";
    applyTheme(nextMode);
    setModeState(nextMode);
  };

  const setMode = (next: ThemeMode) => {
    applyTheme(next);
    setModeState(next);
  };

  return { mode, resolved, setMode, toggleTheme };
}

export function ThemeToggle() {
  const { resolved, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      title={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
      onClick={toggleTheme}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </span>
    </button>
  );
}
