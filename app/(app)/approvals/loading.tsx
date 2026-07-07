// Instant skeleton for the mobile approvals flow — paints the decision card
// shell while the server resolves pending approvals.
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

export default function ApprovalsLoading() {
  return (
    <div className="mx-auto max-w-lg" aria-hidden>
      <div className="flex items-end justify-between pt-1">
        <div className="space-y-2">
          <Bar className="h-3 w-20" />
          <Bar className="h-7 w-40" />
        </div>
        <Bar className="h-3 w-10" />
      </div>
      <div className="mt-3 flex gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Bar key={i} className="h-1 flex-1" />
        ))}
      </div>
      <Bar className="mt-5 h-[420px] w-full rounded-3xl" />
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] gap-2.5">
        <Bar className="h-12 rounded-2xl" />
        <Bar className="h-11 w-11 rounded-full" />
        <Bar className="h-12 rounded-2xl" />
      </div>
    </div>
  );
}
