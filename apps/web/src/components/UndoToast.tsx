import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Copy, Check, ExternalLink, Info, RotateCcw, X } from "lucide-react";
import { Mono, truncateMiddle } from "../design-system";
import { configuration } from "../configuration";

export type ToastTone = "success" | "critical" | "warning" | "info";

export interface ToastAction {
  id: string;
  agentAddress?: string;
  type?: "trip" | "reset";
  title?: string;
  message?: ReactNode | string;
  tone?: ToastTone;
  txHash?: string;
  expiresAt: number;
  onUndo?: () => void;
  onDismiss: () => void;
}

export interface ToastOptions {
  title: string;
  message?: ReactNode | string;
  description?: ReactNode | string;
  tone?: ToastTone;
  txHash?: string;
  onUndo?: () => void;
  durationMs?: number;
  agentAddress?: string;
  type?: "trip" | "reset";
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Graceful fallback if called outside provider
    return {
      toast: () => "",
      dismissToast: () => {},
      dismissAll: () => {},
    };
  }
  return ctx;
}

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastAction[]>([]);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const dismissAll = () => {
    setToasts([]);
  };

  const toast = (options: ToastOptions): string => {
    toastSeq += 1;
    const id = `toast-${Date.now()}-${toastSeq}`;
    const duration = options.durationMs ?? (options.onUndo ? 6000 : 4500);
    const expiresAt = Date.now() + duration;

    const newToast: ToastAction = {
      id,
      title: options.title,
      message: options.message ?? options.description,
      tone: options.tone ?? (options.type === "trip" ? "critical" : options.type === "reset" ? "success" : "info"),
      agentAddress: options.agentAddress,
      type: options.type,
      txHash: options.txHash,
      expiresAt,
      onUndo: options.onUndo,
      onDismiss: () => dismissToast(id),
    };

    setToasts((prev) => [...prev.slice(-4), newToast]);
    return id;
  };

  return (
    <ToastContext.Provider value={{ toast, dismissToast, dismissAll }}>
      {children}
      <UndoToastContainer
        actions={toasts}
        onUndo={(id) => {
          const item = toasts.find((t) => t.id === id);
          if (item?.onUndo) {
            item.onUndo();
          }
          dismissToast(id);
        }}
        onDismiss={dismissToast}
      />
    </ToastContext.Provider>
  );
}

export function UndoToastContainer({
  actions,
  onUndo,
  onDismiss,
}: {
  actions: ToastAction[];
  onUndo: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="undo-toast-container" role="region" aria-label="Notifications">
      {actions.map((action) => (
        <UndoToastItem
          key={action.id}
          action={action}
          onUndo={() => onUndo(action.id)}
          onDismiss={() => onDismiss(action.id)}
        />
      ))}
    </div>
  );
}

function UndoToastItem({
  action,
  onUndo,
  onDismiss,
}: {
  action: ToastAction;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    Math.max(0, Math.ceil((action.expiresAt - Date.now()) / 1000)),
  );
  const [copiedHash, setCopiedHash] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const rem = Math.max(0, Math.ceil((action.expiresAt - Date.now()) / 1000));
      setSecondsRemaining(rem);
      if (rem <= 0) {
        clearInterval(timer);
        onDismiss();
      }
    }, 250);

    return () => clearInterval(timer);
  }, [action.expiresAt, onDismiss]);

  const tone = action.tone ?? (action.type === "trip" ? "critical" : "success");
  const isTrip = action.type === "trip" || tone === "critical";

  const getToneClass = () => {
    switch (tone) {
      case "critical":
        return "undo-toast-trip";
      case "success":
        return "undo-toast-reset";
      case "warning":
        return "undo-toast-warning";
      case "info":
      default:
        return "undo-toast-info";
    }
  };

  const getIcon = () => {
    switch (tone) {
      case "critical":
        return <AlertOctagon size={18} />;
      case "success":
        return <CheckCircle2 size={18} />;
      case "warning":
        return <AlertTriangle size={18} />;
      case "info":
      default:
        return <Info size={18} />;
    }
  };

  const handleCopyHash = () => {
    if (!action.txHash) return;
    void navigator.clipboard?.writeText(action.txHash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const explorerBase = configuration.chainId === 10143 ? "https://testnet.monadexplorer.com" : null;

  return (
    <div className={`undo-toast ${getToneClass()}`} role="alert">
      <div className="undo-toast-icon">
        {getIcon()}
      </div>
      <div className="undo-toast-body">
        <strong>
          {action.title || (action.type === "trip" ? "Circuit Breaker Tripped" : action.type === "reset" ? "Circuit Breaker Reset" : "Notification")}
        </strong>
        {action.message ? (
          <div className="undo-toast-desc">{action.message}</div>
        ) : action.agentAddress ? (
          <p>
            Agent <Mono>{truncateMiddle(action.agentAddress, 8, 4)}</Mono> is now{" "}
            {isTrip ? "frozen from spending." : "active."} {action.onUndo ? `Reversible for ${secondsRemaining}s.` : ""}
          </p>
        ) : null}

        {action.txHash && (
          <div className="undo-toast-tx-row">
            <Mono>{truncateMiddle(action.txHash, 10, 6)}</Mono>
            <button
              type="button"
              className="undo-toast-copy-btn"
              onClick={handleCopyHash}
              title={copiedHash ? "Copied!" : "Copy tx hash"}
              aria-label="Copy transaction hash"
            >
              {copiedHash ? <Check size={11} /> : <Copy size={11} />}
            </button>
            {explorerBase && (
              <a
                href={`${explorerBase}/tx/${action.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="undo-toast-explorer-link"
                title="View in Monad Explorer"
              >
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
      </div>

      <div className="undo-toast-actions">
        {action.onUndo && (
          <button
            type="button"
            className="undo-toast-btn"
            onClick={onUndo}
            aria-label="Undo action"
          >
            <RotateCcw size={14} />
            <span>Undo ({secondsRemaining}s)</span>
          </button>
        )}
        <button
          type="button"
          className="undo-toast-close"
          onClick={onDismiss}
          aria-label="Dismiss toast"
        >
          <X size={14} />
        </button>
      </div>

      <div
        className="undo-toast-progress"
        style={{
          animationDuration: `${(action.expiresAt - Date.now()) / 1000}s`,
        }}
      />
    </div>
  );
}
