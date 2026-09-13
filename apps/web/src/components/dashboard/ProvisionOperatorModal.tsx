import React, { useState, useEffect } from 'react';
import { isAddress, type Address } from 'viem';
import { X, UserPlus, Shield, AlertCircle } from 'lucide-react';
import { useRbac, OPERATOR_ROLES, type OperatorRole } from '../../context/RbacContext';
import { Button } from '../common/Button';

interface ProvisionOperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProvisionOperatorModal: React.FC<ProvisionOperatorModalProps> = ({ isOpen, onClose }) => {
  const { provisionOperator, operators } = useRbac();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [privyDid, setPrivyDid] = useState('');
  const [address, setAddress] = useState('');
  const [role, setRole] = useState<OperatorRole>('sec_ops');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please provide an operator name or institutional identifier.');
      return;
    }

    if (!isAddress(address.trim())) {
      setError('Please provide a valid Monad EVM address (0x...).');
      return;
    }

    const cleanAddress = address.trim() as Address;
    const exists = operators.some((o) => o.address.toLowerCase() === cleanAddress.toLowerCase());
    if (exists) {
      setError('This wallet address is already provisioned in the directory.');
      return;
    }

    try {
      provisionOperator({
        name: name.trim(),
        email: email.trim() || undefined,
        privyDid: privyDid.trim() || undefined,
        address: cleanAddress,
        role,
      });
      setName('');
      setEmail('');
      setPrivyDid('');
      setAddress('');
      setRole('sec_ops');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to provision operator.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="provision-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative w-full max-w-xl rounded-2xl border border-card-border bg-card shadow-2xl overflow-hidden z-10 font-sans">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-card-border p-5 bg-card-muted/40">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 id="provision-modal-title" className="text-base font-bold text-fg">
                Provision Team Operator
              </h2>
              <p className="text-xs text-fg-muted mt-0.5">
                Assign an institutional RBAC persona to an operator wallet
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-fg-subtle hover:bg-card-muted hover:text-fg transition cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-5 pb-0">
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-fg mb-1.5">
              Operator Identifier / Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Elena Vance - Treasury Analyst"
              required
              className="w-full rounded-xl bg-card-muted border border-card-border px-3 py-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-primary transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-fg mb-1.5">
              Email Address (Optional)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. elena@institution.corp"
              className="w-full rounded-xl bg-card-muted border border-card-border px-3 py-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-primary transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-fg mb-1.5">
              Privy User DID (Optional)
            </label>
            <input
              type="text"
              value={privyDid}
              onChange={(e) => setPrivyDid(e.target.value)}
              placeholder="e.g. did:privy:cm123abc456..."
              className="w-full font-mono rounded-xl bg-card-muted border border-card-border px-3 py-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-primary transition"
            />
            <p className="mt-1 text-[10px] text-fg-subtle">
              Links the operator's Privy decentralized identifier for server-side custom metadata synchronization.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-fg mb-1.5">
              Monad Wallet Address *
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x..."
              required
              className="w-full font-mono rounded-xl bg-card-muted border border-card-border px-3 py-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-primary transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-fg mb-2">
              Assigned Role & Permissions *
            </label>
            <div className="space-y-2">
              {Object.values(OPERATOR_ROLES).map((r) => {
                const isSelected = r.id === role;
                return (
                  <div
                    key={r.id}
                    onClick={() => setRole(r.id)}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-card-border bg-card-muted/30 hover:bg-card-muted/60'
                    }`}
                  >
                    <span className="text-xl mt-0.5">{r.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-fg">{r.label}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${r.color}`}>
                          {r.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-fg-muted mt-0.5 leading-relaxed font-normal">
                        {r.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-card-border">
            <Button variant="secondary" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit">
              Authorize & Provision
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
