import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import { getActiveIntegrations } from "@/lib/integrations/active";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import Copilot from "@/components/Copilot";
import { OperatingBriefCard, SessionCard, SessionsHeader } from "@/components/workspace/SessionsView";
import { ShowMoreList } from "@/components/workspace/ShowMoreList";
import { buildOperatingBrief } from "@/lib/operating-brief";
import type { Session, SessionGroup } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

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
      // Exclude terminal deals with real deal_stage enum members — "closed"/
      // "rejected" aren't in the enum and make Postgres reject the query.
      .not("stage", "in", "(exited,passed,dead)"),
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

  // Only surface the operating brief when it has something to say —
  // real attention items, a blocker, a pending approval, or live automation.
  // Otherwise it collapses to "No X / No Y" noise, so we hide it entirely.
  const showBrief =
    brief.needsAttention.length > 0 ||
    (pendingApprovalsCount.count ?? 0) > 0 ||
    (blockedWorkflowsCount.count ?? 0) > 0 ||
    (activeWorkflowsCount.count ?? 0) > 0;

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      <SessionsHeader />

      {showBrief && <OperatingBriefCard brief={brief} />}

      {/* Session lists only when they exist. With no sessions, Earn's composer
          hero below is the single, intentional entry point — no duplicate
          empty-state card or prompt chips. */}
      {pinned.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-fg-muted">
            Pinned
          </h2>
          <div className="flex flex-col gap-1.5">
            {pinned.map((s) => (
              <SessionCard key={s.id} s={s} groupName={s.group_id ? groupById.get(s.group_id) ?? null : null} />
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-fg-muted">
            Recent
          </h2>
          {/* The first ten; the rest open on request, so a long history does not
              push the composer a screen or more down the page. */}
          <ShowMoreList
            items={recent.map((s) => (
              <SessionCard key={s.id} s={s} groupName={s.group_id ? groupById.get(s.group_id) ?? null : null} />
            ))}
          />
        </section>
      )}

      <div id="earn-composer" className="relative mt-6 border-t border-line/60 bg-surface-0/95 pb-2 pt-3 backdrop-blur-xl">
        <Copilot
          orgId={ctx.orgId}
          live={copilotLive()}
          bundles={[]}
          integrations={getActiveIntegrations(connected)}
          initialPrompt={queryPrompt ?? ""}
          embedded
        />
      </div>
    </div>
  );
}

