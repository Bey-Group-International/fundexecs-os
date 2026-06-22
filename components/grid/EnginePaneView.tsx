import Link from "next/link";
import type { TargetEngine } from "@/lib/intelligence";
import type { GridWorkflow } from "@/lib/execution-grid";
import { isStuck, stuckHours, stuckCount } from "@/lib/engine-sla";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  in_progress: "Active",
  awaiting_approval: "Awaiting",
  blocked: "Blocked",
  completed: "Done",
  failed: "Failed",
  cancelled: "Declined",
};

// Order status groups by lifecycle: live work first, terminal states last.
const STATUS_ORDER = ["awaiting_approval", "in_progress", "pending", "blocked", "completed", "failed", "cancelled"];

// One-line on what each engine executes (mirrors the pane blurbs on /grid).
const ENGINE_BLURB: Record<string, string> = {
  "Mandate Engine": "Strategy, mandate & thesis",
  "Outbound Engine": "Sourcing, screening & LP outreach",
  "Relationship Graph": "Market mapping & relationships",
  "Diligence Engine": "Diligence, risk & compliance",
  "Capital Stack Engine": "Underwriting, structuring & closing",
  "Workflow Builder": "Automations & orchestration",
  "Reporting Engine": "IC memos, reporting & monitoring",
};

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-status-success"
      : status === "in_progress"
        ? "bg-gold-400"
        : status === "awaiting_approval"
          ? "bg-gold-300"
          : status === "failed"
            ? "bg-status-danger"
            : "bg-fg-muted";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

// Amber "STUCK · {hours}h" pill for a workflow that has blown its SLA.
function StuckPill({ hours }: { hours: number | null }) {
  return (
    <span className="shrink-0 rounded-full border border-status-danger/40 bg-status-danger/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-danger">
      Stuck{hours !== null ? ` · ${hours}h` : ""}
    </span>
  );
}

function WorkflowRow({ wf, stuck, hours }: { wf: GridWorkflow; stuck: boolean; hours: number | null }) {
  const inner = (
    <span className="flex items-center gap-2">
      <StatusDot status={wf.status} />
      <span className="min-w-0 flex-1 truncate text-fg-secondary group-hover:text-fg-primary">{wf.title}</span>
      {stuck && <StuckPill hours={hours} />}
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
        {STATUS_LABEL[wf.status] ?? wf.status}
      </span>
    </span>
  );
  // Stuck rows get an amber accent border (replacing the gold hover) to draw the eye.
  const accent = stuck
    ? "border-status-danger/40 hover:border-status-danger/60"
    : "border-line/50 hover:border-gold-500/40";
  return wf.session_id ? (
    <Link
      href={`/session/${wf.session_id}`}
      className={`group rounded-lg border bg-surface-0/40 px-2.5 py-1.5 text-xs transition ${accent}`}
    >
      {inner}
    </Link>
  ) : (
    <div className={`rounded-lg border bg-surface-0/40 px-2.5 py-1.5 text-xs ${stuck ? "border-status-danger/40" : "border-line/50"}`}>
      {inner}
    </div>
  );
}

// Focused drill-down for a single engine: title, tallies, and the full list of
// routed workflows grouped by status (live work first, terminal states last).
// `now` is computed on the server and passed down so SLA/stuck flags stay
// deterministic (never rely on the client clock).
export function EnginePaneView({ engine, workflows, now }: { engine: TargetEngine; workflows: GridWorkflow[]; now: string }) {
  const at = new Date(now);
  const total = workflows.length;
  const active = workflows.filter((w) => ["awaiting_approval", "in_progress", "pending"].includes(w.status)).length;
  const done = workflows.filter((w) => w.status === "completed").length;
  const stuck = stuckCount(workflows, at);

  // Bucket by status, preserving the newest-first input order within each group.
  const byStatus = new Map<string, GridWorkflow[]>();
  for (const w of workflows) {
    const list = byStatus.get(w.status) ?? [];
    list.push(w);
    byStatus.set(w.status, list);
  }
  const groups = [...byStatus.keys()].sort(
    (a, b) => (STATUS_ORDER.indexOf(a) + 1 || 99) - (STATUS_ORDER.indexOf(b) + 1 || 99),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <Link href="/grid" className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold-400 hover:text-gold-300">
          ← Execution Grid
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">{engine}</h1>
          {stuck > 0 && (
            <span className="rounded-full border border-status-danger/40 bg-status-danger/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-status-danger">
              ⚠ {stuck} stuck
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          {ENGINE_BLURB[engine]}
          {" "}
          <span className="font-mono text-fg-muted">
            · {total} routed · {active} active · {done} done
          </span>
        </p>
      </header>

      {total === 0 ? (
        <p className="text-sm text-fg-muted">No work routed to this engine yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((status) => (
            <section key={status}>
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {STATUS_LABEL[status] ?? status}
                {" "}
                <span className="text-gold-300">{byStatus.get(status)!.length}</span>
              </h2>
              <div className="flex flex-col gap-1.5">
                {byStatus.get(status)!.map((wf) => (
                  <WorkflowRow key={wf.id} wf={wf} stuck={isStuck(wf, at)} hours={stuckHours(wf, at)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
