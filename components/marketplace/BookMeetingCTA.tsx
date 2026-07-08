// "Book a meeting" call-to-action. Points at a scheduling link
// (NEXT_PUBLIC_BOOKING_URL by default — e.g. a Calendly URL). Opt-in: renders
// nothing unless a URL is configured or passed, so surfaces stay clean when
// scheduling isn't wired up.
export function BookMeetingCTA({
  href = process.env.NEXT_PUBLIC_BOOKING_URL,
  label = "Book a meeting with an advisor",
  sublabel = "Talk through a listing or your mandate — 15 minutes.",
  compact = false,
}: {
  href?: string;
  label?: string;
  sublabel?: string;
  compact?: boolean;
}) {
  if (!href) return null;

  if (compact) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
      >
        <span aria-hidden>📅</span> {label}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fx-card fx-card-hover mb-6 flex items-center justify-between gap-4 p-4 animate-fade-up"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 text-lg"
        >
          📅
        </span>
        <div>
          <p className="text-sm font-medium text-fg-primary">{label}</p>
          <p className="text-xs text-fg-muted">{sublabel}</p>
        </div>
      </div>
      <span className="font-mono text-xs uppercase tracking-wider text-gold-300">Book →</span>
    </a>
  );
}
