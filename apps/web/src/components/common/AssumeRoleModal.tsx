import React, { useEffect } from 'react';
import { X, Shield, Check, AlertTriangle, ArrowRight, UserCheck } from 'lucide-react';
import { useRbac, OPERATOR_ROLES, type OperatorRole } from '../../context/RbacContext';
import { Button } from './Button';

export const AssumeRoleModal: React.FC = () => {
  const {
    role,
    authenticatedRole,
    isImpersonating,
    canImpersonate,
    assumeRole,
    exitImpersonation,
    isAssumeModalOpen,
    setIsAssumeModalOpen,
  } = useRbac();

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAssumeModalOpen(false);
      }
    };
    if (isAssumeModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAssumeModalOpen, setIsAssumeModalOpen]);

  if (!isAssumeModalOpen) return null;

  const handleSelectRole = (newRole: OperatorRole) => {
    if (newRole === authenticatedRole) {
      exitImpersonation();
    } else {
      assumeRole(newRole);
    }
    setIsAssumeModalOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assume-role-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
    >
      {/* Backdrop click to dismiss */}
      <div
        className="absolute inset-0"
        onClick={() => setIsAssumeModalOpen(false)}
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-2xl rounded-2xl border border-card-border bg-card shadow-2xl overflow-hidden z-10 font-sans">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-card-border p-5 bg-card-muted/40">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <h2 id="assume-role-title" className="text-base font-bold text-fg">
                Assume Role for Testing
              </h2>
              <p className="text-xs text-fg-muted mt-0.5">
                Institutional Role Simulation • Super Admin testing authority
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsAssumeModalOpen(false)}
            className="rounded-lg p-1 text-fg-subtle hover:bg-card-muted hover:text-fg transition cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Security Alert */}
        <div className="p-5 pb-0">
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <div className="leading-relaxed">
              <strong className="font-semibold text-amber-200">Enterprise Guardrail:</strong> Role simulation tests control plane presentation and operational safeguards. Smart contract onchain policy checks and signer requirements remain active on Monad.
            </div>
          </div>
        </div>

        {/* Roles List */}
        <div className="p-5 space-y-2.5 max-h-[58vh] overflow-y-auto">
          {Object.values(OPERATOR_ROLES).map((def) => {
            const isActive = def.id === role;
            const isNative = def.id === authenticatedRole;

            return (
              <div
                key={def.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition ${
                  isActive
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-card-border bg-card hover:border-card-border/80 hover:bg-card-muted/30'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="text-2xl mt-0.5 shrink-0">{def.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-fg">{def.label}</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${def.color}`}>
                        {def.badge}
                      </span>
                      {isNative && (
                        <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded">
                          Your Assigned Role
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-fg-muted mt-1 leading-relaxed">
                      {def.description}
                    </p>

                    {/* Permissions summary */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {def.permissions.canToggleKillSwitch && (
                        <span className="text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20 px-1.5 py-0.5 rounded">
                          Emergency Freeze
                        </span>
                      )}
                      {def.permissions.canEditPolicy && (
                        <span className="text-[10px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-1.5 py-0.5 rounded">
                          Policy Modification
                        </span>
                      )}
                      {def.permissions.canManageBudgetPools && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 px-1.5 py-0.5 rounded">
                          Budget Pools
                        </span>
                      )}
                      {def.permissions.canRegisterAgents && (
                        <span className="text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20 px-1.5 py-0.5 rounded">
                          Agent Onboarding
                        </span>
                      )}
                      {def.permissions.isReadOnly && (
                        <span className="text-[10px] bg-zinc-500/10 text-zinc-300 border border-zinc-500/20 px-1.5 py-0.5 rounded">
                          Read-Only Attestation
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 flex items-center justify-end">
                  {isActive ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary bg-primary-subtle border border-primary/30 px-3 py-1.5 rounded-lg">
                      <Check className="h-3.5 w-3.5" />
                      Active
                    </span>
                  ) : (
                    <Button
                      variant={isNative ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={() => handleSelectRole(def.id)}
                      leftIcon={isNative ? <UserCheck className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    >
                      {isNative ? 'Restore Default' : 'Assume Role'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-card-border p-4 bg-card-muted/30">
          <div>
            {isImpersonating ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  exitImpersonation();
                  setIsAssumeModalOpen(false);
                }}
              >
                Exit Simulation (Return to Super Admin)
              </Button>
            ) : (
              <span className="text-xs text-fg-subtle">
                Operating with your verified credentials
              </span>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsAssumeModalOpen(false)}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
