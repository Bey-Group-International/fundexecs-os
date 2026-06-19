import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";
import { updateProfile } from "@/app/(app)/[hub]/[module]/actions";
import { ThesisModule } from "@/components/build/ThesisModule";
import { BrandModule } from "@/components/build/BrandModule";
import { EntityModule } from "@/components/build/EntityModule";
import { TrackRecordModule } from "@/components/build/TrackRecordModule";
import { TeamModule } from "@/components/build/TeamModule";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { MandateStrip } from "@/components/build/MandateStrip";
import { ModuleStatBar } from "@/components/ModuleStatBar";
import AddRowForm from "@/components/AddRowForm";
import ModuleTable from "@/components/ModuleTable";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";

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
  "run/underwriting": {
    table: "underwritings",
    blurb: "Base, bull, and bear cases behind every investment decision.",
    columns: [
      { key: "name", label: "Model" },
      { key: "scenario", label: "Scenario" },
      { key: "projected_irr", label: "IRR" },
      { key: "projected_moic", label: "MOIC" },
    ],
    empty: "No underwriting models yet.",
  },
  "run/diligence": {
    table: "diligence_items",
    blurb: "Open questions and findings that gate conviction.",
    columns: [
      { key: "title", label: "Item" },
      { key: "category", label: "Category" },
      { key: "status", label: "Status" },
      { key: "risk_severity", label: "Risk" },
    ],
    empty: "No diligence items yet.",
  },
  "execute/capital_events": {
    table: "capital_events",
    blurb: "Calls, distributions, and every flow of capital post-close.",
    columns: [
      { key: "event_type", label: "Type" },
      { key: "amount", label: "Amount" },
      { key: "effective_date", label: "Effective" },
    ],
    empty: "No capital events yet.",
  },
  "execute/asset_management": {
    table: "assets",
    blurb: "Portfolio holdings and their current marks.",
    columns: [
      { key: "name", label: "Asset" },
      { key: "asset_type", label: "Type" },
      { key: "current_value", label: "Value" },
    ],
    empty: "No portfolio assets yet.",
  },
};

const PROFILE_FIELDS = [
  { name: "name", label: "Organization name" },
  { name: "legal_name", label: "Legal name" },
  { name: "entity_type", label: "Entity type" },
  { name: "jurisdiction", label: "Jurisdiction" },
  { name: "website", label: "Website" },
];

// Modules whose rows can be scoped to a session (first pass — the key demo
// path). When opened inside the session frame, the list filters to the session
// and new rows are tagged with it; opened standalone, the full org-wide list
// shows. Must match the columns added in migration 0022.
const SESSION_SCOPED_MODULES = new Set([
  "source/deal_pipeline",
  "source/lp_pipeline",
  "execute/asset_management",
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
  const supabase = createServerClient();

  // Carry the firm's mandate (Build › Thesis) into the hubs that act on it.
  const mandateStrip =
    hub.key === "source" || hub.key === "run" ? <MandateStrip orgId={ctx.orgId} /> : null;

  // --- Build hub: dedicated editable modules -------------------------------
  if (hub.key === "build") {
    if (mod.key === "thesis") return <ThesisModule />;
    if (mod.key === "brand") return <BrandModule />;
    if (mod.key === "entity") return <EntityModule />;
    if (mod.key === "track_record") return <TrackRecordModule />;
    if (mod.key === "team") return <TeamModule />;
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
        <form action={updateProfile} className="flex max-w-xl flex-col gap-4">
        {PROFILE_FIELDS.map((f) => (
          <label key={f.name} className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-secondary">{f.label}</span>
            <input
              name={f.name}
              defaultValue={(org?.[f.name as keyof typeof org] as string) ?? ""}
              className="rounded-md border border-line bg-surface-1 px-3 py-2 outline-none focus:border-gold-500"
            />
          </label>
        ))}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Description</span>
          <textarea
            name="description"
            rows={3}
            defaultValue={org?.description ?? ""}
            className="rounded-md border border-line bg-surface-1 px-3 py-2 outline-none focus:border-gold-500"
          />
        </label>
        <button className="self-start rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
          Save profile
        </button>
        </form>
      </div>
    );
  }

  // --- Table-backed modules ------------------------------------------------
  const cfg = LIST_MODULES[key];
  if (cfg) {
    // Inside the session frame, a session-scoped module shows only this
    // session's rows; standalone it shows the full org-wide list.
    const scoped = sessionId && SESSION_SCOPED_MODULES.has(key);
    let query = supabase
      .from(cfg.table as "investors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (scoped) query = query.eq("session_id", sessionId);
    const { data } = await query;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];

    // Momentum: accurate total + last-7-day counts, scoped the same way as the
    // list. Cheap head-only count queries, run alongside the page load.
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    let totalQ = supabase.from(cfg.table as "investors").select("*", { count: "exact", head: true });
    let weekQ = supabase
      .from(cfg.table as "investors")
      .select("*", { count: "exact", head: true })
      .gte("created_at", weekAgo);
    if (scoped) {
      totalQ = totalQ.eq("session_id", sessionId);
      weekQ = weekQ.eq("session_id", sessionId);
    }
    const [{ count: total }, { count: thisWeek }] = await Promise.all([totalQ, weekQ]);
    const lastUpdated = (rows[0]?.created_at as string | undefined) ?? null;

    const addConfig = ADD_ROW_CONFIGS[key];
    return (
      <div>
        {mandateStrip}
        <ModuleHeader title={mod.label} blurb={cfg.blurb} />
        <ModuleStatBar total={total ?? rows.length} thisWeek={thisWeek ?? 0} lastUpdated={lastUpdated} />
        {addConfig ? (
          <AddRowForm
            hub={hub.key}
            module={mod.key}
            fields={addConfig.fields}
            sessionId={scoped ? sessionId : undefined}
          />
        ) : null}
        {rows.length === 0 ? (
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
          <ModuleTable columns={cfg.columns} rows={rows} />
        )}
      </div>
    );
  }

  // --- Scaffold for not-yet-built modules ----------------------------------
  return (
    <div>
      {mandateStrip}
      <ModuleHeader title={mod.label} blurb={`Part of the ${hub.label} hub.`} />
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
        <span
          aria-hidden
          className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/5 font-mono text-sm text-gold-400"
        >
          ✶
        </span>
        <p className="max-w-sm text-sm text-fg-secondary">
          The <span className="text-fg-primary">{mod.label}</span> module isn&apos;t wired up yet —
          describe the work in Earn and the agents will handle it here.
        </p>
        <Link
          href="/workspace"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
        >
          ✶ Open Earn
        </Link>
      </div>
    </div>
  );
}
