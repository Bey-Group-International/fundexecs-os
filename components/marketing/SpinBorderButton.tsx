import Link from "next/link";
import type { ReactNode } from "react";

type SpinBorderButtonProps = {
  href: string;
  children: ReactNode;
  className?: string;
};

// Primary marketing CTA: a pill with a slowly rotating conic-gradient border in
// the gold→neural ramp, plus a soft glow that lifts on hover. Two ring layers
// sit behind an inset surface pill so only a ~2px lit edge shows and travels
// around the border. Both rings are aria-hidden; the label carries the meaning.
// Rotation halts under prefers-reduced-motion via the global CSS guard.
export function SpinBorderButton({
  href,
  children,
  className = "",
}: SpinBorderButtonProps) {
  return (
    <Link
      href={href}
      className={`fx-focus group relative inline-flex items-center justify-center overflow-hidden rounded-xl p-[2px] ${className}`.trim()}
    >
      {/* Crisp rotating border. Scaled up so the square sweep fully covers the
          rounded rect through a full rotation (no bald corners). */}
      <span
        aria-hidden
        className="fx-conic-ring animate-spin-slow absolute inset-0 scale-150"
      />
      {/* Blurred twin — an ambient glow that intensifies on hover. */}
      <span
        aria-hidden
        className="fx-conic-ring animate-spin-slow absolute inset-0 scale-150 opacity-0 blur-lg transition-opacity duration-300 group-hover:opacity-70"
      />
      <span className="relative z-10 inline-flex items-center gap-2 rounded-[10px] bg-surface-1 px-5 py-2.5 text-sm font-semibold text-fg-primary transition-colors duration-200 group-hover:bg-surface-2">
        {children}
      </span>
    </Link>
  );
}
