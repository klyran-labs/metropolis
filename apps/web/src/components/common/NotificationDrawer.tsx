import React, { useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { X, Bell } from 'lucide-react';
import { ActivityFeed } from './ActivityFeed';
import { Button } from './Button';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({ isOpen, onClose }) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRef, { isActive: isOpen, onEscape: onClose });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden font-sans">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/70 backdrop-blur-xs transition-opacity duration-300 cursor-pointer"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
          className="w-screen max-w-md bg-card border-l border-card-border shadow-2xl flex flex-col justify-between animate-fade-in-up"
        >
          {/* Header */}
          <div className="p-6 border-b border-card-border flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary-subtle flex items-center justify-center text-primary">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <h3 id="drawer-title" className="text-base font-bold text-fg">
                  Activity & Notifications
                </h3>
                <p className="text-[11px] text-fg-muted">
                  Real events decoded from PolicyEngine on Monad
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="p-2 rounded-full hover:bg-card-muted text-fg-subtle hover:text-fg transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="p-3.5 rounded-2xl bg-card-muted border border-card-border flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="font-semibold text-fg">AgentGuard Connected</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-card border border-card-border text-fg-muted">
                Monad 10143
              </span>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                Recent Onchain Policy Events
              </h4>
              <ActivityFeed limit={20} emptyMessage="No policy events recorded onchain yet — this fills in as agents get registered, spend evaluated, or kill switches flipped." />
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-card-border bg-card-muted flex items-center justify-between text-xs text-fg-muted">
            <span className="text-[11px]">AgentGuard Policy Engine Active</span>
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
};
