import { cn } from '@/lib/utils';

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
 * EarnCoin — the circular Earn ("Earnest Fundmaker") avatar mark. Gold gradient
 * coin with a bold "E"; reserved for the Earn copilot / gamification surfaces.
 * Presentational; no external image dependency.
 */
export function EarnCoin({ size = 32, online = false, glow = false, className }: EarnCoinProps) {
  const coin = (
    <span
      className={cn(
        'relative inline-flex flex-none items-center justify-center rounded-full bg-gradient-to-br from-gold-1 to-gold-2 font-bold text-[#070b14] shadow-[0_2px_8px_-2px_rgba(247,201,72,0.5)]',
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.46 }}
      aria-label="Earn"
    >
      E
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
