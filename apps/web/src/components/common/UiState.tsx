import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Info,
  Layers,
  LucideIcon,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

// ============================================================================
// 1. Loading Skeletons
// ============================================================================

export interface SkeletonProps {
  className?: string;
}

export const SkeletonBox: React.FC<SkeletonProps> = ({ className = 'h-4 w-full' }) => (
  <div
    aria-hidden="true"
    className={`bg-card-muted animate-pulse rounded-xl ${className}`}
  />
);

export const SkeletonCard: React.FC = () => (
  <div
    aria-hidden="true"
    className="bg-card border border-card-border rounded-[28px] p-6 shadow-sm space-y-4"
  >
    <div className="flex items-center justify-between">
      <SkeletonBox className="h-4 w-28" />
      <SkeletonBox className="h-6 w-16 rounded-full" />
    </div>
    <SkeletonBox className="h-8 w-40" />
    <div className="grid grid-cols-2 gap-3 pt-2">
      <SkeletonBox className="h-12 rounded-xl" />
      <SkeletonBox className="h-12 rounded-xl" />
    </div>
  </div>
);

export const SkeletonTableRow: React.FC<{ cols?: number }> = ({ cols = 5 }) => (
  <tr aria-hidden="true" className="animate-pulse">
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} className="py-4 px-4">
        <SkeletonBox className="h-3.5 w-full" />
      </td>
    ))}
  </tr>
);

// ============================================================================
// 2. Honest Zero-State Component (AGENTS.md Mandate #1)
// ============================================================================

export interface HonestEmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export const HonestEmptyState: React.FC<HonestEmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}) => {
  return (
    <div
      className={`bg-card border border-card-border rounded-[28px] p-10 sm:p-14 text-center space-y-4 shadow-sm font-sans ${className}`}
    >
      <div className="w-14 h-14 rounded-2xl bg-card-muted text-fg-muted flex items-center justify-center mx-auto shadow-inner">
        <Icon className="w-7 h-7 text-primary" />
      </div>
      <div className="max-w-md mx-auto">
        <h3 className="text-base font-bold text-fg">{title}</h3>
        <p className="text-xs text-fg-muted mt-1.5 leading-relaxed">{description}</p>
      </div>
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="px-5 py-2.5 rounded-full bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-md shadow-primary/20 transition cursor-pointer"
            >
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="px-5 py-2.5 rounded-full bg-card-muted hover:bg-card border border-card-border text-fg text-xs font-semibold transition cursor-pointer"
            >
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 3. Status Badges & Tokens
// ============================================================================

export type LifecycleStatus =
  | 'DRAFT'
  | 'AWAITING_SIGNATURE'
  | 'SUBMITTED'
  | 'MATCHED'
  | 'SETTLEMENT_PENDING'
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'EXPIRING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'ONLINE'
  | 'OFFLINE'
  | 'DRAINING'
  | 'MAINTENANCE';

export interface StatusBadgeProps {
  status: LifecycleStatus | string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  const norm = status.toUpperCase().replace(/\s+/g, '_');

  let bg = 'bg-card-muted text-fg-muted border-card-border';
  let dot = 'bg-fg-subtle';

  switch (norm) {
    case 'ACTIVE':
    case 'HEALTHY':
    case 'ONLINE':
    case 'COMPLETED':
      bg = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
      dot = 'bg-emerald-500';
      break;
    case 'SUBMITTED':
    case 'MATCHED':
    case 'AUTHORIZED':
    case 'FUNDS_LOCKED':
    case 'PROVISIONING':
    case 'AWAITING_SIGNATURE':
      bg = 'bg-primary/10 text-primary border-primary/30';
      dot = 'bg-primary animate-pulse';
      break;
    case 'SETTLEMENT_PENDING':
    case 'EXPIRING':
    case 'DEGRADED':
    case 'DRAINING':
      bg = 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30';
      dot = 'bg-amber-500 animate-pulse';
      break;
    case 'FAILED':
    case 'CANCELLED':
    case 'OFFLINE':
      bg = 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30';
      dot = 'bg-rose-500';
      break;
    case 'UNAVAILABLE':
    case 'MAINTENANCE':
    case 'DRAFT':
      bg = 'bg-card-muted text-fg-muted border-card-border';
      dot = 'bg-fg-subtle';
      break;
  }

  const pxClass = size === 'sm' ? 'px-2.5 py-0.5 text-[10px]' : 'px-3 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center space-x-1.5 rounded-full font-bold uppercase tracking-wider border font-mono ${pxClass} ${bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span>{labelForStatus(status)}</span>
    </span>
  );
};

function labelForStatus(status: string): string {
  const labels: Record<string, string> = {
    AUTHORIZED: 'Authorization complete',
    FUNDS_LOCKED: 'Funds reserved',
    AWAITING_SIGNATURE: 'Authorization required',
    SETTLEMENT_PENDING: 'Payment confirmation pending',
    PROVISIONING: 'Access being prepared',
    EXPIRING: 'Expiring soon',
    DRAINING: 'Winding down',
    UNAVAILABLE: 'Unavailable',
    MAINTENANCE: 'Maintenance',
  };
  return labels[status.toUpperCase()] || status.replace(/_/g, ' ');
}

// ============================================================================
// 4. Truthful Notice Callouts
// ============================================================================

export interface TruthfulNoticeProps {
  variant?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const TruthfulNotice: React.FC<TruthfulNoticeProps> = ({
  variant = 'info',
  title,
  message,
  actionLabel,
  onAction,
  className = '',
}) => {
  const styles = {
    info: {
      bg: 'bg-primary/10 border-primary/25 text-primary',
      icon: Info,
      iconColor: 'text-primary',
    },
    warning: {
      bg: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
      icon: AlertCircle,
      iconColor: 'text-amber-500',
    },
    danger: {
      bg: 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400',
      icon: ShieldAlert,
      iconColor: 'text-rose-500',
    },
    success: {
      bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
      icon: CheckCircle2,
      iconColor: 'text-emerald-500',
    },
  }[variant];

  const IconComp = styles.icon;

  return (
    <div
      className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-sans ${styles.bg} ${className}`}
    >
      <div className="flex items-start space-x-3">
        <IconComp className={`w-4 h-4 shrink-0 mt-0.5 ${styles.iconColor}`} />
        <div>
          {title && <span className="font-bold block tracking-wide mb-0.5">{title}</span>}
          <span className="text-fg-muted leading-relaxed block">{message}</span>
        </div>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 px-3.5 py-1.5 rounded-full bg-card hover:bg-card-muted border border-card-border text-fg font-semibold text-xs transition shadow-sm cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
