import Image from 'next/image';
import { cn } from '@/lib/utils';

export interface EarnRunnerProps {
  /** Square render size in pixels. Defaults to 96. */
  size?: number;
  /** Wrap the mascot in a soft gold radial glow halo (hero treatment). */
  glow?: boolean;
  className?: string;
}

/**
 * EarnRunner — the running-coin mascot, Earn in motion. The hero brand mark for
 * the landing + onboarding (where it has room to breathe); the tight circular
 * {@link EarnCoin} stays in app chrome / nav.
 *
 * Renders `public/earn-running.png` via a string `src` (not a static import) so
 * the build never fails if the asset hasn't been committed yet — it simply
 * 404s at runtime until the file lands. Ship a transparent PNG for the cleanest
 * look on the dark hero; the optional `glow` halo sits behind it either way.
 */
export function EarnRunner({ size = 96, glow = false, className }: EarnRunnerProps) {
  const mascot = (
    <Image
      src="/earn-running.png"
      alt="Earn"
      width={size}
      height={size}
      priority
      className={cn('object-contain', !glow && className)}
      style={{ width: size, height: size }}
    />
  );

  if (!glow) return mascot;

  return (
    <span className={cn('relative inline-flex flex-none', className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-4 rounded-full bg-[radial-gradient(circle,rgba(247,201,72,0.4),transparent_70%)] blur-[10px]"
      />
      <span className="relative">{mascot}</span>
    </span>
  );
}
