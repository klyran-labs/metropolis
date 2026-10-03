import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Inbox,
  Key,
  Moon,
  Search,
  Shield,
  ShieldCheck,
  Store,
  Sun,
  SunMoon,
  Wallet,
  X,
} from "lucide-react";
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
  placeholder = " ",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; icon?: ReactNode }) {
  const id = useId();
  return (
    <div className={clsx("m3-field", icon && "m3-field-has-icon", className)}>
      {icon && <span className="m3-field-icon">{icon}</span>}
      <input id={id} placeholder={placeholder || " "} {...props} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  detail?: string;
  badge?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export function Select<T extends string = string>({
  label,
  value,
  onChange,
  options,
  placeholder = "Select an option",
  icon,
  className = "",
  disabled = false,
  error,
}: {
  label?: string;
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setSearch("");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const filteredOptions = search.trim()
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          (o.detail && o.detail.toLowerCase().includes(search.toLowerCase()))
      )
    : options;

  return (
    <div
      ref={containerRef}
      className={clsx("custom-select-container", className, open && "is-open", disabled && "is-disabled")}
    >
      {label && <label className="custom-select-label">{label}</label>}
      <button
        type="button"
        className={clsx("custom-select-trigger", error && "has-error")}
        onClick={() => {
          if (!disabled) {
            setOpen((prev) => !prev);
            setSearch("");
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <div className="custom-select-trigger-content">
          {icon && <span className="custom-select-icon">{icon}</span>}
          {selectedOption ? (
            <div className="custom-select-selected-row">
              <span className="custom-select-title">{selectedOption.label}</span>
              {selectedOption.detail && (
                <span className="custom-select-detail">{selectedOption.detail}</span>
              )}
              {selectedOption.badge}
            </div>
          ) : (
            <span className="custom-select-placeholder">{placeholder}</span>
          )}
        </div>
        <ChevronDown size={15} className={clsx("custom-select-chevron", open && "rotated")} />
      </button>

      {open && (
        <div className="custom-select-menu" role="listbox">
          {options.length > 5 && (
            <div className="custom-select-search-wrap">
              <Search size={13} className="custom-select-search-icon" />
              <input
                ref={inputRef}
                type="text"
                className="custom-select-search-input"
                placeholder="Search options..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
          )}
          <div className="custom-select-options-list">
            {filteredOptions.length === 0 ? (
              <div className="custom-select-empty">No matching options</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    className={clsx(
                      "custom-select-option",
                      isSelected && "is-selected",
                      opt.disabled && "is-disabled"
                    )}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <div className="custom-select-option-left">
                      {opt.icon && <span className="custom-select-option-icon">{opt.icon}</span>}
                      <div className="custom-select-option-text">
                        <span className="custom-select-option-label">{opt.label}</span>
                        {opt.detail && (
                          <span className="custom-select-option-detail">{opt.detail}</span>
                        )}
                      </div>
                    </div>
                    <div className="custom-select-option-right">
                      {opt.badge}
                      {isSelected && <Check size={14} className="custom-select-check" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
      {error && <span className="custom-select-error">{error}</span>}
    </div>
  );
}

export function AgentSelect({
  label = "Target Agent",
  value,
  onChange,
  agents,
  placeholder = "Select an autonomous agent...",
  className = "",
  disabled = false,
}: {
  label?: string;
  value: string;
  onChange: (address: string) => void;
  agents: Array<{
    address: string;
    label?: string | null;
    riskTier?: string;
    environment?: string;
    status?: string;
  }>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const options: SelectOption[] = agents.map((ag) => {
    const tone =
      ag.riskTier === "tier1_critical"
        ? "critical"
        : ag.riskTier === "tier2_standard"
          ? "info"
          : ag.riskTier === "tier3_test"
            ? "neutral"
            : "neutral";

    return {
      value: ag.address,
      label: ag.label || truncateMiddle(ag.address, 10, 6),
      detail: ag.label ? truncateMiddle(ag.address, 8, 6) : (ag.environment || undefined),
      icon: <Bot size={15} />,
      badge: <Badge tone={tone}>{formatRiskTier(ag.riskTier)}</Badge>,
    };
  });

  return (
    <Select
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      icon={<Bot size={15} />}
      className={clsx("agent-custom-select", className)}
      disabled={disabled}
    />
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
  maxWidth,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  maxWidth?: string | number;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      node.showModal();
      requestAnimationFrame(() => {
        node.querySelector<HTMLElement>("button, input, select, textarea, [tabindex='0']")?.focus();
      });
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const handleClose = () => {
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
      onClose();
    };
    node.addEventListener("close", handleClose);
    return () => node.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={clsx("m3-dialog", className)}
      style={maxWidth ? { maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth, width: "100%" } : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId} className="m3-dialog-description">{description}</p>}
          </div>
          <button
            type="button"
            className="m3-dialog-close-btn"
            onClick={() => ref.current?.close()}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="m3-dialog-body">{children}</div>
      <div className="m3-dialog-footer">{footer}</div>
    </dialog>
  );
}

export type TransactionPhase = "idle" | "awaiting_wallet" | "pending" | "confirmed" | "failed";

export function TransactionStatus({
  phase,
  hash,
  error,
}: {
  phase: TransactionPhase;
  hash?: string;
  error?: string;
}) {
  if (phase === "idle") return null;
  const labels: Record<Exclude<TransactionPhase, "idle">, string> = {
    awaiting_wallet: "Waiting for wallet approval",
    pending: "Submitted · waiting for network confirmation",
    confirmed: "Confirmed on the settlement network",
    failed: "Action could not be confirmed",
  };
  const tone = phase === "confirmed" ? "success" : phase === "failed" ? "critical" : "warning";
  return (
    <div className={`transaction-status transaction-status-${tone}`} role={phase === "failed" ? "alert" : "status"} aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <div>
        <strong>{labels[phase]}</strong>
        {phase === "failed" && error && <p>{error}</p>}
        {hash && <small>Transaction <Mono>{truncateMiddle(hash, 10, 8)}</Mono></small>}
      </div>
    </div>
  );
}

export type EmptyStateTone = "neutral" | "success" | "warning" | "info";

export interface EmptyStateProps {
  title: string;
  detail: string;
  icon?: ReactNode;
  tone?: EmptyStateTone;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

function getEmptyStateMeta(title: string, detail: string): { icon: ReactNode; tone: EmptyStateTone } {
  const combined = `${title} ${detail}`.toLowerCase();

  if (
    combined.includes("clear") ||
    combined.includes("within automated policy") ||
    combined.includes("synced") ||
    combined.includes("healthy") ||
    combined.includes("all clear") ||
    combined.includes("passed") ||
    combined.includes("active")
  ) {
    return { icon: <ShieldCheck size={22} />, tone: "success" };
  }

  if (
    combined.includes("unavailable") ||
    combined.includes("error") ||
    combined.includes("failed") ||
    combined.includes("couldn't load") ||
    combined.includes("offline") ||
    combined.includes("requires")
  ) {
    return { icon: <AlertCircle size={22} />, tone: "warning" };
  }

  if (
    combined.includes("wallet") ||
    combined.includes("treasury") ||
    combined.includes("transfer") ||
    combined.includes("deposit") ||
    combined.includes("fund") ||
    combined.includes("float")
  ) {
    return { icon: <Wallet size={22} />, tone: "info" };
  }

  if (
    combined.includes("agent") ||
    combined.includes("fleet") ||
    combined.includes("bot")
  ) {
    return { icon: <Bot size={22} />, tone: "info" };
  }

  if (
    combined.includes("credential") ||
    combined.includes("secret") ||
    combined.includes("api key") ||
    combined.includes("token")
  ) {
    return { icon: <Key size={22} />, tone: "info" };
  }

  if (
    combined.includes("rule") ||
    combined.includes("policy") ||
    combined.includes("access") ||
    combined.includes("permission")
  ) {
    return { icon: <Shield size={22} />, tone: "neutral" };
  }

  if (
    combined.includes("merchant") ||
    combined.includes("store") ||
    combined.includes("whitelist")
  ) {
    return { icon: <Store size={22} />, tone: "info" };
  }

  if (
    combined.includes("search") ||
    combined.includes("filter") ||
    combined.includes("matching") ||
    combined.includes("found")
  ) {
    return { icon: <Search size={22} />, tone: "neutral" };
  }

  if (
    combined.includes("plan") ||
    combined.includes("billing") ||
    combined.includes("invoice") ||
    combined.includes("subscription") ||
    combined.includes("ledger") ||
    combined.includes("reconciliation")
  ) {
    return { icon: <FileText size={22} />, tone: "neutral" };
  }

  return { icon: <Inbox size={22} />, tone: "neutral" };
}

export function EmptyState({
  title,
  detail,
  icon,
  tone,
  action,
  compact = false,
  className = "",
}: EmptyStateProps) {
  const inferred = getEmptyStateMeta(title, detail);
  const activeTone = tone || inferred.tone;
  const activeIcon = icon !== undefined ? icon : inferred.icon;

  return (
    <div
      className={clsx(
        "empty-state",
        `empty-state-${activeTone}`,
        compact && "empty-state-compact",
        className
      )}
      role="status"
    >
      {activeIcon && (
        <div className={clsx("empty-state-icon-badge", `tone-${activeTone}`)}>
          {activeIcon}
        </div>
      )}
      <div className="empty-state-body">
        <strong className="empty-state-title">{title}</strong>
        <p className="empty-state-detail">{detail}</p>
      </div>
      {action && <div className="empty-state-action">{action}</div>}
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

export function formatRiskTier(tier?: string): string {
  if (!tier) return "Standard";
  switch (tier) {
    case "tier1_critical":
      return "Tier 1 · Critical";
    case "tier2_standard":
      return "Tier 2 · Standard";
    case "tier3_test":
      return "Tier 3 · Sandbox";
    default:
      return tier.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatPlatformRole(role?: string): string {
  if (!role) return "Viewer";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  const id = useId();
  return (
    <span className="tooltip-anchor">
      <span className="tooltip-trigger" tabIndex={0} aria-describedby={id}>
        {children}
      </span>
      <span role="tooltip" id={id} className={clsx("tooltip-bubble", `tooltip-bubble-${side}`)}>
        {label}
      </span>
    </span>
  );
}

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={clsx("tabs", className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={active === item.key}
          className={clsx("tabs-tab", active === item.key && "is-active")}
          onClick={() => onChange(item.key)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface StepperStep {
  key: string;
  label: string;
}

export function Stepper({
  steps,
  activeIndex,
  className,
}: {
  steps: StepperStep[];
  activeIndex: number;
  className?: string;
}) {
  return (
    <ol className={clsx("stepper", className)}>
      {steps.map((step, idx) => {
        const state = idx < activeIndex ? "done" : idx === activeIndex ? "active" : "pending";
        return (
          <li key={step.key} className={clsx("stepper-step", `stepper-step-${state}`)}>
            <span className="stepper-step-marker">
              {state === "done" ? <Check size={12} strokeWidth={2.5} /> : idx + 1}
            </span>
            <span className="stepper-step-label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={clsx("switch-row", className)}>
      {(label || description) && (
        <div className="switch-text">
          {label && <label htmlFor={id}>{label}</label>}
          {description && <small>{description}</small>}
        </div>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={clsx("switch", checked && "is-on")}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

function baseUnitsToDollarText(base: string, decimals: number): string {
  if (!base || !base.trim()) return "";
  try {
    const negative = base.trim().startsWith("-");
    const n = BigInt(negative ? base.trim().slice(1) : base.trim());
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = n / divisor;
    const frac = (n % divisor).toString().padStart(decimals, "0").slice(0, 2);
    return `${negative ? "-" : ""}${whole}.${frac}`;
  } catch {
    return "";
  }
}

/** Dollar-denominated input that stores and emits the underlying base-unit integer string, so callers never hand-convert `1000000 = $1.00`. */
export function CurrencyInput({
  valueBaseUnits,
  onChangeBaseUnits,
  decimals = 6,
  placeholder = "0.00",
  disabled,
  className,
  prefix = "$",
}: {
  valueBaseUnits: string;
  onChangeBaseUnits: (next: string) => void;
  decimals?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  prefix?: string;
}) {
  const [text, setText] = useState(() => baseUnitsToDollarText(valueBaseUnits, decimals));

  useEffect(() => {
    setText(baseUnitsToDollarText(valueBaseUnits, decimals));
  }, [valueBaseUnits, decimals]);

  const handleChange = (raw: string) => {
    setText(raw);
    const n = Number(raw);
    if (!raw.trim() || Number.isNaN(n) || n < 0) {
      onChangeBaseUnits("");
      return;
    }
    onChangeBaseUnits(BigInt(Math.round(n * 10 ** decimals)).toString());
  };

  return (
    <div className={clsx("currency-input", disabled && "is-disabled", className)}>
      <span className="currency-input-prefix">{prefix}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => handleChange(event.target.value)}
      />
    </div>
  );
}

