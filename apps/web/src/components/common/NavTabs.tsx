import React from 'react';
import { type LucideIcon } from 'lucide-react';

export interface NavTabOption<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

export interface NavTabsProps<T extends string> {
  options: readonly NavTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
}

/**
 * The primary dashboard tab strip (Fleet / Lifecycle / Policy Studio /
 * Simulator / Audit) was five near-identical button elements differing
 * only in icon, label, and active-tab comparison. One generic control now
 * owns the shared layout and active/inactive styling.
 */
export function NavTabs<T extends string>({ options, value, onChange, ...rest }: NavTabsProps<T>) {
  return (
    <div role="tablist" aria-label={rest['aria-label']} className="flex flex-wrap gap-2 border-b border-card-border pb-3">
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
              isActive ? 'bg-primary text-white shadow-xs' : 'bg-card text-fg-muted hover:bg-card-muted'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
