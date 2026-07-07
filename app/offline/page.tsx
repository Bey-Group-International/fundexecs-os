import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline · FundExecs OS",
  robots: { index: false, follow: false },
};

// Offline fallback served by the app-shell service worker when a navigation
// fails with no network. Intentionally self-contained and static.
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface-0 px-6 text-center text-fg-primary">
      <div className="max-w-sm">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10 font-display text-2xl font-semibold text-gold-300">
          FX
        </span>
        <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          FundExecs OS needs a connection to sync your deals, approvals, and Earn&apos;s work. Reconnect
          and we&apos;ll pick up right where you left off.
        </p>
        <Link
          href="/home"
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-gold-500/40 bg-gold-500/[0.08] px-5 py-2.5 text-sm font-semibold text-gold-300 transition hover:border-gold-500/60"
        >
          Try again
        </Link>
        <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
          FundExecs OS · Private markets operating system
        </p>
      </div>
    </main>
  );
}
