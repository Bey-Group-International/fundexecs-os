import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NetworkModule } from "@/components/source/NetworkModule";
import { loadNetworkActivity, loadNetworkLiveCounts } from "@/lib/network-active";
import {
  applyRosterQuery,
  getRoster,
  parseRosterQuery,
  DEFAULT_PAGE_SIZE,
} from "@/lib/network-roster";
import { loadAllFieldDefs } from "@/lib/network-field-defs.server";
import {
  loadOwnerNames,
  mapOpportunity,
  OPPORTUNITY_SELECT,
  type OpportunityStage,
} from "@/lib/network-opportunities";

export const metadata: Metadata = {
  title: "Network · FundExecs OS",
  description:
    "Your active network in real time — relationship capital ranked by warmth, a live activity feed, warm introductions, and syndicate circles.",
};

export const dynamic = "force-dynamic";

// Network OS — a standalone, side-rail destination. The default view is the
// operator's ACTIVE NETWORK, assembled from first-party Source-hub data (the
// capital pipeline, relationship contacts, partners, providers) rather than an
// imported address book, alongside a live activity feed.
//
// Only the FIRST PAGE of the roster is rendered here. This page used to embed
// every person in the org in its payload and let the browser page through them;
// the rest now comes from /api/network/roster as the operator scrolls or
// filters, which is the same code path this first page goes through.
export default async function NetworkPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  // syndicate_circles is not in the generated database types; the loose client
  // mirrors how the rest of the Network OS reads these newer tables.
  const looseDb = supabase as any;
  const orgId = ctx.orgId;

  const [
    { people, pulse },
    activityEvents,
    liveCounts,
    circlesRes,
    principalRes,
    membersRes,
    fieldDefs,
    opportunitiesRes,
    pipelineSummaryRes,
    ownerNames,
  ] = await Promise.all([
    getRoster(supabase, orgId),
    loadNetworkActivity(supabase, orgId, 40),
    loadNetworkLiveCounts(supabase, orgId),
    looseDb
      .from("syndicate_circles")
      .select("id, name, description, member_count, invite_code, is_active, created_at")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("principals")
      .select("full_name, title")
      .eq("id", ctx.userId)
      .limit(1)
      .single(),
    // The assignable owners for the roster's owner filter and bulk assign.
    looseDb
      .from("organization_members")
      .select("principal_id, principals(full_name)")
      .eq("organization_id", orgId)
      .limit(200),
    // The org's own columns, for the table view.
    loadAllFieldDefs(looseDb, orgId),
    // Live pipeline for the board, plus the rollup it puts in its headers.
    looseDb
      .from("network_opportunities")
      .select(OPPORTUNITY_SELECT)
      .eq("organization_id", orgId)
      .eq("status", "open")
      .order("expected_close", { ascending: true, nullsFirst: false })
      .limit(200),
    looseDb.rpc("network_pipeline_summary", { target_org: orgId }),
    loadOwnerNames(looseDb, orgId),
  ]);

  const initialRoster = applyRosterQuery(people, parseRosterQuery(new URLSearchParams()), pulse);

  // A failed read must not render as an empty pipeline. Zero deals and an
  // unreachable database look the same on the board, and only one of them is a
  // fact about the business — so say the numbers are unavailable instead of
  // quietly reporting nothing raised.
  const pipelineFailed = Boolean(opportunitiesRes.error || pipelineSummaryRes.error);
  if (pipelineFailed) {
    console.error(
      "[network] pipeline load",
      opportunitiesRes.error ?? pipelineSummaryRes.error,
    );
  }

  const opportunities = ((opportunitiesRes.data ?? []) as Record<string, any>[]).map((row) =>
    mapOpportunity(row, ownerNames),
  );

  const pipelineSummary = ((pipelineSummaryRes.data ?? []) as Record<string, any>[]).map((r) => ({
    stage: r.stage as OpportunityStage,
    currency: String(r.currency ?? "USD"),
    dealCount: Number(r.deal_count ?? 0),
    targetTotal: Number(r.target_total ?? 0),
    weightedTotal: Math.round(Number(r.weighted_total ?? 0)),
  }));

  type MemberRow = {
    principal_id: string;
    principals: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const owners = ((membersRes.data ?? []) as MemberRow[])
    .map((m) => {
      const p = Array.isArray(m.principals) ? m.principals[0] : m.principals;
      return { id: m.principal_id, name: p?.full_name ?? "Unnamed member" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  type CircleRow = {
    id: string;
    name: string;
    description: string | null;
    member_count: number | null;
    invite_code: string | null;
    is_active: boolean | null;
    created_at: string;
  };
  const circles = ((circlesRes.data ?? []) as CircleRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    memberCount: c.member_count ?? 1,
    inviteCode: c.invite_code ?? "",
    isActive: c.is_active ?? true,
    createdAt: c.created_at,
  }));

  const principal = principalRes.data as { full_name: string | null; title: string | null } | null;
  const senderName = principal?.full_name ?? ctx.email ?? "You";
  const senderTitle = principal?.title ?? null;

  return (
    <div className="fx-ambient mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 animate-fade-up">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(212,175,106,0.6)]" />
          Network OS
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Your Active Network
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-secondary">
          Relationship capital ranked by warmth and streaming in real time — populated from your
          Source pipeline, not an imported address book. Request warm introductions and pool your
          network with trusted syndicate partners.
        </p>
      </header>

      <NetworkModule
        senderName={senderName}
        senderTitle={senderTitle}
        initialRoster={initialRoster}
        owners={owners}
        pageSize={DEFAULT_PAGE_SIZE}
        fieldDefs={fieldDefs.contact}
        opportunities={opportunities}
        pipelineSummary={pipelineSummary}
        pipelineUnavailable={pipelineFailed}
        pulse={pulse}
        activityEvents={activityEvents}
        liveCounts={liveCounts}
        circles={circles}
      />
    </div>
  );
}
