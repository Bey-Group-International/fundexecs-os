import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type {
  Session,
  Task,
  Artifact,
  ArtifactType,
  SessionShare,
} from "@/lib/supabase/database.types";

// Public, read-only viewer for a shared session. Lives OUTSIDE the authed
// (app) group so it's reachable without a login. Resolves the share by token
// with the service-role client (RLS-bypassing) — but only ever exposes shares
// explicitly marked `scope: 'public'`. `org`-scoped shares are never viewable
// here; the token is the sole gate.
export const dynamic = "force-dynamic";

const ARTIFACT_LABEL: Record<ArtifactType, string> = {
  ic_memo: "IC Memo",
  model: "Model",
  analysis: "Analysis",
  risk_report: "Risk Report",
  lp_update: "LP Update",
  memo: "Memo",
  summary: "Summary",
  other: "Deliverable",
};

function Unavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
        FundExecs OS
      </span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-fg-primary">
        This link isn&apos;t available
      </h1>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        The share link is invalid, has been revoked, or is not public. Ask the
        sender for a fresh link.
      </p>
    </main>
  );
}

export default async function SharedSessionPage(
  props: {
    params: Promise<{ token: string }>;
  }
) {
  const params = await props.params;
  // No service role key configured (e.g. a preview without secrets) — fail
  // closed rather than crashing.
  if (!hasSupabaseServiceEnv()) return <Unavailable />;

  const supabase = createServiceClient();

  const { data: shareRow } = await supabase
    .from("session_shares")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();

  const share = shareRow as SessionShare | null;

  // Unknown token OR an org-scoped share → not publicly viewable.
  if (!share || share.scope !== "public") return <Unavailable />;

  const { data: sessionRow } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", share.session_id)
    .maybeSingle();

  const session = sessionRow as Session | null;
  if (!session) return <Unavailable />;

  // Top-level workflow runs for this session (steps have parent_task_id set).
  const { data: workflowRows } = await supabase
    .from("tasks")
    .select("*")
    .eq("session_id", session.id)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(20);

  const workflows = (workflowRows ?? []) as Task[];

  // Deliverables produced by those workflow runs.
  let artifacts: Artifact[] = [];
  if (workflows.length > 0) {
    const { data: artifactRows } = await supabase
      .from("artifacts")
      .select("*")
      .in(
        "workflow_id",
        workflows.map((w) => w.id),
      )
      .order("created_at", { ascending: false })
      .limit(8);
    artifacts = (artifactRows ?? []) as Artifact[];
  }

  return (
    <main className="min-h-screen bg-surface-0 text-fg-primary">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              Shared session
            </span>
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              Shared read-only
            </span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-fg-primary">
            {session.name}
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            A read-only snapshot of this session&apos;s workflows and
            deliverables.
          </p>
        </header>

        <section className="mb-10">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
            Workflows
          </h2>
          {workflows.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No workflow runs in this session yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {workflows.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2"
                >
                  <span className="truncate text-sm text-fg-primary">
                    {w.title}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {w.hub} · {w.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
            Latest deliverables
          </h2>
          {artifacts.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No deliverables produced yet.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {artifacts.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-line bg-surface-1 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                      {ARTIFACT_LABEL[a.artifact_type]}
                    </span>
                    <span className="truncate text-sm text-fg-primary">
                      {a.title}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-xs leading-snug text-fg-muted">
                    {a.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-12 border-t border-line pt-6 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fg-muted">
            Powered by FundExecs OS
          </span>
        </footer>
      </div>
    </main>
  );
}
