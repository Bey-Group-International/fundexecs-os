import nextDynamic from "next/dynamic";
import { ModuleView } from "@/components/ModuleView";
import { sourcingLive, sourcingEnrichmentEnabled } from "@/lib/source-ai";
import { copilotLive } from "@/lib/claude";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NetworkModule } from "@/components/source/NetworkModule";
import { buildCapitalMap } from "@/lib/capital-map";
import { computeGPScorecard } from "@/lib/gp-scorecard";
import type { LPMatch } from "@/components/source/LPDiscoveryPanel";
import type { OutreachItem } from "@/components/source/OutreachPriorityQueue";
import type { CommTemplate } from "@/components/execute/ShareholderComms";

// Lazily loaded — each search/triage surface is heavy and hub-specific.
// next/dynamic splits them into separate chunks loaded only when the matching
// route is visited, rather than bundling all four on every module page.
const SourceSearch = nextDynamic(() =>
  import("@/components/source/SourceSearch").then((m) => m.SourceSearch),
);
const SourceTriage = nextDynamic(() =>
  import("@/components/source/SourceTriage").then((m) => m.SourceTriage),
);
const OwnershipIntel = nextDynamic(() =>
  import("@/components/source/OwnershipIntel").then((m) => m.OwnershipIntel),
);
const SourcingIntel = nextDynamic(() =>
  import("@/components/source/SourcingIntel").then((m) => m.SourcingIntel),
);
const OutreachStudio = nextDynamic(() =>
  import("@/components/source/OutreachStudio").then((m) => m.OutreachStudio),
);
const SourceSignals = nextDynamic(() =>
  import("@/components/source/SourceSignals").then((m) => m.SourceSignals),
);
const SourceRadar = nextDynamic(() =>
  import("@/components/source/SourceRadar").then((m) => m.SourceRadar),
);
const SourceFunnel = nextDynamic(() =>
  import("@/components/source/SourceFunnel").then((m) => m.SourceFunnel),
);
const RadarAttribution = nextDynamic(() =>
  import("@/components/source/RadarAttribution").then((m) => m.RadarAttribution),
);
const CronHealth = nextDynamic(() =>
  import("@/components/ops/CronHealth").then((m) => m.CronHealth),
);
const RunSearch = nextDynamic(() =>
  import("@/components/run/RunSearch").then((m) => m.RunSearch),
);
const ExecuteSearch = nextDynamic(() =>
  import("@/components/execute/ExecuteSearch").then((m) => m.ExecuteSearch),
);

// Hub-specific feature components (lazy-loaded for code splitting).
const ClosingLive = nextDynamic(() =>
  import("@/components/execute/ClosingLive").then((m) => m.ClosingLive),
);
const PortfolioHealthLive = nextDynamic(() =>
  import("@/components/execute/PortfolioHealthLive").then(
    (m) => m.PortfolioHealthLive,
  ),
);
const ThesisLive = nextDynamic(() =>
  import("@/components/intelligence/ThesisLive").then((m) => m.ThesisLive),
);
const WorkspaceDocumentListLive = nextDynamic(() =>
  import("@/components/workspace/WorkspaceDocumentListLive").then((m) => m.WorkspaceDocumentListLive),
);
const PeopleLookupLive = nextDynamic(() =>
  import("@/components/source/PeopleLookupLive").then((m) => m.PeopleLookupLive),
);
const LPDiscoveryPanel = nextDynamic(() =>
  import("@/components/source/LPDiscoveryPanel").then((m) => m.LPDiscoveryPanel),
);
const DealStageFunnel = nextDynamic(() =>
  import("@/components/source/DealStageFunnel").then((m) => m.DealStageFunnel),
);
const OutreachPriorityQueue = nextDynamic(() =>
  import("@/components/source/OutreachPriorityQueue").then((m) => m.OutreachPriorityQueue),
);
const ShareholderComms = nextDynamic(() =>
  import("@/components/execute/ShareholderComms").then((m) => m.ShareholderComms),
);
const GPProfileScorecard = nextDynamic(() =>
  import("@/components/build/GPProfileScorecard").then((m) => m.GPProfileScorecard),
);

// The `source` hub's standalone modules: a registry of module key → render fn.
// Each shares the same shape (a sourcing-live surface keyed off ?q), so they live
// in one map instead of a long if-ladder — adding a module is a one-line entry.
// (Bespoke source modules like `lp_pipeline` are handled separately below.)
const SOURCE_MODULES: Record<string, (initialPrompt?: string) => JSX.Element> = {
  search: (initialPrompt) => (
    <SourceSearch
      live={sourcingLive()}
      webEnrichment={sourcingEnrichmentEnabled()}
      initialPrompt={initialPrompt}
    />
  ),
  triage: (initialPrompt) => <SourceTriage live={sourcingLive()} initialPrompt={initialPrompt} />,
  buyers: (initialPrompt) => <OwnershipIntel live={sourcingLive()} initialPrompt={initialPrompt} />,
  intel: (initialPrompt) => <SourcingIntel live={sourcingLive()} initialPrompt={initialPrompt} />,
  // outreach handled by custom block below (includes OutreachPriorityQueue)
  signals: (initialPrompt) => <SourceSignals live={sourcingLive()} initialPrompt={initialPrompt} />,
  radar: (initialPrompt) => <SourceRadar live={sourcingLive()} initialPrompt={initialPrompt} />,
  funnel: (initialPrompt) => <SourceFunnel live={sourcingLive()} initialPrompt={initialPrompt} />,
  attribution: (initialPrompt) => (
    <RadarAttribution live={sourcingLive()} initialPrompt={initialPrompt} />
  ),
  health: (initialPrompt) => <CronHealth live={sourcingLive()} initialPrompt={initialPrompt} />,
};

export const dynamic = "force-dynamic";

// Standalone module page. The hub layout provides the title + module switcher;
// this renders the module's view (shared with the in-session frame). A few hubs
// route a pseudo-module ("search" / "triage") to a conversational, Earn-driven
// surface instead of a table.
export default async function ModulePage({
  params,
  searchParams,
}: {
  params: { hub: string; module: string };
  searchParams?: { q?: string | string[] };
}) {
  const q = Array.isArray(searchParams?.q) ? searchParams?.q[0] : searchParams?.q;
  const initialPrompt = typeof q === "string" && q.trim() ? q : undefined;

  if (params.hub === "source") {
    const renderSourceModule = SOURCE_MODULES[params.module];
    if (renderSourceModule) return renderSourceModule(initialPrompt);
  }
  if (params.hub === "run" && params.module === "search") {
    return <RunSearch live={copilotLive()} initialPrompt={initialPrompt} />;
  }
  if (params.hub === "execute" && params.module === "search") {
    return <ExecuteSearch live={copilotLive()} initialPrompt={initialPrompt} />;
  }

  // Execute › Closing — LP Onboarding + Contract Status Board.
  if (params.hub === "execute" && params.module === "closing") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-8">
        <ClosingLive />
        <div className="border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  // Execute › Asset Management — Portfolio Health Dashboard.
  if (params.hub === "execute" && params.module === "asset_management") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <PortfolioHealthLive />
        <div className="mt-8 border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  // Build › Data Room — Workspace Document List.
  if (params.hub === "build" && params.module === "data_room") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <section>
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
            Knowledge Workspace
          </p>
          <WorkspaceDocumentListLive />
        </section>
        <div className="mt-8 border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  // Source › Network — relationship capital search, LinkedIn import, warm intros, syndicate circles.
  if (params.hub === "source" && params.module === "network") {
    const ctx = await getSessionContext();
    const supabase = createServerClient();

    // Count contacts for the org.
    let contactCount = 0;
    let circles: { id: string; name: string; description: string | null; memberCount: number; inviteCode: string; isActive: boolean; createdAt: string }[] = [];

    if (ctx?.orgId) {
      const [contactsRes, circlesRes, principalRes] = await Promise.all([
        supabase.from("network_contacts").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId),
        supabase.from("syndicate_circles").select("id, name, description, member_count, invite_code, is_active, created_at").eq("organization_id", ctx.orgId).eq("is_active", true).order("created_at", { ascending: false }),
        supabase.from("principals").select("full_name, title").eq("organization_id", ctx.orgId).limit(1).single(),
      ]);
      contactCount = contactsRes.count ?? 0;
      type CircleRow = { id: string; name: string; description: string | null; member_count: number | null; invite_code: string | null; is_active: boolean | null; created_at: string };
      circles = ((circlesRes.data ?? []) as CircleRow[]).map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        memberCount: c.member_count ?? 1,
        inviteCode: c.invite_code ?? "",
        isActive: c.is_active ?? true,
        createdAt: c.created_at,
      }));
      const principal = principalRes.data;
      const senderName = principal?.full_name ?? ctx.email ?? "You";
      const senderTitle = principal?.title ?? null;

      return (
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="mb-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted mb-1">Network OS</p>
            <p className="text-sm text-fg-muted">Search your relationship capital, request warm introductions, and pool your network with trusted syndicate partners.</p>
          </div>
          <NetworkModule
            senderName={senderName}
            senderTitle={senderTitle}
            initialContacts={contactCount}
            circles={circles}
          />
        </div>
      );
    }
  }

  // Source › People Lookups — live Apollo people search + email verification.
  if (params.hub === "source" && params.module === "people_lookups") {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 flex flex-col gap-8">
        <section>
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
            People Lookups
          </p>
          <PeopleLookupLive />
        </section>
        <div className="border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  // ── Data-dependent modules: LP pipeline, outreach, reporting, profile ─────
  // These pull from the DB via the capital map and GP scorecard helpers.
  const needsCapitalMap =
    (params.hub === "source" && (params.module === "lp_pipeline" || params.module === "outreach"));
  const needsGPScorecard = params.hub === "build" && params.module === "profile";
  const isReporting = params.hub === "execute" && params.module === "reporting";
  const isDealPipeline = params.hub === "source" && params.module === "deal_pipeline";

  if (needsCapitalMap || needsGPScorecard || isReporting || isDealPipeline) {
    const ctx = await getSessionContext();
    const supabase = createServerClient();

    // Source › LP Pipeline — GPLPMatch LP Discovery Engine.
    if (params.hub === "source" && params.module === "lp_pipeline") {
      const capitalMap = ctx?.orgId ? await buildCapitalMap(supabase) : [];
      const now = Date.now();
      const investors: LPMatch[] = capitalMap.map((entry) => ({
        id: entry.investor.id,
        name: entry.investor.name,
        type: entry.investor.investor_type,
        aum: entry.investor.aum,
        typical_check_min: entry.investor.typical_check_min,
        typical_check_max: entry.investor.typical_check_max,
        thesisFitScore: entry.thesisFit?.score ?? 0,
        warmth: entry.warmth,
        outreachPriority: entry.temperature === "committed" ? 3 : entry.temperature === "active" ? 1 : entry.temperature === "warm" ? 2 : 3,
        lastContact: entry.investor.updated_at
          ? `${Math.floor((now - new Date(entry.investor.updated_at).getTime()) / 86_400_000)}d ago`
          : null,
      }));
      return (
        <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col gap-8">
          <LPDiscoveryPanel investors={investors} />
          <div className="border-t border-line pt-8">
            <ModuleView hub={params.hub} module={params.module} />
          </div>
        </div>
      );
    }

    // Source › Outreach — GPLPMatch priority queue above OutreachStudio.
    if (params.hub === "source" && params.module === "outreach") {
      const capitalMap = ctx?.orgId ? await buildCapitalMap(supabase) : [];
      const now = Date.now();
      const items: OutreachItem[] = capitalMap
        .filter((e) => e.temperature !== "committed")
        .map((entry) => {
          const daysStale = entry.investor.updated_at
            ? Math.floor((now - new Date(entry.investor.updated_at).getTime()) / 86_400_000)
            : null;
          const priority: 1 | 2 | 3 =
            entry.temperature === "active" ? 1 : entry.temperature === "warm" ? 2 : 3;
          const topAction = entry.nextActions[0];
          return {
            id: entry.investor.id,
            investorName: entry.investor.name,
            priority,
            reason: entry.thesisFit?.reasons[0] ?? `${entry.temperature} relationship`,
            suggestedAction: topAction?.label ?? "Reach out",
            daysStale,
            thesisFitScore: entry.thesisFit?.score ?? null,
          };
        });
      return (
        <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col gap-8">
          <OutreachPriorityQueue items={items} />
          <div className="border-t border-line pt-8">
            <OutreachStudio live={sourcingLive()} />
          </div>
        </div>
      );
    }

    // Source › Deal Pipeline — PipelineRoad stage funnel (with real deal counts).
    if (params.hub === "source" && params.module === "deal_pipeline") {
      const dealsRes = ctx?.orgId
        ? await supabase.from("deals").select("id, stage, updated_at").eq("organization_id", ctx.orgId).is("archived_at", null)
        : { data: [] };
      const deals = dealsRes.data ?? [];
      const STAGE_ORDER = ["sourced", "screening", "diligence", "ic_review", "closing"] as const;
      const now = Date.now();
      const countByStage = new Map<string, { count: number; stale: string[] }>();
      for (const s of STAGE_ORDER) countByStage.set(s, { count: 0, stale: [] });
      for (const d of deals) {
        const bucket = countByStage.get(d.stage) ?? { count: 0, stale: [] };
        bucket.count++;
        const days = d.updated_at ? Math.floor((now - new Date(d.updated_at).getTime()) / 86_400_000) : 0;
        if (days >= 30) bucket.stale.push(d.id);
        countByStage.set(d.stage, bucket);
      }
      let prevCount: number | null = null;
      const stages = STAGE_ORDER.map((s) => {
        const { count, stale } = countByStage.get(s)!;
        const stage = { label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), count, convertedFrom: prevCount, avgDaysInStage: null, staleDealIds: stale };
        prevCount = count || null;
        return stage;
      });
      return (
        <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col gap-8">
          <DealStageFunnel stages={stages} />
          <div className="border-t border-line pt-8">
            <ModuleView hub={params.hub} module={params.module} />
          </div>
        </div>
      );
    }

    // Execute › Reporting — ForgeGlobal shareholder comms with static seed templates.
    if (params.hub === "execute" && params.module === "reporting") {
      const templates: CommTemplate[] = [
        { id: "q1", title: "Q1 Investor Update", type: "quarterly_update", lastSentDate: null, recipientCount: null, status: "draft" },
        { id: "q2", title: "Q2 Investor Update", type: "quarterly_update", lastSentDate: null, recipientCount: null, status: "draft" },
        { id: "cc1", title: "Capital Call Notice", type: "capital_call", lastSentDate: null, recipientCount: null, status: "draft" },
        { id: "ar1", title: "Annual Report", type: "annual_report", lastSentDate: null, recipientCount: null, status: "draft" },
        { id: "dn1", title: "Distribution Notice", type: "distribution_notice", lastSentDate: null, recipientCount: null, status: "draft" },
      ];
      return (
        <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col gap-8">
          <ShareholderComms templates={templates} />
          <div className="border-t border-line pt-8">
            <ModuleView hub={params.hub} module={params.module} />
          </div>
        </div>
      );
    }

    // Build › Profile — GPLPMatch GP Profile Scorecard auto-derived from org data.
    if (params.hub === "build" && params.module === "profile") {
      const scorecard = ctx?.orgId
        ? await computeGPScorecard(supabase, ctx.orgId)
        : { overallScore: 0, trackRecord: { score: 0, moicAvg: null, irrAvg: null, dealCount: 0 }, teamStrength: { score: 0, seniorYears: null, boardSeats: null }, thesisClarity: { score: 0, sectorsCount: 0, stagesCount: 0 }, networkReach: { score: 0, lpRelationships: 0, coInvestors: 0 }, operationalReadiness: { score: 0, hasAuditor: false, hasCounsel: false, hasAdmin: false } };
      return (
        <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col gap-8">
          <GPProfileScorecard scorecard={scorecard} />
          <div className="border-t border-line pt-8">
            <ModuleView hub={params.hub} module={params.module} />
          </div>
        </div>
      );
    }
  }

  // Build › Thesis — Deal Signal Feed + Sector Heatmap.
  // ThesisLive loads real signals + heatmap snapshots for the active org
  // (migration 0058), best-effort, and renders both sections.
  if (params.hub === "build" && params.module === "thesis") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-8">
        <ThesisLive />
        <div className="border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  return <ModuleView hub={params.hub} module={params.module} />;
}
