import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";
import { saveOrgProfile } from "@/app/(app)/build/profile/actions";
import { ThesisModule } from "@/components/build/ThesisModule";
import { BrandModule } from "@/components/build/BrandModule";
import { EntityModule } from "@/components/build/EntityModule";
import { TrackRecordModule } from "@/components/build/TrackRecordModule";
import { TeamModule } from "@/components/build/TeamModule";
import { MaterialsModule } from "@/components/build/MaterialsModule";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { ProfileForm } from "@/components/build/ProfileForm";
import { MandateStrip } from "@/components/build/MandateStrip";
import { RunRiskModule, RunStressTestModule, RunCommsModule } from "@/components/run/RunModules";
import { DocumentsModuleLive } from "@/components/run/DocumentsModuleLive";
import { AllocatorDirectoryLive } from "@/components/source/AllocatorDirectoryLive";
import { ServiceProviderDirectoryLive } from "@/components/source/ServiceProviderDirectoryLive";
import { PartnersLive } from "@/components/source/PartnersLiveServer";
import { DealPipelineLive } from "@/components/source/DealPipelineLive";
import { RunStrategyModule } from "@/components/run/RunStrategyModule";
import { RunDiligenceModule } from "@/components/run/RunDiligenceModule";
import { RunUnderwritingModule } from "@/components/run/RunUnderwritingModule";
import { BrainsModule } from "@/components/run/BrainsModule";
import { FundScoringModule } from "@/components/run/FundScoringModule";
import { DiligenceRoomModule } from "@/components/run/DiligenceRoomModule";
import { ContractReviewModule } from "@/components/run/ContractReviewModule";
import { MarketIntelModule } from "@/components/source/MarketIntelModule";
import {
  ExecuteReportingModule,
  ExecuteExitModule,
} from "@/components/execute/ExecuteModules";
import { ExecuteClosingModule } from "@/components/execute/ClosingModule";
import { ExecuteCapitalEventsModule } from "@/components/execute/CapitalEventsModule";
import { ExecuteAssetManagementModule } from "@/components/execute/AssetManagementModule";
import { ExecuteCapTableModule } from "@/components/execute/CapTableModule";
import { ExecuteOwnershipModule } from "@/components/execute/OwnershipModule";
import { ExecuteValuationsModule } from "@/components/execute/ValuationsModule";
import { ExecuteWaterfallModule } from "@/components/execute/WaterfallModule";
import { SigningModule } from "@/components/execute/SigningModule";
import { InvoicesModule } from "@/components/execute/InvoicesModule";
import { IssuanceModule } from "@/components/execute/IssuanceModule";
import { ShareholderCommsModule } from "@/components/execute/ShareholderCommsModule";
import { ModuleStatBar } from "@/components/ModuleStatBar";
import AddRowForm from "@/components/AddRowForm";
import ModuleTable from "@/components/ModuleTable";
import { ModuleDashboard } from "@/components/source/ModuleDashboard";
import { AiSourcingPanel } from "@/components/source/AiSourcingPanel";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";
import { summarizeModule } from "@/lib/source-stats";
import { sourceConfigFor, sourcingLive, sourcingEnrichmentEnabled } from "@/lib/source-ai";
import { AGENT_BY_KEY } from "@/lib/agents";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

// A module's data view, rendered identically whether the module is opened
// standalone (/[hub]/[module]) or inside a session frame
// (/session/[id]/[hub]/[module]). Modules backed by a table get a real list;
// the rest render a scaffold pointing back to Earn.
interface ListConfig {
  table: string;
  blurb: string;
  columns: { key: string; label: string }[];
  empty: string;
}
const LIST_MODULES: Record<string, ListConfig> = {
  "build/thesis": {
    table: "investment_theses",
    blurb: "What you invest in, where, and the returns you target.",
    columns: [
      { key: "title", label: "Thesis" },
      { key: "target_irr", label: "Target IRR" },
      { key: "is_active", label: "Active" },
    ],
    empty: "Define your investment thesis — or ask Earn to draft one.",
  },
  "build/track_record": {
    table: "track_records",
    blurb: "Prior deals and performance — the proof behind the thesis.",
    columns: [
      { key: "deal_name", label: "Deal" },
      { key: "vintage_year", label: "Vintage" },
      { key: "gross_irr", label: "Gross IRR" },
      { key: "gross_moic", label: "MOIC" },
    ],
    empty: "No track record yet.",
  },
  "source/lp_pipeline": {
    table: "investors",
    blurb: "Prospective and committed LPs, ranked by where they sit in your raise.",
    columns: [
      { key: "name", label: "Investor" },
      { key: "investor_type", label: "Type" },
      { key: "pipeline_stage", label: "Stage" },
    ],
    empty: "No LPs yet. A Source-hub workflow can add prospects here.",
  },
  "source/deal_pipeline": {
    table: "deals",
    blurb: "Every opportunity in flight, from first look to close.",
    columns: [
      { key: "name", label: "Deal" },
      { key: "stage", label: "Stage" },
      { key: "asset_class", label: "Asset class" },
    ],
    empty: "No deals yet. Source a deal in Earn to populate the pipeline.",
  },
  "source/partners": {
    table: "partners",
    blurb: "Co-GPs, operating partners, and advisors who extend your reach.",
    columns: [
      { key: "name", label: "Partner" },
      { key: "partner_type", label: "Type" },
      { key: "relationship", label: "Relationship" },
      { key: "status", label: "Status" },
    ],
    empty: "No partners yet. Add co-GPs, operating partners, and advisors here.",
  },
  "source/providers": {
    table: "service_providers",
    blurb: "Legal, audit, fund admin, and the rest of your service bench.",
    columns: [
      { key: "name", label: "Provider" },
      { key: "provider_type", label: "Type" },
      { key: "contact_name", label: "Contact" },
      { key: "status", label: "Status" },
    ],
    empty: "No service providers yet. Track legal, audit, and fund admin here.",
  },
  "source/debt": {
    table: "debt_facilities",
    blurb: "Credit lines, term loans, and mezzanine that lever your equity.",
    columns: [
      { key: "name", label: "Facility" },
      { key: "facility_type", label: "Type" },
      { key: "lender", label: "Lender" },
      { key: "commitment_amount", label: "Commitment" },
      { key: "status", label: "Status" },
    ],
    empty: "No debt facilities yet. Track credit lines, term loans, and mezz here.",
  },
  // The Run lists (diligence, underwriting) and every Execute module are
  // rendered by their own bespoke components above — no generic table here.
};

// Modules whose rows can be scoped to a session (first pass — the key demo
// path). When opened inside the session frame, the list filters to the session
// and new rows are tagged with it; opened standalone, the full org-wide list
// shows. Must match the columns added in migration 0022.
const SESSION_SCOPED_MODULES = new Set([
  "source/deal_pipeline",
  "source/lp_pipeline",
]);

export async function ModuleView({
  hub: hubKey,
  module: moduleKey,
  sessionId,
}: {
  hub: string;
  module: string;
  sessionId?: string;
}) {
  if (!HUB_KEYS.includes(hubKey as Hub)) notFound();
  const hub = HUB_BY_KEY[hubKey as Hub];
  const mod = hub.modules.find((m) => m.key === moduleKey);
  if (!mod) notFound();

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const key = `${hub.key}/${mod.key}`;
  const supabase = await createServerClient();

  // Carry the firm's mandate (Build › Thesis) into the Source hub. The Run hub
  // gets the richer command center (in the hub layout) instead, which already
  // carries the mandate alongside live conviction.
  const mandateStrip = hub.key === "source" ? <MandateStrip orgId={ctx.orgId} /> : null;

  // --- Run hub: derived evaluation modules + actionable lists --------------
  // Strategy, Risk, Stress Test, and Comms are synthesized from the live deal
  // working set (deals + underwriting + diligence). Diligence and Underwriting
  // are the org-wide lists, now editable in place (add + inline status) with a
  // deal picker — the same actions the deal war room uses.
  if (hub.key === "run") {
    if (mod.key === "strategy") return <RunStrategyModule orgId={ctx.orgId} />;
    if (mod.key === "risk") return <RunRiskModule orgId={ctx.orgId} />;
    if (mod.key === "stress_test") return <RunStressTestModule orgId={ctx.orgId} />;
    if (mod.key === "comms") return <RunCommsModule orgId={ctx.orgId} />;
    if (mod.key === "diligence")
      return (
        <>
          <RunDiligenceModule orgId={ctx.orgId} />
          <DiligenceRoomModule />
        </>
      );
    if (mod.key === "underwriting")
      return (
        <>
          <RunUnderwritingModule orgId={ctx.orgId} />
          <FundScoringModule />
        </>
      );
    if (mod.key === "documents")
      return (
        <>
          <DocumentsModuleLive />
          <ContractReviewModule />
        </>
      );
    if (mod.key === "brains") return <BrainsModule />;
  }

  // --- Execute hub: bespoke operating modules ------------------------------
  // Every Execute module has its own purpose-built view, synthesized from the
  // operating record: the close process, the capital ledger, the marked book,
  // the live report, and the realized record. Asset Management is session-scoped
  // (it carries the sessionId through to its scoped reads and add-form).
  if (hub.key === "execute") {
    if (mod.key === "closing") return <ExecuteClosingModule orgId={ctx.orgId} />;
    if (mod.key === "capital_events") return <ExecuteCapitalEventsModule orgId={ctx.orgId} />;
    if (mod.key === "asset_management")
      return <ExecuteAssetManagementModule orgId={ctx.orgId} sessionId={sessionId} />;
    if (mod.key === "valuations") return <ExecuteValuationsModule orgId={ctx.orgId} />;
    if (mod.key === "cap_table") return <ExecuteCapTableModule orgId={ctx.orgId} />;
    if (mod.key === "ownership") return <ExecuteOwnershipModule orgId={ctx.orgId} />;
    if (mod.key === "waterfall") return <ExecuteWaterfallModule orgId={ctx.orgId} />;
    if (mod.key === "reporting") return <ExecuteReportingModule orgId={ctx.orgId} />;
    if (mod.key === "exit") return <ExecuteExitModule orgId={ctx.orgId} />;
    if (mod.key === "signing") return <SigningModule />;
    if (mod.key === "billing") return <InvoicesModule />;
    if (mod.key === "issuance") return <IssuanceModule />;
    if (mod.key === "comms") return <ShareholderCommsModule />;
  }

  // --- Build hub: dedicated editable modules -------------------------------
  if (hub.key === "build") {
    if (mod.key === "thesis") return <ThesisModule />;
    if (mod.key === "brand") return <BrandModule />;
    if (mod.key === "entity") return <EntityModule />;
    if (mod.key === "track_record") return <TrackRecordModule />;
    if (mod.key === "team") return <TeamModule />;
    if (mod.key === "data_room") return <MaterialsModule />;
    // profile falls through to the editable org form below
  }

  // --- Build › Profile: editable org identity ------------------------------
  if (key === "build/profile") {
    const { data: org } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", ctx.orgId)
      .maybeSingle();
    return (
      <div>
        <ModuleHeader
          title="Profile"
          blurb="Your firm's identity and the basics every other module builds on."
          module="profile"
        />
        <ProfileForm
          action={saveOrgProfile}
          values={{
            name: org?.name ?? "",
            legal_name: org?.legal_name ?? "",
            entity_type: org?.entity_type ?? "",
            tagline: org?.tagline ?? "",
            logo_url: org?.logo_url ?? "",
            jurisdiction: org?.jurisdiction ?? "",
            website: org?.website ?? "",
            description: org?.description ?? "",
            hq_location: org?.hq_location ?? "",
            aum_range: org?.aum_range ?? "",
            fund_count: org?.fund_count != null ? String(org.fund_count) : "",
            primary_strategy: org?.primary_strategy ?? "",
            operator_role: org?.operator_role ?? "",
            brand_voice: org?.brand_voice ?? "",
          }}
        />
      </div>
    );
  }

  // --- Source hub: enriched directory views ---------------------------------
  // Network renders the unified deal/investor intelligence directory (a native,
  // open take on a PitchBook-style market view) synthesized from live records.
  if (hub.key === "source" && mod.key === "network") {
    return (
      <div>
        {mandateStrip}
        <MarketIntelModule />
      </div>
    );
  }

  // LP pipeline and Providers render bespoke relationship-aware directories
  // instead of the generic table, while retaining AI sourcing and add-row forms.
  if (hub.key === "source" && mod.key === "lp_pipeline") {
    const aiCfg = sessionId ? null : sourceConfigFor(key);
    return (
      <div>
        {mandateStrip}
        {aiCfg ? (
          <AiSourcingPanel
            hub={hub.key}
            module={mod.key}
            entities={aiCfg.entities}
            agentName={AGENT_BY_KEY[aiCfg.agent]?.name ?? "Sourcing"}
            live={sourcingLive()}
            webEnrichment={sourcingEnrichmentEnabled()}
          />
        ) : null}
        <AddRowForm
          hub={hub.key}
          module={mod.key}
          fields={ADD_ROW_CONFIGS[key]?.fields ?? []}
        />
        <AllocatorDirectoryLive />
      </div>
    );
  }

  if (hub.key === "source" && mod.key === "providers") {
    const aiCfg = sessionId ? null : sourceConfigFor(key);
    return (
      <div>
        {mandateStrip}
        {aiCfg ? (
          <AiSourcingPanel
            hub={hub.key}
            module={mod.key}
            entities={aiCfg.entities}
            agentName={AGENT_BY_KEY[aiCfg.agent]?.name ?? "Sourcing"}
            live={sourcingLive()}
            webEnrichment={sourcingEnrichmentEnabled()}
          />
        ) : null}
        <AddRowForm
          hub={hub.key}
          module={mod.key}
          fields={ADD_ROW_CONFIGS[key]?.fields ?? []}
        />
        <ServiceProviderDirectoryLive />
      </div>
    );
  }

  if (hub.key === "source" && mod.key === "partners") {
    const aiCfg = sessionId ? null : sourceConfigFor(key);
    return (
      <div>
        {mandateStrip}
        {aiCfg ? (
          <AiSourcingPanel
            hub={hub.key}
            module={mod.key}
            entities={aiCfg.entities}
            agentName={AGENT_BY_KEY[aiCfg.agent]?.name ?? "Sourcing"}
            live={sourcingLive()}
            webEnrichment={sourcingEnrichmentEnabled()}
          />
        ) : null}
        <AddRowForm
          hub={hub.key}
          module={mod.key}
          fields={ADD_ROW_CONFIGS[key]?.fields ?? []}
        />
        <PartnersLive />
      </div>
    );
  }

  if (hub.key === "source" && mod.key === "deal_pipeline") {
    const aiCfg = sessionId ? null : sourceConfigFor(key);
    return (
      <div>
        {mandateStrip}
        {aiCfg ? (
          <AiSourcingPanel
            hub={hub.key}
            module={mod.key}
            entities={aiCfg.entities}
            agentName={AGENT_BY_KEY[aiCfg.agent]?.name ?? "Sourcing"}
            live={sourcingLive()}
            webEnrichment={sourcingEnrichmentEnabled()}
          />
        ) : null}
        <AddRowForm
          hub={hub.key}
          module={mod.key}
          fields={ADD_ROW_CONFIGS[key]?.fields ?? []}
        />
        <DealPipelineLive />
      </div>
    );
  }

  // --- Table-backed modules ------------------------------------------------
  const cfg = LIST_MODULES[key];
  if (cfg) {
    // Inside the session frame, a session-scoped module shows only this
    // session's rows; standalone it shows the full org-wide list.
    const scoped = sessionId && SESSION_SCOPED_MODULES.has(key);
    // Live rows drive the list + dashboards; archived rows are fetched
    // separately and only surfaced behind the table's "Show archived" toggle.
    let liveQ = supabase
      .from(cfg.table as "investors")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    let archQ = supabase
      .from(cfg.table as "investors")
      .select("*")
      .not("archived_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (scoped) {
      liveQ = liveQ.eq("session_id", sessionId);
      archQ = archQ.eq("session_id", sessionId);
    }
    const [liveRes, archRes] = await Promise.all([liveQ, archQ]);
    const rows = (liveRes.data ?? []) as unknown as Record<string, unknown>[];
    const archivedRows = (archRes.data ?? []) as unknown as Record<string, unknown>[];
    const addConfig = ADD_ROW_CONFIGS[key];

    // Source modules read as live dashboards: a KPI strip + stage funnel
    // derived from the rows already loaded. Every other list module gets the
    // generic momentum strip (volume, recent adds, last activity).
    const summary = summarizeModule(key, rows);

    // AI Sourcing surface — only on the standalone hub view (not the session
    // frame, whose rows are session-scoped). Generate/score/act against the
    // mandate, with the operator's gate on every outbound move.
    const aiCfg = sessionId ? null : sourceConfigFor(key);

    let statBar = null;
    if (!summary) {
      // Momentum: accurate total + last-7-day counts, scoped the same way as
      // the list. Cheap head-only count queries, run alongside the page load.
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      let totalQ = supabase
        .from(cfg.table as "investors")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null);
      let weekQ = supabase
        .from(cfg.table as "investors")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null)
        .gte("created_at", weekAgo);
      if (scoped) {
        totalQ = totalQ.eq("session_id", sessionId);
        weekQ = weekQ.eq("session_id", sessionId);
      }
      const [{ count: total }, { count: thisWeek }] = await Promise.all([totalQ, weekQ]);
      const lastUpdated = (rows[0]?.created_at as string | undefined) ?? null;
      statBar = (
        <ModuleStatBar total={total ?? rows.length} thisWeek={thisWeek ?? 0} lastUpdated={lastUpdated} />
      );
    }

    return (
      <div>
        {mandateStrip}
        <ModuleHeader title={mod.label} blurb={cfg.blurb} />
        {aiCfg ? (
          <AiSourcingPanel
            hub={hub.key}
            module={mod.key}
            entities={aiCfg.entities}
            agentName={AGENT_BY_KEY[aiCfg.agent]?.name ?? "Sourcing"}
            live={sourcingLive()}
            webEnrichment={sourcingEnrichmentEnabled()}
          />
        ) : null}
        {summary ? <ModuleDashboard summary={summary} empty={rows.length === 0} /> : statBar}
        {addConfig ? (
          <AddRowForm
            hub={hub.key}
            module={mod.key}
            fields={addConfig.fields}
            sessionId={scoped ? sessionId : undefined}
          />
        ) : null}
        {rows.length === 0 && archivedRows.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
            <span
              aria-hidden
              className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/5 font-mono text-sm text-gold-400"
            >
              +
            </span>
            <p className="max-w-sm text-sm text-fg-secondary">{cfg.empty}</p>
            <Link
              href="/workspace"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
            >
              ✶ Open Earn
            </Link>
          </div>
        ) : (
          <ModuleTable
            columns={cfg.columns}
            rows={rows}
            archivedRows={archivedRows}
            hub={hub.key}
            module={mod.key}
            table={cfg.table}
          />
        )}
      </div>
    );
  }

  // --- Scaffold for not-yet-built modules ----------------------------------
  return (
    <div>
      {mandateStrip}
      <ModuleHeader title={mod.label} blurb={`Part of the ${hub.label} hub.`} />
      <div className="flex flex-col items-center rounded-2xl border border-line bg-surface-1 px-8 py-14 text-center">
        <span className="mb-1 font-mono text-[10px] uppercase tracking-[0.3em] text-fg-muted">
          Coming soon
        </span>
        <h3 className="mt-2 font-display text-xl font-semibold text-fg-primary">
          {mod.label}
        </h3>
        <p className="max-w-sm mt-3 text-sm leading-6 text-fg-secondary">
          This module is on the roadmap. Use Earn to handle this work now — your
          session records will appear here once the module ships.
        </p>
        <Link
          href="/workspace"
          className="mt-6 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
        >
          ✶ Handle with Earn now
        </Link>
      </div>
    </div>
  );
}
