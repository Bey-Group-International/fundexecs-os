import Link from "next/link";

// The access CTA that sits beneath each landing-page preview. Previews are now
// fully visible; this panel is the invitation into the product rather than a
// lock over the content. Both routes live here — Sign in for returning
// operators, Request access for new firms — so the two CTAs never drift apart
// across sections. Rendered in normal flow below the preview it belongs to.
export function AccessGate({
  eyebrow = "Get access",
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mt-8 flex justify-center">
      <div className="fx-glass w-full max-w-md p-5 text-center sm:p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/30 bg-gold-500/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold-300">
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
