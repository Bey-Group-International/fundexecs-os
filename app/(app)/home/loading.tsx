// Instant skeleton for the mobile command center — shown while the server
// component awaits its Supabase queries, so the app paints immediately instead
// of blocking on data (app-native perceived speed). Mirrors the real layout to
// avoid a jarring shift when content arrives.
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-5" aria-hidden>
      {/* Greeting */}
      <div className="space-y-2 pt-1">
        <Bar className="h-3 w-24" />
        <Bar className="h-7 w-56" />
        <Bar className="h-3 w-40" />
      </div>

      {/* Earn panel */}
      <div className="rounded-3xl border border-line/60 bg-surface-1/60 p-4">
        <div className="flex items-center gap-3">
          <Bar className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Bar className="h-2.5 w-28" />
            <Bar className="h-3.5 w-44" />
          </div>
        </div>
        <Bar className="mt-3.5 h-12 w-full rounded-2xl" />
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-line/60 bg-surface-1/50 p-3">
            <Bar className="h-8 w-8 rounded-lg" />
            <Bar className="h-5 w-8" />
            <Bar className="h-2.5 w-12" />
          </div>
        ))}
      </div>

      {/* Next action */}
      <Bar className="h-28 w-full rounded-2xl" />

      {/* A couple of card rows */}
      <div className="space-y-2.5">
        <Bar className="h-3 w-32" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Bar key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
