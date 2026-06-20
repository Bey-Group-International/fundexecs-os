import Link from "next/link";
import Image from "next/image";
import { SITE_NAME } from "@/lib/site";

// Single source of truth for the FundExecs OS wordmark/brand mark used in the
// nav, auth panels, and app rail. To swap in a provided logo asset, update the
// coin path here and every placement stays in sync.
//
// `as="span"` renders a non-interactive mark (for use inside another link or
// a footer); the default renders a link back to the home page.

type LogoProps = {
  className?: string;
  as?: "link" | "span";
  href?: string;
  variant?: "wordmark" | "coin" | "coin-wordmark";
  coinClassName?: string;
};

const WORDMARK_CLASS =
  "font-mono text-xs uppercase tracking-[0.2em] text-gold-400";

function CoinMark({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/earn-coin.png"
      alt=""
      width={24}
      height={24}
      className={`h-6 w-6 rounded-md object-contain ${className}`.trim()}
      priority
    />
  );
}

export function Logo({
  className = "",
  as = "link",
  href = "/",
  variant = "wordmark",
  coinClassName = "",
}: LogoProps) {
  const isWordmark = variant === "wordmark";
  const classes = isWordmark
    ? `${WORDMARK_CLASS} ${className}`.trim()
    : `inline-flex items-center gap-2 ${className}`.trim();
  const content = (
    <>
      {variant !== "wordmark" ? <CoinMark className={coinClassName} /> : null}
      {variant !== "coin" ? (
        <span className={WORDMARK_CLASS}>{SITE_NAME}</span>
      ) : (
        <span className="sr-only">{SITE_NAME}</span>
      )}
    </>
  );

  if (as === "span") {
    return (
      <span className={classes} aria-label={SITE_NAME}>
        {isWordmark ? SITE_NAME : content}
      </span>
    );
  }

  return (
    <Link href={href} className={classes} aria-label={`${SITE_NAME} home`}>
      {isWordmark ? SITE_NAME : content}
    </Link>
  );
}
