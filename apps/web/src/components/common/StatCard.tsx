import React from 'react';
import { type LucideIcon } from 'lucide-react';
import { Card } from './Card';

export type StatTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  suffix?: React.ReactNode;
  footnote?: React.ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
}

const ICON_TONE_CLASSES: Record<StatTone, string> = {
  info: 'bg-primary-subtle text-primary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  neutral: 'bg-card-muted text-fg-muted',
};

const FOOTNOTE_TONE_CLASSES: Record<StatTone, string> = {
  info: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-fg-muted',
};

/**
 * The four KPI tiles at the top of Fleet Overview (and similar summary rows)
 * were hand-duplicated blocks differing only in label/value/icon/tone. One
 * component now owns that layout.
 */
export const StatCard: React.FC<StatCardProps> = ({ label, value, suffix, footnote, icon: Icon, tone = 'neutral' }) => (
  <Card padding="md">
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${ICON_TONE_CLASSES[tone]}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
    <p className="mt-3 text-2xl font-bold text-fg">
      {value}
      {suffix && <span className="ml-1 text-sm font-normal text-fg-muted">{suffix}</span>}
    </p>
    {footnote && (
      <div className={`mt-2 flex items-center text-xs ${FOOTNOTE_TONE_CLASSES[tone]}`}>
        <span className="font-semibold">{footnote}</span>
      </div>
    )}
  </Card>
);
