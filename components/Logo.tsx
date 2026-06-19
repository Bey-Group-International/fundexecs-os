import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

// Single source of truth for the FundExecs OS wordmark used in the nav and
// auth panels. To swap in a provided logo asset, drop the file in /public and
// render it here (e.g. next/image) — every placement updates at once.
//
// `as="span"` renders a non-interactive mark (for use inside another link or
// a footer); the default renders a link back to the home page.

type LogoProps = {
  className?: string;
  as?: "link" | "span";
};

const WORDMARK_CLASS =
  "font-mono text-xs uppercase tracking-[0.2em] text-gold-400";

export function Logo({ className = "", as = "link" }: LogoProps) {
  const classes = `${WORDMARK_CLASS} ${className}`.trim();

  if (as === "span") {
    return (
      <span className={classes} aria-label={SITE_NAME}>
        {SITE_NAME}
      </span>
    );
  }

  return (
    <Link href="/" className={classes} aria-label={`${SITE_NAME} — home`}>
      {SITE_NAME}
    </Link>
  );
}
