import React, { useState, useRef, useEffect } from 'react';
import { usePrivy, useLogin, useLoginWithEmail } from '@privy-io/react-auth';
import {
  Mail,
  Loader2,
  Wallet,
  AlertCircle,
  ArrowLeft,
  Shield,
  CheckCircle2,
} from 'lucide-react';

export const InlinePrivyAuth: React.FC = () => {
  const { authenticated: isPrivyAuthenticated } = usePrivy();
  const { login: loginWithPrivy } = useLogin({
    onComplete: () => {
      setError(null);
    },
    onError: (err) => {
      setError(typeof err === 'string' ? err : (err as any)?.message || 'Wallet authentication failed.');
    },
  });

  const [email, setEmail] = useState('demo@kt.com');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  useEffect(() => {
    if (step === 'code') {
      const timer = setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(null);

    try {
      await sendCode({ email: email.trim() });
      setStep('code');
    } catch (err: any) {
      setError(err?.message || 'Failed to send verification code. You may also connect directly with a Web3 wallet.');
    }
  };

  const handleVerifyCode = async (codeToVerify?: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const fullCode = (codeToVerify ?? otp.join('')).trim();
    if (fullCode.length < 6) {
      setError('Please enter all 6 digits of the confirmation code.');
      return;
    }
    setError(null);

    try {
      await loginWithCode({ code: fullCode });
    } catch (err: any) {
      setError(err?.message || 'Invalid or expired confirmation code. Please try again.');
    }
  };

  const handleResendCode = async () => {
    setError(null);
    try {
      await sendCode({ email: email.trim() });
    } catch (err: any) {
      setError(err?.message || 'Failed to resend confirmation code.');
    }
  };

  const handleWalletConnect = async () => {
    setError(null);
    setIsConnectingWallet(true);
    try {
      await loginWithPrivy();
    } catch (err: any) {
      setError(err?.message || 'Wallet connection was cancelled.');
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const handleOtpChange = (val: string, index: number) => {
    const cleaned = val.replace(/\D/g, '');
    if (!cleaned) {
      const newOtp = [...otp];
      newOtp[index] = '';
      setOtp(newOtp);
      return;
    }

    if (cleaned.length > 1) {
      const digits = cleaned.slice(0, 6).split('');
      const newOtp = [...otp];
      digits.forEach((d, i) => {
        if (index + i < 6) {
          newOtp[index + i] = d;
        }
      });
      setOtp(newOtp);
      const nextIdx = Math.min(index + digits.length, 5);
      inputRefs.current[nextIdx]?.focus();

      // Auto enter if all 6 digits filled
      const candidate = newOtp.join('');
      if (candidate.length === 6) {
        handleVerifyCode(candidate);
      }
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = cleaned.slice(-1);
    setOtp(newOtp);

    if (index < 5 && cleaned) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto enter on 6th digit input
    const candidate = newOtp.join('');
    if (candidate.length === 6) {
      handleVerifyCode(candidate);
    }
  };

  const handleOtpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      if (!otp[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
        const newOtp = [...otp];
        newOtp[index - 1] = '';
        setOtp(newOtp);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleVerifyCode();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const digits = pasted.split('');
    const newOtp = ['', '', '', '', '', ''];
    digits.forEach((d, i) => {
      newOtp[i] = d;
    });
    setOtp(newOtp);
    const nextIdx = Math.min(digits.length, 5);
    inputRefs.current[nextIdx]?.focus();

    // Auto enter on paste
    if (digits.length === 6) {
      handleVerifyCode(digits.join(''));
    }
  };

  return (
    <div className="w-full max-w-[390px] mx-auto rounded-3xl border border-card-border bg-card p-7 shadow-2xl font-sans text-left relative overflow-hidden select-none">
      {/* Top ambient highlight line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent pointer-events-none" />

      {step === 'email' ? (
        <div>
          {/* Privy-style centered brand logo */}
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center mx-auto mb-3.5 shadow-inner">
            <Shield className="w-6 h-6 text-primary" />
          </div>

          {/* Privy-style title & subtitle */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-fg tracking-tight">Sign in to AgentGuard</h1>
            <p className="text-xs text-fg-muted mt-1">Enter your email or connect a wallet to continue</p>
          </div>

          {/* Error Message */}
          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span className="leading-tight">{error}</span>
            </div>
          )}

          {/* Email Form */}
          <form onSubmit={handleSendCode} className="space-y-3">
            <div>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder="Enter your email"
                className="w-full px-4 py-3 rounded-xl bg-card-muted border border-card-border focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm text-fg placeholder-fg-subtle focus:outline-none transition font-sans shadow-inner"
              />
            </div>

            <button
              type="submit"
              disabled={isSendingCode || !email.trim()}
              className="w-full py-3 px-4 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-hover transition duration-200 shadow-md shadow-primary/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSendingCode ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending passcode…</span>
                </>
              ) : (
                <span>Continue</span>
              )}
            </button>
          </form>

          {/* Privy-style 'or' divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-card-border" />
            </div>
            <div className="relative flex justify-center text-[11px] font-semibold text-fg-subtle uppercase tracking-wider">
              <span className="bg-card px-3">or</span>
            </div>
          </div>

          {/* Privy-style prominent wallet button */}
          <button
            type="button"
            onClick={handleWalletConnect}
            disabled={isConnectingWallet}
            className="w-full py-3 px-4 rounded-xl border border-card-border bg-card-muted hover:bg-card hover:border-primary/50 text-sm font-semibold text-fg transition duration-200 flex items-center justify-center gap-2.5 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <Wallet className="w-4 h-4 text-primary" />
            <span>{isConnectingWallet ? 'Connecting wallet…' : 'Continue with a wallet'}</span>
          </button>

          {/* Privy bottom security mark */}
          <div className="mt-6 pt-4 border-t border-card-border flex items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
            <span>Protected by</span>
            <span className="font-semibold text-fg-muted hover:text-fg transition">Privy</span>
            <span>·</span>
            <span>Monad Parallel EVM</span>
          </div>
        </div>
      ) : (
        <div>
          {/* OTP screen header with back action */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setOtp(['', '', '', '', '', '']);
                setError(null);
              }}
              className="p-1 -ml-1 text-fg-muted hover:text-fg rounded-lg hover:bg-card-muted transition flex items-center gap-1.5 text-xs font-medium cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <span className="text-[10px] uppercase font-mono tracking-widest text-fg-subtle">Privy OTP</span>
          </div>

          {/* Centered mail icon */}
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center mx-auto mb-3 shadow-inner">
            <Mail className="w-6 h-6 text-primary" />
          </div>

          {/* Title & target email */}
          <div className="text-center mb-5">
            <h1 className="text-xl font-bold text-fg tracking-tight">Enter confirmation code</h1>
            <p className="text-xs text-fg-muted mt-1">
              We sent a 6-digit code to <strong className="text-fg font-medium">{email}</strong>
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span className="leading-tight">{error}</span>
            </div>
          )}

          {/* 6 individual OTP passcode boxes with Auto-Enter */}
          <form onSubmit={(e) => handleVerifyCode(undefined, e)} className="space-y-4">
            <div className="flex items-center justify-between gap-1.5 sm:gap-2">
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => {
                    inputRefs.current[idx] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  disabled={isSubmittingCode}
                  onChange={(e) => handleOtpChange(e.target.value, idx)}
                  onKeyDown={(e) => handleOtpKeyDown(e, idx)}
                  onPaste={handleOtpPaste}
                  className={`w-12 h-14 text-center text-2xl font-mono font-bold rounded-xl transition duration-150 shadow-inner focus:outline-none ${
                    error
                      ? 'border border-rose-500/50 bg-rose-950/10 text-rose-200 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20'
                      : digit
                      ? 'border border-primary/40 bg-card text-fg focus:border-primary focus:ring-2 focus:ring-primary/25'
                      : 'border border-card-border bg-card-muted text-fg placeholder-fg-subtle focus:border-primary focus:ring-2 focus:ring-primary/25'
                  }`}
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={isSubmittingCode || otp.join('').length < 6}
              className="w-full py-3 px-4 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-hover transition duration-200 shadow-md shadow-primary/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmittingCode ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying code…</span>
                </>
              ) : (
                <span>Verify & Continue</span>
              )}
            </button>
          </form>

          {/* Resend & fallback actions */}
          <div className="mt-4 flex flex-col items-center gap-2 text-xs">
            <div className="text-fg-muted flex items-center gap-1.5">
              <span>Didn&apos;t receive a code?</span>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={isSendingCode}
                className="text-primary hover:underline font-medium cursor-pointer"
              >
                Resend
              </button>
            </div>
            <button
              type="button"
              onClick={handleWalletConnect}
              className="text-fg-subtle hover:text-fg transition text-[11px] cursor-pointer"
            >
              Or connect directly with a wallet
            </button>
          </div>

          {/* Privy bottom security mark */}
          <div className="mt-6 pt-4 border-t border-card-border flex items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
            <span>Protected by</span>
            <span className="font-semibold text-fg-muted">Privy</span>
            <span>·</span>
            <span>Monad Parallel EVM</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default InlinePrivyAuth;
