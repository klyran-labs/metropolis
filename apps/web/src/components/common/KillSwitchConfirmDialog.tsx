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
    title={activating ? `Suspend ${agentName}?` : `Restore ${agentName}?`}
    description={
      activating
        ? 'This will immediately suspend all outgoing payments and transaction authorizations for this agent. Once confirmed, any payment requests initiated by this agent will be blocked until manually restored.'
        : 'This will re-enable payment authorizations for this agent under its configured spend limits. Confirm only if you have verified the agent is safe to resume operations.'
    }
    confirmLabel={activating ? 'Suspend agent' : 'Restore agent'}
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);
