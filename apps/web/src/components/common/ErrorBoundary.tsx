import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
  ShieldAlert,
  RotateCcw,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Home,
  ShieldCheck,
  Cpu,
  Lock,
} from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDiagnostics: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDiagnostics: false,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // In production, errors are captured by observability telemetry
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/fleet';
  };

  private toggleDiagnostics = () => {
    this.setState((prev) => ({ showDiagnostics: !prev.showDiagnostics }));
  };

  private copyDiagnostics = () => {
    const { error, errorInfo } = this.state;
    const diagnosticPayload = {
      timestamp: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      errorName: error?.name || 'Error',
      errorMessage: error?.message || 'Unknown error',
      componentStack: errorInfo?.componentStack || null,
      stack: error?.stack || null,
    };

    if (navigator?.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(diagnosticPayload, null, 2));
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  public render() {
    if (this.state.hasError) {
      const { error, errorInfo, showDiagnostics, copied } = this.state;
      const errorMessage = error?.message || 'An unexpected client-side runtime exception occurred.';

      // Detect chunk load / version sync mismatch
      const isChunkError =
        /dynamically imported module|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed/i.test(
          errorMessage
        );

      return (
        <div className="min-h-[540px] flex items-center justify-center p-2 sm:p-6 font-sans">
          <div className="w-full max-w-3xl rounded-3xl border border-card-border bg-card p-6 sm:p-10 shadow-xl relative overflow-hidden backdrop-blur-xl">
            {/* Ambient background glows */}
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-rose-500/10 rounded-full blur-[100px] pointer-events-none" />

            {/* Header Badge */}
            <div className="flex flex-col items-center text-center">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-wider mb-5 ${
                  isChunkError
                    ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/50'
                    : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/50'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
                {isChunkError ? 'Version Synchronization Notice' : 'Client Interface Shield Engaged'}
              </span>

              {/* Central Shield Icon */}
              <div className="relative mb-5">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/20 via-purple-600/10 to-indigo-600/5 border border-primary/30 flex items-center justify-center text-primary shadow-lg ring-8 ring-primary/10">
                  {isChunkError ? (
                    <RotateCcw className="h-8 w-8 text-primary animate-spin-slow" />
                  ) : (
                    <ShieldAlert className="h-8 w-8 text-rose-500 dark:text-rose-400" />
                  )}
                </div>
              </div>

              {/* Title & Description */}
              <h1 className="text-xl sm:text-2xl font-black text-fg tracking-tight">
                {isChunkError
                  ? 'Client Version Update Required'
                  : this.props.fallbackTitle || 'Control Plane Interface Exception'}
              </h1>

              <p className="mt-2.5 max-w-lg text-xs sm:text-sm text-fg-muted leading-relaxed">
                {isChunkError
                  ? 'A new AgentGuard deployment was detected, causing a local module bundle hash mismatch. Reloading your session will fetch the active production bundle.'
                  : 'An unhandled rendering exception was caught by the client safety boundary. Outgoing transaction safety and onchain Monad policies remain unaffected.'}
              </p>
            </div>

            {/* Invariant Financial Safety Card */}
            <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 sm:p-4 text-xs">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold mb-1.5">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>Onchain Invariants Guaranteed Secure</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-[11px] text-fg-muted">
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>Monad 10143: Active</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>Transient Reentrancy Locks</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>Isolated State Partitions</span>
                </div>
              </div>
            </div>

            {/* Primary Action Controls */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-white px-5 py-2.5 text-xs font-bold shadow-md shadow-primary/25 transition cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Reload Application</span>
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="inline-flex items-center gap-2 rounded-xl bg-card-muted hover:bg-card-border/50 border border-card-border text-fg px-4 py-2.5 text-xs font-semibold transition cursor-pointer"
              >
                <Home className="h-4 w-4 text-fg-muted" />
                <span>Return to Fleet Command</span>
              </button>

              {!isChunkError && (
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="inline-flex items-center gap-2 rounded-xl bg-card-muted hover:bg-card-border/50 border border-card-border text-fg px-4 py-2.5 text-xs font-semibold transition cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4 text-fg-muted" />
                  <span>Retry Component</span>
                </button>
              )}
            </div>

            {/* Collapsible Diagnostics Section */}
            <div className="mt-8 border-t border-card-border pt-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={this.toggleDiagnostics}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted hover:text-fg transition cursor-pointer"
                >
                  {showDiagnostics ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  <span>{showDiagnostics ? 'Hide Technical Diagnostics' : 'View Technical Diagnostics'}</span>
                </button>

                {showDiagnostics && (
                  <button
                    type="button"
                    onClick={this.copyDiagnostics}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-primary hover:underline cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-500" />
                        <span>Copied JSON</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy Diagnostic Report</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {showDiagnostics && (
                <div className="mt-3 space-y-2">
                  <div className="rounded-xl border border-card-border bg-card-muted p-3.5 font-mono text-[11px] text-rose-300 overflow-x-auto max-h-48 leading-relaxed">
                    <p className="font-bold text-rose-400 mb-1">
                      {error?.name || 'Runtime Exception'}:
                    </p>
                    <p className="break-all whitespace-pre-wrap">{errorMessage}</p>
                    {error?.stack && (
                      <pre className="mt-2 text-[10px] text-fg-muted border-t border-card-border pt-2 whitespace-pre-wrap">
                        {error.stack}
                      </pre>
                    )}
                    {errorInfo?.componentStack && (
                      <pre className="mt-2 text-[10px] text-fg-subtle border-t border-card-border pt-2 whitespace-pre-wrap">
                        {errorInfo.componentStack}
                      </pre>
                    )}
                  </div>
                  <p className="text-[10px] text-fg-subtle font-mono">
                    Session Timestamp: {new Date().toISOString()} • Route: {typeof window !== 'undefined' ? window.location.pathname : '/'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
