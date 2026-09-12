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
  Cpu,
  Server,
  Zap,
  CheckCircle2,
  Building2,
} from 'lucide-react';
import { UserRole } from '../context/MarketplaceContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useFocusTrap } from '../hooks/useFocusTrap';

export type UserIntent = 'buy_gpus' | 'provide_hardware';

export const InlinePrivyAuth: React.FC = () => {
  const { setRole } = useWorkspace();
  const login = (role: UserRole, _email?: string) => setRole(role === 'seller' ? 'seller' : 'buyer');

  const { user: privyUser, authenticated: isPrivyAuthenticated } = usePrivy();
  const { wallets } = useWallets();
  const { login: loginWithPrivy } = useLogin({
    onComplete: ({ user }) => {
      const walletAddress = user?.wallet?.address || wallets?.[0]?.address;
      login(selectedRole, user?.email?.address || walletAddress || undefined);
    },
    onError: (err) => {
      setError(typeof err === 'string' ? err : (err as any)?.message || 'Wallet authentication failed.');
    },
  });

  // Modal ref for focus trap
  const modalRef = useRef<HTMLDivElement>(null);

  // 1. User Intent state
  const [selectedIntent, setSelectedIntent] = useState<UserIntent>('buy_gpus');
  const [selectedRole, setSelectedRole] = useState<UserRole>('buyer');

  useEffect(() => {
    if (selectedIntent === 'provide_hardware') {
      setSelectedRole('seller');
    } else {
      setSelectedRole('buyer');
    }
  }, [selectedIntent]);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);

  // Unselected by default for enterprise compliance
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [showWalletOption, setShowWalletOption] = useState(false);

  useFocusTrap(modalRef, {
    isActive: showTermsModal,
    onEscape: () => setShowTermsModal(false),
  });

  // Live Privy Headless Email OTP Authentication
  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail({
    onComplete: ({ user }) => {
      const emailAddress = user?.email?.address || email.trim();
      login(selectedRole, emailAddress);
    },
    onError: (err) => {
      setError(typeof err === 'string' ? err : (err as any)?.message || 'Email verification failed.');
    },
  });

  const isSendingCode = emailState.status === 'sending-code';
  const isSubmittingCode = emailState.status === 'submitting-code';

  useEffect(() => {
    if (isPrivyAuthenticated && privyUser) {
      const emailAddr = privyUser.email?.address;
      const walletAddr = privyUser.wallet?.address || wallets?.[0]?.address;
      login(selectedRole, emailAddr || walletAddr || undefined);
    }
  }, [isPrivyAuthenticated, privyUser, wallets, selectedRole, login]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedToTerms) {
      setError('Please review and accept the Service Agreement & SLA terms to proceed.');
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
      setError('Please review and accept the Service Agreement & SLA terms to proceed.');
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
    <div className="w-full bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-[28px] shadow-xl p-6 sm:p-8 relative font-sans text-slate-900 dark:text-slate-100 text-left">
      {/* Step 1: User Objective Selection */}
      <div className="mb-6">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
          Choose your workspace
        </label>
        <div role="radiogroup" aria-label="Workspace type" className="grid grid-cols-1 gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={selectedIntent === 'buy_gpus'}
            onClick={() => setSelectedIntent('buy_gpus')}
            className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between ${
              selectedIntent === 'buy_gpus'
                ? 'bg-blue-50/70 dark:bg-blue-950/40 border-[#254BFF] dark:border-blue-500 text-[#254BFF] dark:text-blue-400 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  selectedIntent === 'buy_gpus'
                    ? 'bg-[#254BFF] text-white'
                    : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-bold block">Customer workspace</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  Compare and procure verified capacity for AI, batch, and production workloads
                </span>
              </div>
            </div>
            {selectedIntent === 'buy_gpus' && <CheckCircle2 className="w-4 h-4 text-[#254BFF] dark:text-blue-400 shrink-0" />}
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={selectedIntent === 'provide_hardware'}
            onClick={() => setSelectedIntent('provide_hardware')}
            className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between ${
              selectedIntent === 'provide_hardware'
                ? 'bg-purple-50/70 dark:bg-purple-950/40 border-purple-600 dark:border-purple-500 text-purple-700 dark:text-purple-300 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  selectedIntent === 'provide_hardware'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Server className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-bold block">Provider workspace</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  Register fleet capacity, manage listings, and track settlements
                </span>
              </div>
            </div>
            {selectedIntent === 'provide_hardware' && (
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
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 focus:bg-white dark:focus:bg-slate-800 focus:border-[#254BFF] text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#254BFF]/10 transition-all font-sans"
                />
              </div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 block">
                We will email an authentic 6-digit one-time passcode.
              </span>
            </div>

            {/* Terms & SLA Disclosure Agreement (Unselected by default) */}
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
                className="mt-1 rounded border-slate-300 dark:border-slate-600 text-[#254BFF] focus:ring-[#254BFF] cursor-pointer"
              />
              <div id="terms-description" className="text-xs text-slate-600 dark:text-slate-400 leading-snug">
                I agree to the{' '}
                <button
                  type="button"
                  onClick={() => setShowTermsModal(true)}
                  className="text-[#254BFF] dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                >
                  Enterprise Master Service Agreement
                </button>{' '}
                and a policy-defined 99.50% SLA target.
              </div>
            </div>

            <button
              type="submit"
              disabled={isSendingCode}
              className="w-full py-3 px-4 rounded-full text-xs font-bold text-white bg-[#254BFF] hover:bg-[#1D40DF] transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2"
            >
              {isSendingCode ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Dispatching Passcode...</span>
                </>
              ) : (
                <>
                  <span>Continue to Workspace</span>
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
                Verification Code
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  maxLength={6}
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ''));
                    setError(null);
                  }}
                  placeholder="123456"
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 focus:bg-white dark:focus:bg-slate-800 focus:border-[#254BFF] text-base text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#254BFF]/10 transition-all font-mono tracking-widest text-center"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmittingCode}
              className="w-full py-3 px-4 rounded-full text-xs font-bold text-white bg-[#254BFF] hover:bg-[#1D40DF] transition shadow-md shadow-blue-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2"
            >
              {isSubmittingCode ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Passcode...</span>
                </>
              ) : (
                <>
                  <span>Authenticate & Enter Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setStep('email')}
                className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium cursor-pointer"
              >
                ← Use a different email
              </button>
            </div>
          </form>
        )}

        {/* Secondary Web3 Wallet Path */}
        <div className="mt-4 text-center">
          {!showWalletOption ? (
            <button
              type="button"
              onClick={() => setShowWalletOption(true)}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-[#254BFF] dark:hover:text-blue-400 font-medium transition cursor-pointer"
            >
              Sign in with a wallet instead
            </button>
          ) : (
            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-200/80 dark:border-slate-700 space-y-2.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                Connect MetaMask, Rabby, or Hardware Wallet
              </span>
              <button
                type="button"
                onClick={handleWalletConnect}
                disabled={isConnectingWallet}
                className="w-full py-2.5 px-4 rounded-full bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-xs font-semibold transition flex items-center justify-center space-x-2 cursor-pointer"
              >
                {isConnectingWallet ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#254BFF]" />
                ) : (
                  <Wallet className="w-4 h-4 text-[#254BFF]" />
                )}
                <span>Connect Wallet</span>
              </button>
            </div>
          )}
        </div>

        {/* Error Message Display with role=alert */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mt-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-center space-x-2 text-rose-800 dark:text-rose-200 text-xs"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Step 3: What happens after sign-in */}
      <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-700">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2">
          Workspace Onboarding Sequence
        </span>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400">
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400 shrink-0" />
            <span>1. Identity Verification</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400 shrink-0" />
            <span>2. Add protected funds</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400 shrink-0" />
            <span>3. Choose compute capacity</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#254BFF] dark:text-blue-400 shrink-0" />
            <span>4. Verified Ingress Access</span>
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
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[28px] max-w-lg w-full p-7 space-y-4 shadow-2xl relative text-left"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-[#254BFF] dark:text-blue-400" />
                <h3 id="terms-modal-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  ComputeX Enterprise SLA & Master Agreement
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
              <p className="font-semibold text-slate-900 dark:text-slate-100">1. Non-Custodial Delivery vs. Payment</p>
              <p className="text-slate-500 dark:text-slate-400">
                Compute capacity commitments settle directly peer-to-peer. Trading balances are held in non-custodial smart contracts and disbursed as verified capacity seconds are delivered.
              </p>
              <p className="font-semibold text-slate-900 dark:text-slate-100">2. 99.50% Hardware SLA Performance</p>
              <p className="text-slate-500 dark:text-slate-400">
                Compute providers stake native collateral. If node health, power, or latency deviates beyond SLA thresholds, automated adjustments credit tenant balances.
              </p>
              <p className="font-semibold text-slate-900 dark:text-slate-100">3. Verified Host Provisioning</p>
              <p className="text-slate-500 dark:text-slate-400">
                Nodes undergo cryptographic sanitization and evidence-backed wipes prior to and following tenant allocations.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setAgreedToTerms(true);
                  setShowTermsModal(false);
                }}
                className="py-2.5 px-6 rounded-full bg-[#254BFF] hover:bg-[#1D40DF] text-white font-semibold text-xs shadow-md shadow-blue-500/20 cursor-pointer"
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
