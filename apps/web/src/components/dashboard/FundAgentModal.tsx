import React, { useState } from 'react';
import { type Address, parseEther } from 'viem';
import { type FleetAgent } from '@agentguard/shared-types';
import { X, Coins, ArrowRight, ShieldCheck, Wallet, AlertCircle } from 'lucide-react';
import { Button } from '../common/Button';
import { formatWeb3ErrorMessage } from '../../utils/errors';

interface FundAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: FleetAgent | null;
  connectedBalanceMon: string;
  onFundAgent: (agentAddress: Address, amountWei: bigint) => Promise<any>;
}

const QUICK_AMOUNTS = ['0.1', '0.5', '1.0', '2.5', '5.0'];

export const FundAgentModal: React.FC<FundAgentModalProps> = ({
  isOpen,
  onClose,
  agent,
  connectedBalanceMon,
  onFundAgent,
}) => {
  const [amount, setAmount] = useState('0.5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !agent) return null;

  const handleFund = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setError('Please enter a valid MON transfer amount greater than 0');
      return;
    }

    const available = parseFloat(connectedBalanceMon || '0');
    if (parsed > available) {
      setError(`Insufficient MON balance. Available: ${connectedBalanceMon} MON`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onFundAgent(agent.address, parseEther(amount));
      onClose();
    } catch (err: any) {
      setError(formatWeb3ErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fund-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-xs font-sans"
    >
      <div className="relative w-full max-w-lg rounded-3xl border border-card-border bg-card p-6 shadow-2xl sm:p-8">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-5 top-5 rounded-full p-2 text-fg-subtle hover:bg-card-muted hover:text-fg transition cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="flex items-center space-x-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
            <Coins className="h-5 w-5" />
          </div>
          <div>
            <h3 id="fund-modal-title" className="text-lg font-bold text-fg">
              Fund Agent Wallet
            </h3>
            <p className="text-xs text-fg-muted">
              Transfer native MON directly on Monad Testnet to fund autonomous transactions
            </p>
          </div>
        </div>

        <form onSubmit={handleFund} className="space-y-4">
          {/* Target Agent Card */}
          <div className="rounded-2xl border border-card-border bg-card-muted/50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-fg-muted">Target Agent</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                {agent.role}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-fg">{agent.name}</span>
              <span className="font-mono text-xs text-fg-muted">
                {agent.address.slice(0, 8)}...{agent.address.slice(-6)}
              </span>
            </div>
          </div>

          {/* Connected Source Wallet */}
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-card border border-card-border text-xs">
            <div className="flex items-center gap-2 text-fg-muted">
              <Wallet className="h-4 w-4 text-fg-subtle" />
              <span>Connected Balance:</span>
            </div>
            <span className="font-mono font-bold text-fg">{connectedBalanceMon} MON</span>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <label htmlFor="fund-amount-input" className="text-xs font-semibold text-fg block">
              Funding Amount (MON)
            </label>
            <div className="relative">
              <input
                id="fund-amount-input"
                type="number"
                step="0.01"
                min="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full rounded-xl border border-card-border bg-card px-3 py-2.5 font-mono text-sm text-fg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-fg-muted font-bold">
                MON
              </span>
            </div>

            {/* Quick Chips */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAmount(amt)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition cursor-pointer ${
                    amount === amt
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-card-muted border border-card-border text-fg-muted hover:text-fg hover:border-primary/50'
                  }`}
                >
                  +{amt} MON
                </button>
              ))}
            </div>
          </div>

          {/* Non-Custodial Transfer Notice */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-fg-muted">
            <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              <strong className="text-fg font-semibold">Direct Onchain Settlement:</strong> Transferred funds remain under the agent's non-custodial address on Monad (Chain ID 10143). Payments departing this wallet are strictly governed by your programmed spending ceilings.
            </p>
          </div>

          {error && (
            <div className="flex items-center space-x-2 rounded-xl border border-danger/30 bg-danger-subtle p-3 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-card-border">
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={loading}
              loadingLabel="Transferring MON..."
              leftIcon={<Coins className="h-4 w-4" />}
            >
              Transfer {amount || '0'} MON
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
