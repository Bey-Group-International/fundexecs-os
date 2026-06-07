import { cn } from '@/lib/utils';

export interface RouteSkeletonProps {
  /** Surface label shown above the skeleton (e.g. "Pipeline"). */
  label?: string;
}

/**
 * RouteSkeleton — a tasteful, tokens-only loading placeholder for a route
 * segment's `loading.tsx`. Renders on a solid `bg-bg-1` canvas with a header
 * line, a stat strip, and a grid of card shimmers so heavy data routes show
 * structure instead of a blank flash while their loaders resolve.
 *
 * Shimmer uses Tailwind's `animate-pulse` on hairline/surface tokens only.
 */
export function RouteSkeleton({ label }: RouteSkeletonProps) {
  return (
    <main aria-busy="true" aria-live="polite" className="min-h-screen bg-bg-1 px-6 py-8 md:px-10">
      <span className="sr-only">{label ? `Loading ${label}…` : 'Loading…'}</span>
      <div className="mx-auto w-full max-w-6xl animate-pulse">
        {/* header */}
        <Bar className="h-3 w-28" />
        <Bar className="mt-3 h-6 w-64" />

        {/* stat strip */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} className="h-24" />
          ))}
        </div>

        {/* main content grid */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonCard className="h-64 lg:col-span-2" />
          <SkeletonCard className="h-64" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4">
          <SkeletonCard className="h-40" />
        </div>
      </div>
    </main>
  );
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-hairline bg-surface-1 p-5 shadow-[var(--shadow-md)]',
        className
      )}
    >
      <Bar className="h-3 w-24" />
      <Bar className="mt-3 h-3 w-2/3" />
      <Bar className="mt-2 h-3 w-1/2" />
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-surface-2', className)} />;
}
