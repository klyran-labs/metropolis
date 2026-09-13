import React, { useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { X, Bell, AlertTriangle, ShieldAlert, CheckCircle2, Shield } from 'lucide-react';
import { ActivityFeed } from './ActivityFeed';
import { Button } from './Button';
import { useDashboard } from '../../context/DashboardContext';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({ isOpen, onClose }) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRef, { isActive: isOpen, onEscape: onClose });
  const { agents, budgetPools, simulatedRecords } = useDashboard();
  const [activeTab, setActiveTab] = useState<'alerts' | 'activity'>('alerts');

  // Compute live proactive risk alerts from real agent and pool state
  const killSwitchAgents = agents.filter((a) => a.policy.killSwitch);
  const nearLimitAgents = agents.filter((a) => {
    if (a.policy.maxPerWindow <= 0n) return false;
    const ratio = Number(a.state.spentInWindow) / Number(a.policy.maxPerWindow);
    return ratio >= 0.8;
  });
  const nearLimitPools = budgetPools.filter((p) => {
    if (p.totalBudget <= 0n) return false;
    const ratio = Number(p.spentBudget) / Number(p.totalBudget);
    return ratio >= 0.8;
  });

  const totalAlertCount = killSwitchAgents.length + nearLimitAgents.length + nearLimitPools.length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden font-sans">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300 cursor-pointer"
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
              <div className="w-8 h-8 rounded-xl bg-primary-subtle flex items-center justify-center text-primary relative">
                <Bell className="w-4 h-4" />
                {totalAlertCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
                    {totalAlertCount}
                  </span>
                )}
              </div>
              <div>
                <h3 id="drawer-title" className="text-base font-bold text-fg">
                  Risk Alerts & Activity
                </h3>
                <p className="text-[11px] text-fg-muted">
                  Live risk evaluation stream on Monad Testnet (10143)
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

          {/* Tab Selector */}
          <div className="flex border-b border-card-border px-6 pt-3">
            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              className={`pb-2.5 px-2 text-xs font-semibold border-b-2 transition ${
                activeTab === 'alerts'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              Risk Alerts ({totalAlertCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('activity')}
              className={`pb-2.5 px-2 text-xs font-semibold border-b-2 transition ${
                activeTab === 'activity'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              Onchain Events
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {activeTab === 'alerts' ? (
              <div className="space-y-3">
                {totalAlertCount === 0 ? (
                  <div className="rounded-xl border border-dashed border-card-border p-8 text-center text-xs text-fg-muted">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
                    <p className="mt-2 font-bold text-fg">Fleet Invariants Healthy</p>
                    <p className="mt-1">Zero active kill switches or budget breaches detected.</p>
                  </div>
                ) : (
                  <>
                    {/* Kill Switch Alerts */}
                    {killSwitchAgents.map((agent) => (
                      <div
                        key={agent.address}
                        className="rounded-xl border border-danger/30 bg-danger-subtle p-3 text-xs"
                      >
                        <div className="flex items-center gap-2 text-danger font-bold">
                          <ShieldAlert className="h-4 w-4 shrink-0" />
                          <span>CRITICAL: Emergency Halt Enforced</span>
                        </div>
                        <p className="mt-1 text-fg-muted">
                          Agent <span className="font-mono font-semibold text-fg">{agent.name}</span> ({agent.address.slice(0, 6)}…{agent.address.slice(-4)}) is revoked. All payment intents are short-circuit rejected.
                        </p>
                      </div>
                    ))}

                    {/* Near Window Limit Alerts */}
                    {nearLimitAgents.map((agent) => (
                      <div
                        key={`warn-${agent.address}`}
                        className="rounded-xl border border-warning/30 bg-warning-subtle p-3 text-xs"
                      >
                        <div className="flex items-center gap-2 text-warning font-bold">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>WARNING: Near Spend Window Cap</span>
                        </div>
                        <p className="mt-1 text-fg-muted">
                          Agent <span className="font-semibold text-fg">{agent.name}</span> has utilized &gt;80% of window allowance.
                        </p>
                      </div>
                    ))}

                    {/* Near Pool Cap Alerts */}
                    {nearLimitPools.map((pool) => (
                      <div
                        key={`pool-${pool.poolId}`}
                        className="rounded-xl border border-warning/30 bg-warning-subtle p-3 text-xs"
                      >
                        <div className="flex items-center gap-2 text-warning font-bold">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>WARNING: Budget Pool High Utilization</span>
                        </div>
                        <p className="mt-1 text-fg-muted">
                          Shared pool <span className="font-semibold text-fg">{pool.name}</span> has consumed &gt;80% of total allocation.
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                  Recent PolicyEngine Logs
                </h4>
                <ActivityFeed limit={25} emptyMessage="No policy events recorded onchain yet." />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-card-border bg-card-muted flex items-center justify-between text-xs text-fg-muted">
            <span className="text-[11px]">Real-Time Settlement • Sub-Second Finality</span>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
