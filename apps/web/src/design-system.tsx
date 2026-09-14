import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

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
