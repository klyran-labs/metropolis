import React, { useState } from 'react';
import { type Address, formatEther } from 'viem';
import { ExternalLink, LockKeyhole, ShieldAlert, ShieldCheck, Zap } from 'lucide-react';
import type { FleetAgent, SpendPolicy } from '@agentguard/shared-types';
import { MONAD_EXPLORER_URL, CONTRACT_ADDRESSES } from '../../config/contracts';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { KillSwitchConfirmDialog } from '../common/KillSwitchConfirmDialog';

interface LifecycleStudioProps {
  agent: FleetAgent;
  onSavePolicy: (agentAddress: Address, policy: SpendPolicy) => Promise<void>;
  onToggleKillSwitch: (agentAddress: Address, currentActive: boolean) => Promise<void>;
  onRecordAudit?: (record: unknown) => void;
}

/** Operational lifecycle summary. Evidence is rendered only from live chain state. */
export const LifecycleStudio: React.FC<LifecycleStudioProps> = ({ agent, onToggleKillSwitch }) => {
  const [killSwitchConfirmOpen, setKillSwitchConfirmOpen] = useState(false);

  const handleConfirmKillSwitch = async () => {
    try {
      await onToggleKillSwitch(agent.address, agent.policy.killSwitch);
    } finally {
      setKillSwitchConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card padding="md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Agent lifecycle</p>
            <h2 className="mt-1 text-base font-bold text-fg">{agent.name}</h2>
            <p className="mt-1 break-all font-mono text-xs text-fg-muted">{agent.address}</p>
          </div>
          <Button
            variant="outline-danger"
            size="sm"
            leftIcon={<ShieldAlert className="h-4 w-4" />}
            onClick={() => setKillSwitchConfirmOpen(true)}
          >
            {agent.policy.killSwitch ? 'Release kill switch' : 'Activate kill switch'}
          </Button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-card-border p-4">
            <ShieldCheck className="h-5 w-5 text-success" />
            <p className="mt-3 text-xs font-bold text-fg-muted">Policy status</p>
            <p className="mt-1 text-sm font-semibold text-fg">{agent.policy.killSwitch ? 'Blocked by kill switch' : 'Active onchain'}</p>
          </div>
          <div className="rounded-xl border border-card-border p-4">
            <Zap className="h-5 w-5 text-warning" />
            <p className="mt-3 text-xs font-bold text-fg-muted">Spend state</p>
            <p className="mt-1 text-sm font-semibold text-fg">{formatEther(agent.state.spentInWindow)} MON in window</p>
            <p className="mt-1 text-xs text-fg-muted">{agent.state.txCountInWindow} transactions · nonce {agent.state.nonce.toString()}</p>
          </div>
          <div className="rounded-xl border border-card-border p-4">
            <LockKeyhole className="h-5 w-5 text-primary" />
            <p className="mt-3 text-xs font-bold text-fg-muted">Control plane</p>
            <a href={`${MONAD_EXPLORER_URL}/address/${CONTRACT_ADDRESSES.policyEngine}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary">
              View PolicyEngine <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </Card>
      <Card padding="md" className="border-dashed">
        <p className="font-semibold text-fg">Audit evidence is chain-derived</p>
        <p className="mt-1 text-xs text-fg-muted">Transaction hashes, payment outcomes, and reputation changes appear after indexed contract events are connected. This view intentionally does not generate preview signatures or synthetic settlement records.</p>
      </Card>

      <KillSwitchConfirmDialog
        isOpen={killSwitchConfirmOpen}
        agentName={agent.name}
        activating={!agent.policy.killSwitch}
        onConfirm={handleConfirmKillSwitch}
        onCancel={() => setKillSwitchConfirmOpen(false)}
      />
    </div>
  );
};
