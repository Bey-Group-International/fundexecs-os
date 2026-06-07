/**
 * RouteLoading — per-route loading skeleton.
 *
 * Renders inside the AuthedShell so the nav chrome stays visible while
 * the route's server component fetches data. Tokens-only styling on a
 * solid `bg-bg-1` surface per the release-sweep guardrails.
 */
export function RouteLoading() {
  return (
    <div className="animate-pulse space-y-4 p-6" aria-label="Loading" aria-busy="true">
      {/* Page header skeleton */}
      <div className="h-6 w-48 rounded-xl bg-surface-2" />
      <div className="h-3.5 w-72 rounded-lg bg-surface-1" />
      {/* Card row skeletons */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-hairline bg-surface-1" />
        ))}
      </div>
      <div className="mt-2 h-48 rounded-2xl border border-hairline bg-surface-1" />
      <div className="mt-2 h-32 rounded-2xl border border-hairline bg-surface-1" />
    </div>
  );
}
