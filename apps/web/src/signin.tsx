import { useLoginWithEmail } from "@privy-io/react-auth";
import { ArrowRight, CheckCircle2, Lock, Mail, ShieldCheck, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { TextField } from "./design-system";
import { useIdentity } from "./identity";
import { networkLabel } from "./configuration";

export function InlineSignIn() {
  const identity = useIdentity();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [activeTab, setActiveTab] = useState<"email" | "wallet">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);

  const awaitingCode = !editingEmail && (state.status === "awaiting-code-input" || state.status === "submitting-code");
  const busy = state.status === "sending-code" || state.status === "submitting-code";

  const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@") || !trimmed.includes(".")) {
      setError("Please enter a valid institutional or personal email address.");
      return;
    }
    try {
      await sendCode({ email: trimmed });
      setEditingEmail(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send a code to that address.");
    }
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      await loginWithCode({ code: code.trim() });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "That code did not match.");
    }
  };

  if (!identity.ready) {
    return (
      <div className="signin-card signin-card-loading">
        <div className="signin-skeleton" />
      </div>
    );
  }

  return (
    <div className="signin-card">
      <div className="signin-card-header">
        <div className="signin-badge">
          <ShieldCheck size={22} className="signin-badge-icon" />
        </div>
        <div className="signin-title-wrap">
          <h2 className="signin-title">Access AgentGuard</h2>
          <p className="signin-subtitle">Institutional spend control & Monad parallel EVM settlement</p>
        </div>
      </div>

      <div className="signin-tabs" role="tablist" aria-label="Sign in methods">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "email"}
          className={`signin-tab ${activeTab === "email" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("email");
            setError("");
          }}
        >
          <Mail size={16} />
          <span>Email Passcode</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "wallet"}
          className={`signin-tab ${activeTab === "wallet" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("wallet");
            setError("");
          }}
        >
          <Wallet size={16} />
          <span>Web3 Wallet</span>
        </button>
      </div>

      <div className="signin-card-body">
        {activeTab === "email" ? (
          !awaitingCode ? (
            <form className="signin-form" onSubmit={(event) => void submitEmail(event)}>
              <p className="signin-form-note">
                Enter your work or organizational email to receive a passwordless one-time verification code.
              </p>
              <div className="signin-field-group">
                <TextField
                  label="Work email address"
                  icon={<Mail size={18} />}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@organization.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <button
                type="submit"
                className="control control-filled signin-primary-cta"
                disabled={busy || !email.trim()}
              >
                {busy ? "Sending security code…" : "Continue with Email"}
                {!busy && <ArrowRight size={16} />}
              </button>

              <div className="signin-divider">
                <span>or</span>
              </div>

              <button
                type="button"
                className="control control-tonal signin-secondary-cta"
                onClick={() => void identity.login()}
              >
                <Wallet size={16} />
                <span>Instant Wallet Connect</span>
              </button>
            </form>
          ) : (
            <form className="signin-form" onSubmit={(event) => void submitCode(event)}>
              <div className="signin-code-notice">
                <div className="signin-code-badge">
                  <Mail size={16} />
                </div>
                <div className="signin-code-text">
                  <span>Verification code sent to</span>
                  <strong>{email}</strong>
                </div>
              </div>

              <div className="signin-field-group">
                <TextField
                  label="6-digit verification code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  autoFocus
                  className="signin-otp-field"
                />
              </div>

              <button
                type="submit"
                className="control control-filled signin-primary-cta"
                disabled={busy || code.trim().length < 6}
              >
                {busy ? "Verifying signature…" : "Verify and Continue"}
                {!busy && <ArrowRight size={16} />}
              </button>

              <div className="signin-actions-row">
                <button
                  type="button"
                  className="signin-link-btn"
                  onClick={() => void sendCode({ email })}
                  disabled={busy}
                >
                  Resend code
                </button>
                <span className="signin-dot-sep">·</span>
                <button
                  type="button"
                  className="signin-link-btn"
                  onClick={() => {
                    setEditingEmail(true);
                    setCode("");
                    setError("");
                  }}
                >
                  Change email
                </button>
              </div>
            </form>
          )
        ) : (
          <div className="signin-wallet-view">
            <div className="signin-wallet-banner">
              <div className="signin-wallet-network">
                <span className="status-dot status-dot-success" />
                <span>{networkLabel} (Chain ID 10143)</span>
              </div>
              <p className="signin-wallet-desc">
                Connect your institutional Web3 or hardware wallet. Your private key remains local and is never shared or exported.
              </p>
            </div>

            <button
              type="button"
              className="control control-filled signin-primary-cta signin-wallet-btn"
              onClick={() => void identity.login()}
            >
              <Wallet size={18} />
              <span>Connect Web3 Wallet</span>
              <ArrowRight size={16} />
            </button>

            <div className="signin-supported-wallets">
              <span className="signin-supported-label">Supported Wallets</span>
              <div className="signin-wallet-tags">
                <span className="signin-wallet-tag">MetaMask</span>
                <span className="signin-wallet-tag">Coinbase Wallet</span>
                <span className="signin-wallet-tag">Rainbow</span>
                <span className="signin-wallet-tag">WalletConnect</span>
              </div>
            </div>
          </div>
        )}

        {error && <div className="signin-error-banner" role="alert">{error}</div>}
      </div>

      <div className="signin-card-footer">
        <div className="signin-security-badges">
          <span className="signin-security-badge" title="Cryptographic spend intent validation">
            <Lock size={12} />
            <span>EIP-712 Signed</span>
          </span>
          <span className="signin-security-badge" title="Self-custodied wallet key generation">
            <ShieldCheck size={12} />
            <span>Non-Custodial</span>
          </span>
          <span className="signin-security-badge" title="Hardware isolated signer vault">
            <CheckCircle2 size={12} />
            <span>Hardware Sealed</span>
          </span>
        </div>
      </div>
    </div>
  );
}
