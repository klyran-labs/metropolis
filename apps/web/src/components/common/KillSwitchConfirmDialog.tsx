import React from 'react';
import { ConfirmDialog } from './ConfirmDialog';

export interface KillSwitchConfirmDialogProps {
  isOpen: boolean;
  agentName: string;
  /** true when the pending action turns the kill switch ON (halts the agent). */
  activating: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Shared copy + tone for the one irreversible-feeling action in AgentGuard:
 * flipping an agent's onchain kill switch. Used from Fleet Overview, the
 * Rogue Agent Simulator, and the Lifecycle Studio so the confirmation never
 * drifts out of sync between entry points.
 */
export const KillSwitchConfirmDialog: React.FC<KillSwitchConfirmDialogProps> = ({
  isOpen,
  agentName,
  activating,
  onConfirm,
  onCancel,
}) => (
  <ConfirmDialog
    isOpen={isOpen}
    tone={activating ? 'danger' : 'default'}
    title={activating ? `Halt ${agentName}?` : `Restore ${agentName}?`}
    description={
      activating
        ? 'This submits an onchain transaction that immediately blocks every future spend evaluation for this agent — an O(1) kill switch with no bypass. It takes effect on confirmation and does not require the agent to be misbehaving right now.'
        : 'This submits an onchain transaction that re-enables spend evaluation for this agent under its existing policy limits. Confirm only if you have verified the agent is safe to resume.'
    }
    confirmLabel={activating ? 'Activate kill switch' : 'Restore agent'}
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);
