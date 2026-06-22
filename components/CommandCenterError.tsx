"use client";

// components/CommandCenterError.tsx
// Error boundary for CommandCenter — catches render errors and shows a retry card.
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class CommandCenterError extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { hasError: true, message };
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-red-500/30 bg-surface-2 rounded-lg p-4 text-fg-muted text-sm flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-wider text-red-400">
              Command Center Error
            </span>
          </div>
          <p className="text-fg-muted text-sm">
            Unable to load intelligence data. This is usually a temporary issue.
          </p>
          {process.env.NODE_ENV !== "production" && this.state.message && (
            <p className="font-mono text-xs text-red-400/70">{this.state.message}</p>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className="self-start rounded-md border border-line bg-surface-1 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
