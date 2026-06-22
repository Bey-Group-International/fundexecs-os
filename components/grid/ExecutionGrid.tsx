import Link from "next/link";
import { engineSlug, type EnginePane } from "@/lib/execution-grid";
import { RerouteControl } from "@/components/grid/RerouteControl";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  in_progress: "Active",
  awaiting_approval: "Awaiting",
  blocked: "Blocked",
  completed: "Done",
  failed: "Failed",
  cancelled: "Declined",
};

// One-line on what each engine pane executes (spec section 8).
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

export function ExecutionGrid({ panes }: { panes: EnginePane[] }) {
  const totalRouted = panes.reduce((n, p) => n + p.total, 0);
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold-400">FundExecs OS</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg-primary">Execution Grid</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Every routed workflow, in the pane of the engine the Intelligence Layer sent it to.
          {" "}
          <span className="font-mono text-fg-muted">{totalRouted} routed</span>
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {panes.map((pane) => (
          <section
            key={pane.engine}
            className="flex flex-col rounded-2xl border border-line/80 bg-surface-1/70 p-4 shadow-[0_1px_2px_rgb(0_0_0/0.2)]"
          >
            <div className="flex items-start justify-between gap-2">
              <Link href={`/grid/${engineSlug(pane.engine)}`} className="group min-w-0">
                <h2 className="truncate font-display text-sm font-semibold text-fg-primary group-hover:text-gold-300">
                  {pane.engine}
                </h2>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {ENGINE_BLURB[pane.engine]}
                </p>
              </Link>
              <span className="shrink-0 rounded-full border border-gold-500/30 bg-gold-500/[0.06] px-2 py-0.5 font-mono text-[10px] text-gold-300">
                {pane.total}
              </span>
            </div>

            {pane.total > 0 ? (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {pane.active} active · {pane.done} done
              </p>
            ) : null}

            <div className="mt-3 flex flex-1 flex-col gap-1.5">
              {pane.workflows.length === 0 ? (
                <p className="text-xs text-fg-muted">No work routed here yet.</p>
              ) : (
                pane.workflows.slice(0, 6).map((wf) => {
                  const inner = (
                    <span className="flex items-center gap-2">
                      <StatusDot status={wf.status} />
                      <span className="min-w-0 flex-1 truncate text-fg-secondary group-hover:text-fg-primary">
                        {wf.title}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                        {STATUS_LABEL[wf.status] ?? wf.status}
                      </span>
                    </span>
                  );
                  return (
                    <div key={wf.id} className="flex items-center gap-1.5">
                      {wf.session_id ? (
                        <Link
                          href={`/session/${wf.session_id}`}
                          className="group min-w-0 flex-1 rounded-lg border border-line/50 bg-surface-0/40 px-2.5 py-1.5 text-xs transition hover:border-gold-500/40"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className="min-w-0 flex-1 rounded-lg border border-line/50 bg-surface-0/40 px-2.5 py-1.5 text-xs">
                          {inner}
                        </div>
                      )}
                      <RerouteControl workflowId={wf.id} currentEngine={pane.engine} />
                    </div>
                  );
                })
              )}
              {pane.workflows.length > 6 ? (
                <Link
                  href={`/grid/${engineSlug(pane.engine)}`}
                  className="mt-0.5 font-mono text-[10px] text-fg-muted transition hover:text-gold-300"
                >
                  +{pane.workflows.length - 6} more
                </Link>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
