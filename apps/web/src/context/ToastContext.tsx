import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, ShieldAlert, X, ExternalLink } from 'lucide-react';
import { MONAD_EXPLORER_URL } from '../config/contracts';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  description?: string;
  txHash?: string;
  duration?: number; // in ms, default 5000
}

interface ToastContextValue {
  toast: (options: Omit<Toast, 'id'>) => string;
  addToast: (options: Omit<Toast, 'id'>) => string;
  success: (title: string, message?: string, txHash?: string) => string;
  error: (title: string, message?: string) => string;
  warning: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [progress, setProgress] = useState(100);
  const duration = toast.duration || 5000;

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onDismiss(toast.id);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [toast.id, duration, onDismiss]);

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />,
    error: <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />,
    warning: <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />,
    info: <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />,
  };

  const borders = {
    success: 'border-emerald-200 dark:border-emerald-900/60 bg-white/95 dark:bg-slate-900/95',
    error: 'border-rose-200 dark:border-rose-900/60 bg-white/95 dark:bg-slate-900/95',
    warning: 'border-amber-200 dark:border-amber-900/60 bg-white/95 dark:bg-slate-900/95',
    info: 'border-blue-200 dark:border-blue-900/60 bg-white/95 dark:bg-slate-900/95',
  };

  const progressColors = {
    success: 'bg-emerald-500',
    error: 'bg-rose-500',
    warning: 'bg-amber-500',
    info: 'bg-primary',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative overflow-hidden w-80 sm:w-96 rounded-2xl border shadow-xl backdrop-blur-md p-4 transition-all duration-300 animate-fade-in-up font-sans text-xs ${borders[toast.type]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start space-x-3">
          {icons[toast.type]}
          <div className="space-y-1">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">{toast.title}</h4>
            {(toast.message || toast.description) && (
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed break-words">{toast.message || toast.description}</p>
            )}
            {toast.txHash && (
              <a
                href={`${MONAD_EXPLORER_URL}/tx/${toast.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1.5 text-primary font-semibold hover:underline pt-1"
              >
                <span>Monad Explorer</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Close notification"
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition p-1 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress countdown bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full transition-all duration-75 ${progressColors[toast.type]}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}_${Math.min(9999, Math.max(1000, Date.now() % 10000))}`;
      const newToast: Toast = { ...options, id };
      setToasts((prev) => [...prev.slice(-4), newToast]); // Keep maximum 5 concurrent toasts
      return id;
    },
    []
  );

  const addToast = toast;

  const success = useCallback(
    (title: string, message?: string, txHash?: string) => {
      return toast({ type: 'success', title, message, txHash });
    },
    [toast]
  );

  const error = useCallback(
    (title: string, message?: string) => {
      return toast({ type: 'error', title, message });
    },
    [toast]
  );

  const warning = useCallback(
    (title: string, message?: string) => {
      return toast({ type: 'warning', title, message });
    },
    [toast]
  );

  const info = useCallback(
    (title: string, message?: string) => {
      return toast({ type: 'info', title, message });
    },
    [toast]
  );

  return (
    <ToastContext.Provider value={{ toast, addToast, success, error, warning, info, dismiss }}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-live="polite"
            className="fixed bottom-5 right-5 z-[70] flex flex-col space-y-2.5 pointer-events-auto"
          >
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
};
