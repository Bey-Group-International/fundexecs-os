// Instant skeleton for the mobile Earn conversation home — shown while the
// server component awaits its Supabase queries, so the app paints immediately
// instead of blocking on data. Mirrors the chat layout to avoid a shift.
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

function Turn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Bar className="h-[30px] w-[30px] shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">{children}</div>
    </div>
  );
}

export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-4" aria-hidden>
      {/* Conversation header */}
      <div className="flex items-center gap-2.5 pt-1">
        <Bar className="h-[38px] w-[38px] rounded-full" />
        <div className="space-y-1.5">
          <Bar className="h-3.5 w-16" />
          <Bar className="h-2.5 w-40" />
        </div>
      </div>

      {/* Greeting + pulse */}
      <Turn>
        <Bar className="h-14 w-[85%] rounded-2xl rounded-tl-md" />
        <Bar className="h-[76px] w-full rounded-2xl rounded-tl-md" />
      </Turn>

      {/* Approvals turn */}
      <Turn>
        <Bar className="h-9 w-[70%] rounded-2xl rounded-tl-md" />
        <Bar className="h-24 w-full rounded-2xl" />
      </Turn>

      {/* Deal turn */}
      <Turn>
        <Bar className="h-9 w-[80%] rounded-2xl rounded-tl-md" />
        <Bar className="h-24 w-full rounded-2xl" />
      </Turn>
    </div>
  );
}
