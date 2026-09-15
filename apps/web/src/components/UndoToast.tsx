import { useEffect, useState } from "react";
import { AlertOctagon, RotateCcw, X } from "lucide-react";
import { Mono, truncateMiddle } from "../design-system";

export interface ToastAction {
  id: string;
  agentAddress: string;
  type: "trip" | "reset";
  expiresAt: number;
  onUndo: () => void;
  onDismiss: () => void;
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

  const isTrip = action.type === "trip";

  return (
    <div className={`undo-toast ${isTrip ? "undo-toast-trip" : "undo-toast-reset"}`} role="alert">
      <div className="undo-toast-icon">
        <AlertOctagon size={18} />
      </div>
      <div className="undo-toast-body">
        <strong>
          {isTrip ? "Circuit Breaker Tripped" : "Circuit Breaker Reset"}
        </strong>
        <p>
          Agent <Mono>{truncateMiddle(action.agentAddress, 8, 4)}</Mono> is now{" "}
          {isTrip ? "frozen from spending." : "active."} Reversible for {secondsRemaining}s.
        </p>
      </div>
      <div className="undo-toast-actions">
        <button
          type="button"
          className="undo-toast-btn"
          onClick={onUndo}
          aria-label="Undo action"
        >
          <RotateCcw size={14} />
          <span>Undo</span>
        </button>
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
          animationDuration: `${Math.max(1, (action.expiresAt - Date.now()) / 1000)}s`,
        }}
      />
    </div>
  );
}
