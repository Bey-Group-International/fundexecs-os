// Shared route-level loading boundary for the authenticated shell. Without a
// loading.tsx, App Router keeps the previous page frozen until the destination
// finishes its server render + Supabase round-trips — reading as a hang on the
// force-dynamic, data-heavy pages (finance, inbox, portfolio, capital-map).
// This renders an immediate branded skeleton so every navigation is
// acknowledged within a frame. Route groups with their own loading.tsx (e.g.
// dashboard) override this.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="motion-safe:animate-pulse space-y-6">
        <div className="space-y-3">
          <div className="h-6 w-56 rounded-md bg-surface-2" />
          <div className="h-4 w-80 max-w-full rounded bg-surface-2/70" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-line bg-surface-1" />
          ))}
        </div>
        <div className="space-y-2 rounded-xl border border-line bg-surface-1 p-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 w-full rounded bg-surface-2/60" />
          ))}
        </div>
      </div>
    </div>
  );
}
