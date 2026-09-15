import { useLoginWithEmail } from "@privy-io/react-auth";
import { ArrowRight, Mail, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { TextField } from "./design-system";
import { useIdentity } from "./identity";

export function InlineSignIn() {
  const identity = useIdentity();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const awaitingCode = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const busy = state.status === "sending-code" || state.status === "submitting-code";

  const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      await sendCode({ email: email.trim() });
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

  if (!identity.ready) return null;

  return (
    <div className="signin-widget">
      {!awaitingCode ? (
        <form className="signin-form" onSubmit={(event) => void submitEmail(event)}>
          <TextField
            label="Email address"
            icon={<Mail size={18} />}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="submit"
            className="control control-filled landing-cta"
            disabled={busy || !email.trim()}
          >
            {busy ? "Sending code…" : "Continue with email"}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>
      ) : (
        <form className="signin-form" onSubmit={(event) => void submitCode(event)}>
          <p className="signin-hint">Enter the code sent to {email}</p>
          <TextField
            label="6-digit code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="control control-filled landing-cta"
            disabled={busy || code.trim().length < 6}
          >
            {busy ? "Verifying…" : "Verify and continue"}
          </button>
          <button
            type="button"
            className="control control-text signin-resend"
            onClick={() => void sendCode({ email })}
            disabled={busy}
          >
            Resend code
          </button>
        </form>
      )}
      {error && <p className="form-message">{error}</p>}
      <div className="signin-divider">
        <span>or</span>
      </div>
      <button type="button" className="control control-tonal signin-wallet" onClick={() => void identity.login()}>
        <Wallet size={16} />
        Continue with a wallet
      </button>
    </div>
  );
}
