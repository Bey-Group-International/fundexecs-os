import Link from "next/link";
import type { OAuthOutcome } from "@/lib/oauth-outcome";

// Renders the result of an OAuth connect round trip on the page the connect
// routes redirect back to.
//
// Colors come from the --status-* custom properties rather than Tailwind's
// `status.*` scale: that scale still holds the dark theme's pastels, which the
// globals.css comment notes "wash out to nothing on white", while the custom
// properties are the re-saturated light-page tones. This banner carries failure
// text an operator has to be able to read, so it takes the readable pair.
//
// A server component on purpose — the outcome arrives as a query parameter that
// the page already has, and dismissing is a link back to the clean URL. No
// client bundle, and it renders in the first paint rather than after hydration.
export function OAuthOutcomeBanner({
  outcome,
  dismissHref,
}: {
  outcome: OAuthOutcome;
  dismissHref: string;
}) {
  const success = outcome.tone === "success";
  const accent = success ? "var(--status-success)" : "var(--status-danger)";

  return (
    <div
      // Announced on arrival: the operator has just come back from another
      // site, and on mobile the banner may be below the fold.
      role="status"
      aria-live="polite"
      className="mb-4 flex items-start gap-3 rounded-2xl border bg-surface-1/80 px-4 py-3"
      style={{ borderColor: `color-mix(in srgb, ${accent} 35%, transparent)` }}
    >
      <span
        aria-hidden
        className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-surface-1"
        style={{ backgroundColor: accent }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          {success ? <path d="M20 6 9 17l-5-5" /> : <><path d="M12 8v5" /><path d="M12 16.5v.01" /></>}
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: accent }}>
          {outcome.title}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-fg-secondary">{outcome.detail}</p>
      </div>

      <Link
        href={dismissHref}
        aria-label="Dismiss"
        replace
        scroll={false}
        className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </Link>
    </div>
  );
}
