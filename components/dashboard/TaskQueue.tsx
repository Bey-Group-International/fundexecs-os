import Link from "next/link";
import type { Task } from "@/lib/supabase/database.types";

const PRIORITY: Record<string, string> = {
  awaiting_approval: "text-gold-300",
  blocked: "text-status-danger",
  in_progress: "text-status-success",
  pending: "text-fg-muted",
};

export function TaskQueue({ tasks }: { tasks: Task[] }) {
  return (
    <section className="fx-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-fg-muted">Task queue</h2>
        <Link href="/workspace" className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
          Open Earn →
        </Link>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-0/60 p-4 text-sm text-fg-muted">
          No active tasks here yet. Create one from the quick action panel to start a resumable workflow.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <div key={task.id} className="rounded-xl border border-line bg-surface-0/55 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">{task.title}</span>
                <span className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${PRIORITY[task.status] ?? "text-fg-muted"}`}>
                  {task.status.replace("_", " ")}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3/80">
                <span
                  className="block h-full rounded-full bg-gold-500"
                  style={{ width: `${Math.round(task.progress * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
