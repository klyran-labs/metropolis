import React, { Component, ErrorInfo, ReactNode } from 'react';
import { TruthfulNotice } from './UiState';
import { RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // In production, errors are captured by observability providers rather than console.log
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 my-4 bg-card border border-rose-200 dark:border-rose-900/60 rounded-[28px] shadow-sm">
          <TruthfulNotice
            variant="danger"
            title={this.props.fallbackTitle || 'Component Execution Halted'}
            message={
              this.state.error?.message ||
              'A runtime exception occurred while rendering this interface. Check Orders and wallet activity before retrying a financial action.'
            }
            actionLabel="Reload Component"
            onAction={this.handleReset}
          />
        </div>
      );
    }

    return this.props.children;
  }
}
