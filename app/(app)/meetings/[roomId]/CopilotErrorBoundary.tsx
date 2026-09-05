"use client";

import React from "react";

/**
 * Keeps a failing copilot panel from ending the call.
 *
 * Everything in the copilot renders model output — notes, action items,
 * decisions — and a model can answer in a shape the panel does not expect. Any
 * throw there would otherwise reach the route's error boundary, which replaces
 * the whole page: the call ends, the camera and mic are released, and everyone
 * in the room is dropped because one sidebar panel got a surprising object.
 *
 * The transcript, the audio and the peer connections have nothing to do with
 * that failure, so they should survive it. This boundary keeps the blast radius
 * inside the sidebar and offers a retry, since the next notes refresh usually
 * arrives well-formed.
 */
interface Props {
  children: React.ReactNode;
  /** Changing this resets the boundary — a new notes payload deserves a retry. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class CopilotErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[meeting-copilot]", error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 border-l border-[var(--line)] bg-[var(--surface-1)] p-6 text-center">
        <p className="text-sm font-medium text-[var(--fg-primary)]">The copilot panel hit a problem</p>
        <p className="text-xs text-[var(--fg-secondary)]">
          Your call is still connected — audio, video and recording are unaffected.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--fg-primary)] transition-colors hover:border-[var(--gold-400)]/40"
        >
          Reload panel
        </button>
      </div>
    );
  }
}
