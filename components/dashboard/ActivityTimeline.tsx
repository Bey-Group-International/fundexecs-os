import type { DashboardActivity } from "@/lib/dashboard/types";

function timeLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recent";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ActivityTimeline({ activities }: { activities: DashboardActivity[] }) {
  return (
    <section className="fx-card p-4">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
        Activity timeline
      </h2>
      {activities.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-0/60 p-4 text-sm text-fg-muted">
          Activity appears here as workflows, approvals, and dispatches move through the operating system.
        </p>
      ) : (
        <ol className="space-y-3">
          {activities.map((activity) => (
            <li key={activity.id} className="grid grid-cols-[auto_1fr] gap-3">
              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-gold-400 shadow-[0_0_10px_rgba(251,191,36,0.55)]" />
              <span>
                <span className="block text-sm text-fg-primary">{activity.title}</span>
                <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {activity.detail} · {timeLabel(activity.createdAt)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
