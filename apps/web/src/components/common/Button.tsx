import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline-danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  type?: 'button' | 'submit' | 'reset';
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white shadow-xs hover:bg-primary-hover disabled:hover:bg-primary',
  secondary:
    'border border-card-border bg-card text-fg hover:bg-card-muted',
  danger:
    'bg-danger text-white shadow-xs hover:bg-danger-hover disabled:hover:bg-danger',
  'outline-danger':
    'border border-danger/30 bg-danger-subtle text-danger hover:bg-danger/15',
  ghost:
    'text-fg-muted hover:bg-card-muted hover:text-fg',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-xl',
  md: 'px-4 py-2.5 text-xs gap-2 rounded-xl',
};

/**
 * Single source of truth for interactive button styling. Every AgentGuard
 * surface should compose this instead of hand-rolling variant className
 * strings, so a brand/status color change is a one-file edit.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      type = 'button',
      variant = 'primary',
      size = 'md',
      loading = false,
      loadingLabel,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className = '',
      children,
      ...rest
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center font-semibold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
          fullWidth ? 'w-full' : ''
        } ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...rest}
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{loadingLabel ?? 'Working…'}</span>
          </>
        ) : (
          <>
            {leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
