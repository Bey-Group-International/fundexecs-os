import { cn } from '@/lib/utils';

/**
 * AuroraBackdrop — the prototype's ambient `bg-aurora` canvas: two large,
 * slow-drifting radial fields (gold + accent blue) behind the entry screens.
 * Decorative only; the drift is silenced under reduced-motion via the
 * `fx-aurora` policy in globals.css.
 */
export function AuroraBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('fx-aurora pointer-events-none absolute inset-0', className)}
      style={{
        backgroundImage:
          'radial-gradient(42% 36% at 22% 18%, rgba(247,201,72,0.07), transparent 70%), radial-gradient(46% 40% at 80% 78%, rgba(37,99,235,0.1), transparent 70%)'
      }}
    />
  );
}
