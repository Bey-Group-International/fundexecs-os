"use client";

import { Component, Fragment, type ReactNode, type ErrorInfo } from "react";

// A mobile-tuned React error boundary. When a client component inside a mobile
// subtree throws during render, this shows a compact, recoverable card in place
// of that subtree — "This screen hit a snag" plus a Try again button that
// remounts the children — instead of the heavy full-page route fallback in
// app/(app)/error.tsx.
//
// Why a mobile-specific boundary:
//  - Compact inline recovery. The card is a small bordered panel scoped to the
//    subtree it wraps, not a min-h-[50vh] centered full-page block. The rest of
//    the app shell — bottom tab bar, headers, nav — stays intact and usable.
//  - On-the-go retry. Operators on a phone can retry a single misbehaving
//    screen (reset bumps a key to force-remount the children) without a full
//    page reload or losing their place in the shell.
//  - Complements, not replaces, the route boundary. Next.js's route-level
//    error.tsx still catches anything this doesn't wrap; this handles localized
//    render failures gracefully before they bubble up to the full-page fallback.
//
// React error boundaries must be class components, hence the class below.
//
// Safe on desktop: this only changes rendering when an error is actually
// thrown. In the normal (no-error) path it renders its children untouched, and
// the fallback styling is neutral/tokenized (no md:hidden) so it displays
// wherever the wrapped subtree renders.
export class MobileErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; label?: string },
  { hasError: boolean; key: number }
> {
  state = { hasError: false, key: 0 };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "[mobile-error-boundary]" + (this.props.label ? ` ${this.props.label}` : ""),
      error,
      info,
    );
  }

  reset = () => this.setState((s) => ({ hasError: false, key: s.key + 1 }));

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          role="alert"
          className="rounded-2xl border border-line/70 bg-surface-1 p-5"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-status-danger/40 bg-status-danger/10 text-status-danger"
            >
              !
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-fg-primary">This screen hit a snag</h2>
              <p className="mt-1 text-[13px] leading-snug text-fg-secondary">
                Something didn&apos;t load right. Try again — your data is safe.
              </p>
              <button
                type="button"
                onClick={this.reset}
                className="fx-tap mt-3 rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-xs text-fg-primary transition hover:border-gold-500/40 hover:text-gold-300"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <Fragment key={this.state.key}>{this.props.children}</Fragment>;
  }
}
