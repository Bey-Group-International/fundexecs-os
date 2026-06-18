import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Task } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

// Default session pane. Modules open in-frame via the ⋮ Session Actions →
// Hub Modules menu; this overview lists what the session has produced so far.
export default async function SessionHome({ params }: { params: { id: string } }) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("session_id", params.id)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false });
  const workflows = (data ?? []) as Task[];

  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">Session</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg-primary">
        Everything for this operation, in one place
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        Open a Hub Module from the <span className="text-fg-primary">⋮ Session Actions</span> menu
        (top-right) to work inside this session — modules inherit its context and switching never
        leaves the session. Or run something in{" "}
        <Link href="/workspace" className="text-gold-400 hover:underline">
          Earn
        </Link>
        .
      </p>

      <h2 className="mb-2 mt-8 font-mono text-xs uppercase tracking-wider text-fg-muted">
        Workflows in this session
      </h2>
      {workflows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          Nothing yet — run a prompt in Earn and it will land here.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {workflows.map((w) => (
            <div
              key={w.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2"
            >
              <span className="truncate text-sm text-fg-primary">{w.title}</span>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {w.hub} · {w.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
