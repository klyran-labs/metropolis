import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  muted?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING_CLASSES: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

/**
 * The `rounded-2xl border border-card-border bg-card shadow-xs` panel pattern
 * repeated across every dashboard surface, extracted so the panel look is a
 * single edit rather than a find-and-replace across a dozen files.
 */
export const Card: React.FC<CardProps> = ({
  muted = false,
  padding = 'md',
  className = '',
  children,
  ...rest
}) => (
  <div
    className={`relative rounded-2xl border border-card-border shadow-xs backdrop-blur-xl ${
      muted ? 'bg-card-muted' : 'bg-card'
    } ${PADDING_CLASSES[padding]} before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/15 before:to-transparent print:break-inside-avoid print:shadow-none print:backdrop-blur-none print:border-slate-300 print:bg-white print:before:hidden ${className}`}
    {...rest}
  >
    {children}
  </div>
);

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...rest
}) => (
  <div className={`border-b border-card-border pb-4 ${className}`} {...rest}>
    {children}
  </div>
);
