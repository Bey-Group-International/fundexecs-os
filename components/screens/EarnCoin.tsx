import Image from 'next/image';
import { cn } from '@/lib/utils';
import earnCoin from '@/public/earn-coin.png';

export interface EarnCoinProps {
  /** Square size in pixels. Defaults to 32. */
  size?: number;
  /** Render a pulsing presence dot at the bottom-right. */
  online?: boolean;
  /** Wrap the coin in a soft radial glow halo. */
  glow?: boolean;
  className?: string;
}

/**
 * EarnCoin — the circular Earn ("Earnest Fundmaker") avatar mark. Renders the
 * real coin asset (`public/earn-coin.png`) on a circular white disc using
 * `next/image` with `object-contain`. Reserved for the Earn copilot /
 * gamification surfaces.
 */
export function EarnCoin({ size = 32, online = false, glow = false, className }: EarnCoinProps) {
  const coin = (
    <span
      className={cn(
        'relative inline-flex flex-none items-center justify-center overflow-hidden rounded-full bg-white shadow-[0_2px_8px_-2px_rgba(247,201,72,0.5)]',
        className
      )}
      style={{ width: size, height: size }}
      aria-label="Earn"
    >
      <Image
        src={earnCoin}
        alt="Earn"
        width={size}
        height={size}
        className="h-full w-full object-contain"
        priority={false}
      />
      {online && (
        <span
          className="absolute -bottom-0.5 -right-0.5 z-10 animate-pulse rounded-full border-2 border-bg-1 bg-success"
          style={{ width: size * 0.3, height: size * 0.3 }}
          aria-hidden
        />
      )}
    </span>
  );

  if (!glow) return coin;

  return (
    <span className="relative inline-flex flex-none">
      <span
        className="pointer-events-none absolute -inset-1.5 rounded-2xl bg-[radial-gradient(circle,rgba(247,201,72,0.32),transparent_70%)] blur-[4px]"
        aria-hidden
      />
      <span className="relative">{coin}</span>
    </span>
  );
}
