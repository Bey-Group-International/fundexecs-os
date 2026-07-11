import Link from "next/link";

// The gate that locks every landing-page preview. It sits over the lower edge of
// a preview surface (the roster grid, the workspace mock) on a gradient scrim so
// the content reads as "visible but sealed." Both routes into the product live
// here — Sign in for returning operators, Request access for new firms — so the
// two CTAs never drift apart across sections. The scrim owns pointer events; the
// preview beneath is inert (see the wrappers that render this).
export function AccessGate({
  eyebrow = "Locked preview",
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent pb-6 pt-24 sm:pb-8">
      <div className="fx-glass pointer-events-auto mx-4 w-full max-w-md p-5 text-center sm:p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/30 bg-gold-500/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold-300">
          <LockIcon />
          {eyebrow}
        </span>
        <h3 className="mt-4 text-lg font-semibold tracking-tight text-fg-primary">
          {title}
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-fg-secondary">
          {subtitle}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/login?mode=signup"
            className="fx-focus rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-surface-0 transition hover:bg-gold-300"
          >
            Request access
          </Link>
          <Link
            href="/login"
            className="fx-focus rounded-lg border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
