import React, { useState, useEffect, useRef } from 'react';
import { usePrivy, useLogin, useLoginWithEmail, useWallets } from '@privy-io/react-auth';
import {
  Mail,
  ArrowRight,
  Loader2,
  Wallet,
  KeyRound,
  AlertCircle,
  RefreshCw,
  X,
  ShieldCheck,
  ShieldAlert,
  Bot,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

export type UserIntent = 'risk_controller' | 'agent_developer';

export const InlinePrivyAuth: React.FC = () => {
  const { user: privyUser, authenticated: isPrivyAuthenticated } = usePrivy();
  const { wallets } = useWallets();
  const { login: loginWithPrivy } = useLogin({
    onComplete: () => {
      setError(null);
    },
    onError: (err) => {
      setError(typeof err === 'string' ? err : (err as any)?.message || 'Wallet authentication failed.');
    },
  });

  const modalRef = useRef<HTMLDivElement>(null);

  const [selectedIntent, setSelectedIntent] = useState<UserIntent>('risk_controller');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);

  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [showWalletOption, setShowWalletOption] = useState(false);

  useFocusTrap(modalRef, {
    isActive: showTermsModal,
    onEscape: () => setShowTermsModal(false),
  });

  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail({
    onComplete: () => {
      setError(null);
    },
    onError: (err) => {
      setError(typeof err === 'string' ? err : (err as any)?.message || 'Email verification failed.');
    },
  });

  const isSendingCode = emailState.status === 'sending-code';
  const isSubmittingCode = emailState.status === 'submitting-code';

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedToTerms) {
      setError('Please review and accept the Risk Governance & Security Policy to proceed.');
      return;
    }
    if (!email || !email.includes('@')) {
      setError('Please enter a valid business or developer email address.');
      return;
    }
    setError(null);

    try {
      await sendCode({ email: email.trim() });
      setStep('code');
    } catch (err: any) {
      setError(err?.message || 'Failed to send verification code.');
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setError(null);

    try {
      await loginWithCode({ code: code.trim() });
    } catch (err: any) {
      setError(err?.message || 'Invalid or expired code. Please try again.');
    }
  };

  const handleWalletConnect = async () => {
    if (!agreedToTerms) {
      setError('Please review and accept the Risk Governance & Security Policy to proceed.');
      return;
    }
    setError(null);
    setIsConnectingWallet(true);

    try {
      await loginWithPrivy();
    } catch (err: any) {
      setError(err?.message || 'Failed to connect Web3 wallet. You can sign in with Email.');
    } finally {
      setIsConnectingWallet(false);
    }
  };

  return (
    <div className="w-full bg-card border border-card-border rounded-[28px] shadow-xl p-6 sm:p-8 relative font-sans text-slate-900 dark:text-slate-100 text-left">
      {/* Step 1: User Objective Selection */}
      <div className="mb-6">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
          Select control console profile
        </label>
        <div role="radiogroup" aria-label="Workspace profile" className="grid grid-cols-1 gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={selectedIntent === 'risk_controller'}
            onClick={() => setSelectedIntent('risk_controller')}
            className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between ${
              selectedIntent === 'risk_controller'
                ? 'bg-blue-50/70 dark:bg-blue-950/40 border-primary text-primary shadow-xs'
                : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  selectedIntent === 'risk_controller'
                    ? 'bg-primary text-white'
                    : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-bold block">Risk Controller Profile</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  Author spend policies, manage agent velocity ceilings, and toggle onchain kill switches
                </span>
              </div>
            </div>
            {selectedIntent === 'risk_controller' && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={selectedIntent === 'agent_developer'}
            onClick={() => setSelectedIntent('agent_developer')}
            className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between ${
              selectedIntent === 'agent_developer'
                ? 'bg-purple-50/70 dark:bg-purple-950/40 border-purple-600 dark:border-purple-500 text-purple-700 dark:text-purple-300 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  selectedIntent === 'agent_developer'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-bold block">Agent Developer Profile</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  Integrate x402 HTTP 402 middleware, test rogue agent simulations, and inspect EIP-712 proofs
                </span>
              </div>
            </div>
            {selectedIntent === 'agent_developer' && (
              <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
            )}
          </button>
        </div>
      </div>

      {/* Step 2: Authentication */}
      <div className="border-t border-slate-100 dark:border-slate-700 pt-5">
        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Work Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 focus:bg-white dark:focus:bg-slate-800 focus:border-primary text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all font-sans"
                />
              </div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 block">
                We will email an authentic 6-digit one-time passcode.
              </span>
            </div>

            {/* Terms & SLA Disclosure Agreement */}
            <div className="flex items-start space-x-2.5 pt-1">
              <input
                type="checkbox"
                id="terms"
                checked={agreedToTerms}
                aria-describedby="terms-description"
                onChange={(e) => {
                  setAgreedToTerms(e.target.checked);
                  setError(null);
                }}
                className="mt-1 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary cursor-pointer"
              />
              <div id="terms-description" className="text-xs text-slate-600 dark:text-slate-400 leading-snug">
                I agree to the{' '}
                <button
                  type="button"
                  onClick={() => setShowTermsModal(true)}
                  className="text-primary hover:underline font-semibold cursor-pointer"
                >
                  AgentGuard Risk Governance & Security Policy
                </button>{' '}
                and Monad onchain policy parameters.
              </div>
            </div>

            <button
              type="submit"
              disabled={isSendingCode}
              className="w-full py-3 px-4 rounded-full text-xs font-bold text-white bg-primary hover:bg-primary-hover transition-all shadow-md shadow-primary/20 disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2"
            >
              {isSendingCode ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Dispatching Passcode...</span>
                </>
              ) : (
                <>
                  <span>Continue to Console</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="p-3.5 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/60 rounded-2xl text-xs text-blue-900 dark:text-blue-200">
              Enter the 6-digit passcode sent to <strong className="font-semibold">{email}</strong>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Passcode
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  maxLength={6}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ''));
                    setError(null);
                  }}
                  placeholder="000000"
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 focus:bg-white dark:focus:bg-slate-800 focus:border-primary text-center tracking-widest text-lg font-mono font-bold text-slate-900 dark:text-slate-100 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmittingCode || code.length < 6}
              className="w-full py-3 px-4 rounded-full text-xs font-bold text-white bg-primary hover:bg-primary-hover transition-all shadow-md shadow-primary/20 disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2"
            >
              {isSubmittingCode ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Passcode...</span>
                </>
              ) : (
                <span>Verify & Enter Console</span>
              )}
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                Change email
              </button>
              <button
                type="button"
                onClick={handleSendCode}
                disabled={isSendingCode}
                className="text-primary hover:underline flex items-center space-x-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isSendingCode ? 'animate-spin' : ''}`} />
                <span>Resend code</span>
              </button>
            </div>
          </form>
        )}

        {/* Error Notification */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-2xl flex items-start space-x-2.5 text-xs text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Alternative Authentication: Web3 Wallet */}
        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-700/60">
          {!showWalletOption ? (
            <button
              type="button"
              onClick={() => setShowWalletOption(true)}
              className="w-full py-2 px-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Connect with Web3 Wallet instead</span>
            </button>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleWalletConnect}
                disabled={isConnectingWallet}
                className="w-full py-2.5 px-4 rounded-full border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                {isConnectingWallet ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wallet className="w-4 h-4 text-primary" />
                )}
                <span>Connect MetaMask / Phantom / WalletConnect</span>
              </button>
              <button
                type="button"
                onClick={() => setShowWalletOption(false)}
                className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
              >
                Back to email login
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Trust & Institutional Security Badges */}
      <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-700/80">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2">
          Enterprise Security Assurances
        </span>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400">
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>Monad Parallel EVM (400ms)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>O(1) Instant Kill Switch</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>x402 / AP2 Agent Protocol</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>Disjoint State Isolation</span>
          </div>
        </div>
      </div>

      {/* Modal: Terms & Disclosures */}
      {showTermsModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in-up"
        >
          <div
            ref={modalRef}
            className="bg-card border border-slate-200 dark:border-slate-800 rounded-[28px] max-w-lg w-full p-7 space-y-4 shadow-2xl relative text-left"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <h3 id="terms-modal-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  AgentGuard Risk Governance & Security Policy
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                aria-label="Close dialog"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300 max-h-72 overflow-y-auto pr-2 leading-relaxed">
              <p className="font-semibold text-slate-900 dark:text-slate-100">1. Non-Custodial Monad Parallel EVM Guard</p>
              <p className="text-slate-500 dark:text-slate-400">
                Agent funds remain in user-controlled smart contracts. Every transaction requires valid EIP-712 agent signatures evaluated against deterministic onchain risk policies.
              </p>
              <p className="font-semibold text-slate-900 dark:text-slate-100">2. Programmable Agent Velocity & Rate Controls</p>
              <p className="text-slate-500 dark:text-slate-400">
                Spend is capped per transaction, per rolling time window, and by transaction count. Exceeding velocity thresholds results in deterministic transaction denial with machine-readable reason codes.
              </p>
              <p className="font-semibold text-slate-900 dark:text-slate-100">3. Instant O(1) Onchain Kill Switch</p>
              <p className="text-slate-500 dark:text-slate-400">
                Administrators can freeze compromised or misbehaving agents immediately with an O(1) single-SSTORE kill switch that aborts all subsequent payments before executing any math.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setAgreedToTerms(true);
                  setShowTermsModal(false);
                }}
                className="py-2.5 px-6 rounded-full bg-primary hover:bg-primary-hover text-white font-semibold text-xs shadow-md shadow-primary/20 cursor-pointer"
              >
                Accept & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
