import React, { useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Button, type ButtonVariant } from './Button';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 'danger' renders the confirm action in the danger palette with a warning icon. */
  tone?: 'danger' | 'default';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Blocking confirmation for high-impact, hard-to-undo actions — chiefly the
 * onchain kill switch. AgentGuard is a financial risk-control surface: a
 * single accidental click that halts or restores an agent's spend authority
 * should never fire without an explicit second step.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  useFocusTrap(dialogRef, { isActive: isOpen, onEscape: onCancel });

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  const confirmVariant: ButtonVariant = tone === 'danger' ? 'danger' : 'primary';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-xs animate-fade-in-up font-sans"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone === 'danger' ? 'bg-danger-subtle text-danger' : 'bg-primary-subtle text-primary'}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Dismiss"
            className="rounded-full p-1.5 text-fg-muted hover:bg-card-muted hover:text-fg cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 id="confirm-dialog-title" className="mt-4 text-sm font-bold text-fg">
          {title}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{description}</p>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            size="sm"
            onClick={handleConfirm}
            loading={submitting}
            loadingLabel="Submitting…"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
