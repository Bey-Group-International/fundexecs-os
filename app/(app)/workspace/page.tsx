import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import { getActiveIntegrations } from "@/lib/integrations/active";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import Copilot from "@/components/Copilot";
import { PromptChips } from "@/components/workspace/PromptChips";
import { StartEarnButton } from "@/components/workspace/StartEarnButton";
import { buildOperatingBrief, type OperatingBrief } from "@/lib/operating-brief";
import type { Session, SessionGroup } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const EARN_EXAMPLES = [
  "Source family offices matching our mandate",
  "Draft an LP update memo",
  "Run IC diligence on a target",
  "Build an LBO model",
  "Map the capital network",
];

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[] }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();

  const [
    connected,
    sessionsRes,
    groupsRes,
    orgRes,
    dealsCount,
    investorsCount,
    documentsCount,
    activeWorkflowsCount,
    pendingApprovalsCount,
    blockedWorkflowsCount,
  ] = await Promise.all([
    orgConnectedChannels(supabase, ctx.orgId),
    supabase
      .from("sessions")
      .select("id, name, color, group_id, pinned_at, created_at, updated_at")
      .eq("organization_id", ctx.orgId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("session_groups")
      .select("id, name")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: true }),
    supabase
      .from("organizations")
      .select("name, operator_role, primary_strategy")
      .eq("id", ctx.orgId)
      .maybeSingle(),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .not("stage", "in", '("closed","rejected")'),
    supabase
      .from("investors")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .in("status", ["pending", "in_progress", "awaiting_approval"]),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .eq("status", "awaiting_approval"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .eq("status", "blocked"),
  ]);

  const sessions = (sessionsRes.data ?? []) as (Session & { updated_at: string | null })[];
  const groups = (groupsRes.data ?? []) as SessionGroup[];

  const groupById = new Map(groups.map((g) => [g.id, g.name]));
  const pinned = sessions.filter((s) => s.pinned_at);
  const recent = sessions.filter((s) => !s.pinned_at);
  const params = await searchParams;
  const queryPrompt = Array.isArray(params?.q) ? params.q[0] : params?.q;
  const org = orgRes.data as { name?: string | null; operator_role?: string | null; primary_strategy?: string | null } | null;
  const brief = buildOperatingBrief({
    userRole: ctx.role,
    organizationName: org?.name ?? "Your organization",
    operatorRole: org?.operator_role ?? null,
    strategy: org?.primary_strategy ?? null,
    activeWorkflows: activeWorkflowsCount.count ?? 0,
    pendingApprovals: pendingApprovalsCount.count ?? 0,
    blockedWorkflows: blockedWorkflowsCount.count ?? 0,
    openDeals: dealsCount.count ?? 0,
    investors: investorsCount.count ?? 0,
    documents: documentsCount.count ?? 0,
    connectedChannels: connected.size,
    recentSessions: sessions.length,
  });

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            FundExecs OS
          </span>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
            Sessions
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Every conversation with Earn — pick up where you left off or start something new.
          </p>
        </div>
      </header>

      <OperatingBriefCard brief={brief} />

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-14 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            No sessions yet
          </span>
          <p className="mt-2 max-w-sm text-sm text-fg-secondary">
            Ask Earn to source LPs, draft an IC memo, run diligence, or build an LBO model.
            Each conversation becomes a session you can return to.
          </p>
          <PromptChips examples={EARN_EXAMPLES} />
          <p className="mt-3 text-[11px] text-fg-muted">
            Pick one to open Earn with context, or type directly in the composer below ↓
          </p>
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                Pinned
              </h2>
              <div className="flex flex-col gap-1.5">
                {pinned.map((s) => (
                  <SessionCard key={s.id} s={s} groupName={s.group_id ? groupById.get(s.group_id) ?? null : null} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              Recent
            </h2>
            <div className="flex flex-col gap-1.5">
              {recent.map((s) => (
                <SessionCard key={s.id} s={s} groupName={s.group_id ? groupById.get(s.group_id) ?? null : null} />
              ))}
            </div>
          </section>
        </>
      )}

      <div className="relative mt-6 border-t border-line/60 bg-surface-0/95 pb-2 pt-3 backdrop-blur-xl">
        <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Earn can · source LPs · draft memos · run diligence · build models · map capital networks
        </p>
        <Copilot
          orgId={ctx.orgId}
          live={copilotLive()}
          bundles={[]}
          integrations={getActiveIntegrations(connected)}
          initialPrompt={queryPrompt ?? ""}
        />
      </div>
    </div>
  );
}

function OperatingBriefCard({ brief }: { brief: OperatingBrief }) {
  const primaryAttention = brief.needsAttention[0] ?? "No urgent attention items.";
  const primaryApproval = brief.readyForApproval[0] ?? "No approval gates are currently waiting.";
  const primaryBlocker = brief.blocked[0] ?? "No blocked workflows detected.";
  const primaryNextAction = brief.nextActions[0] ?? "Ask Earn what to move forward next.";

  return (
    <section className="mb-5">
      <div className="fx-card relative overflow-hidden p-4">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgb(var(--fx-accent-rgb)/0.14),transparent_36%)]"
        />
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold-400">
                AI Operating Brief
              </p>
              <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-fg-primary">
                {primaryAttention}
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-secondary">
                {primaryApproval} {primaryBlocker}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <StartEarnButton prompt={primaryNextAction} />
              <a href="#earn-composer" className="fx-btn-secondary">
                Focus composer
              </a>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <CompactSignal title="Approvals" value={brief.readyForApproval[0]} tone="gate" />
            <CompactSignal title="Blocked" value={brief.blocked[0]} tone="risk" />
            <CompactSignal title="Automation" value={brief.canAutomate[0]} tone="auto" />
            <CompactSignal title="Next action" value={primaryNextAction} tone="warn" />
          </div>

          <details className="group rounded-xl border border-line/70 bg-surface-0/70 px-3 py-2">
            <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.22em] text-fg-muted transition hover:text-fg-secondary">
              Show context and executive team
              <span className="ml-2 text-gold-400 group-open:hidden">+</span>
              <span className="ml-2 hidden text-gold-400 group-open:inline">-</span>
            </summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Active context
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {brief.context.map((line) => (
                    <span
                      key={line}
                      className="rounded-full border border-line bg-surface-1 px-2.5 py-1 text-[11px] text-fg-secondary"
                    >
                      {line}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Suggested executive team
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {brief.suggestedRoles.map((role) => (
                    <div key={role.role} className="rounded-xl border border-line bg-surface-1 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-fg-primary">{role.label}</p>
                        <span className="rounded-full border border-gold-500/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                          {role.approvalBoundary.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-snug text-fg-muted">{role.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-line bg-surface-1 p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                Recommended next actions
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-snug text-fg-secondary">
                {brief.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

function CompactSignal({
  title,
  value,
  tone,
}: {
  title: string;
  value: string | undefined;
  tone: "warn" | "gate" | "risk" | "auto";
}) {
  const toneClass = {
    warn: "border-amber-500/30 bg-amber-500/8 text-amber-300",
    gate: "border-gold-500/30 bg-gold-500/8 text-gold-300",
    risk: "border-status-danger/30 bg-status-danger/8 text-status-danger",
    auto: "border-emerald-500/30 bg-emerald-500/8 text-emerald-300",
  }[tone];
  return (
    <div className="rounded-xl border border-line bg-surface-0/80 p-3">
      <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${toneClass}`}>
        {title}
      </span>
      <p className="mt-2 line-clamp-2 text-xs leading-snug text-fg-secondary">
        {value ?? "No signal."}
      </p>
    </div>
  );
}

function SessionCard({
  s,
  groupName,
}: {
  s: Session & { updated_at: string | null };
  groupName: string | null;
}) {
  return (
    <Link
      href={`/session/${s.id}`}
      className="fx-card fx-card-hover group flex items-center gap-3 px-4 py-3"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: s.color ?? "#a1a1aa" }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg-primary">{s.name}</span>
        {groupName && (
          <span className="block truncate text-[11px] text-fg-muted">{groupName}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-fg-muted">
        {relativeTime(s.updated_at ?? s.created_at ?? null)}
      </span>
      <span className="shrink-0 font-mono text-fg-muted transition group-hover:translate-x-0.5 group-hover:text-gold-400">
        →
      </span>
    </Link>
  );
}
