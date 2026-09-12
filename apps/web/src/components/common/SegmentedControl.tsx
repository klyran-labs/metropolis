import React from 'react';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  size?: 'sm' | 'md';
}

/**
 * The ALL/ACTIVE/REVOKED and ALL/ALLOW/DENY pill groups were hand-duplicated,
 * pixel-for-pixel identical, in FleetOverview and AuditLedger. One generic
 * implementation now backs both filter bars.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  ...rest
}: SegmentedControlProps<T>) {
  const padding = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs';
  return (
    <div
      role="radiogroup"
      aria-label={rest['aria-label']}
      className="flex rounded-xl border border-card-border bg-card-muted p-0.5"
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={`rounded-lg font-semibold transition-all cursor-pointer ${padding} ${
              isSelected
                ? 'bg-card text-fg shadow-xs'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
