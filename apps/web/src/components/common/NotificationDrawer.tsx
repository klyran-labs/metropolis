import React, { useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  X,
  Bell,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { MONAD_EXPLORER_URL } from '../../config/contracts';

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
          className="w-screen max-w-md bg-card border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between animate-fade-in-up"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-primary">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <h3 id="drawer-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Activity & Notifications
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Real-time settlement and service activity
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* System Status Banner */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  AgentGuard Connected
                </span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                Monad 10143
              </span>
            </div>

            {/* Activity Stream */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Recent Onchain Policy Events
              </h4>

              <div className="p-3.5 rounded-2xl bg-card border border-card-border shadow-xs space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="font-bold text-slate-900 dark:text-slate-100">Policy Initialized</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Monad (10143)</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  PolicyEngine & ReputationRegistry operational with disjoint storage partitioning.
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between text-xs text-slate-500">
            <span className="text-[11px]">AgentGuard Policy Engine Active</span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-card border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
