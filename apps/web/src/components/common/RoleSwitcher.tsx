import React from 'react';
import { Shield } from 'lucide-react';
import { useRbac } from '../../context/RbacContext';

interface RoleSwitcherProps {
  compact?: boolean;
}

export const RoleSwitcher: React.FC<RoleSwitcherProps> = ({ compact = false }) => {
  const { roleConfig, canImpersonate, isImpersonating, setIsAssumeModalOpen, roleSource, isJwtLoading } = useRbac();

  const roleSourceLabel =
    roleSource === 'privy_jwt'
      ? 'Verified Privy JWT'
      : roleSource === 'privy_metadata'
      ? 'Privy User Metadata'
      : roleSource === 'operator_directory'
      ? 'Enterprise IAM Directory'
      : roleSource === 'root_authority'
      ? 'Cryptographic Root Deployer'
      : 'Least-Privilege Default';

  return (
    <button
      type="button"
      onClick={() => {
        if (canImpersonate) {
          setIsAssumeModalOpen(true);
        }
      }}
      disabled={!canImpersonate}
      title={
        isImpersonating
          ? `Simulating: ${roleConfig.label} (Underlying Auth: ${roleSourceLabel}) • Click to change or exit`
          : canImpersonate
          ? `Verified Authority: ${roleConfig.label} • Source: ${roleSourceLabel} • Click to simulate roles`
          : `Verified Authority: ${roleConfig.label} • Source: ${roleSourceLabel}`
      }
      className={`inline-flex items-center gap-1.5 rounded-lg border font-sans text-xs font-semibold transition shadow-2xs ${
        isImpersonating
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          : canImpersonate
          ? 'border-card-border bg-card hover:border-primary/50 text-fg cursor-pointer'
          : 'border-card-border/60 bg-card/60 text-fg-muted cursor-default'
      } ${compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5'}`}
    >
      <span className="text-xs">{roleConfig.icon}</span>
      <span className="truncate max-w-[130px]">{roleConfig.badge}</span>
      {isJwtLoading ? (
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
      ) : roleSource === 'privy_jwt' ? (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" title="Cryptographically Verified JWT" />
      ) : null}
      {canImpersonate && (
        <span className="text-[10px] text-fg-subtle">
          <Shield className="h-3 w-3 inline ml-0.5 text-primary" />
        </span>
      )}
    </button>
  );
};
