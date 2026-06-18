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
import AddRowForm from "@/components/AddRowForm";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

// A module's data view, rendered identically whether the module is opened
// standalone (/[hub]/[module]) or inside a session frame
// (/session/[id]/[hub]/[module]). Modules backed by a table get a real list;
// the rest render a scaffold pointing back to Earn.
interface ListConfig {
  table: string;
  columns: { key: string; label: string }[];
  empty: string;
}
const LIST_MODULES: Record<string, ListConfig> = {
  "build/thesis": {
    table: "investment_theses",
    columns: [
      { key: "title", label: "Thesis" },
      { key: "target_irr", label: "Target IRR" },
      { key: "is_active", label: "Active" },
    ],
    empty: "Define your investment thesis — or ask Earn to draft one.",
  },
  "build/track_record": {
    table: "track_records",
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
    columns: [
      { key: "name", label: "Investor" },
      { key: "investor_type", label: "Type" },
      { key: "pipeline_stage", label: "Stage" },
    ],
    empty: "No LPs yet. A Source-hub workflow can add prospects here.",
  },
  "source/deal_pipeline": {
    table: "deals",
    columns: [
      { key: "name", label: "Deal" },
      { key: "stage", label: "Stage" },
      { key: "asset_class", label: "Asset class" },
    ],
    empty: "No deals yet. Source a deal in Earn to populate the pipeline.",
  },
  "run/underwriting": {
    table: "underwritings",
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
    columns: [
      { key: "event_type", label: "Type" },
      { key: "amount", label: "Amount" },
      { key: "effective_date", label: "Effective" },
    ],
    empty: "No capital events yet.",
  },
  "execute/asset_management": {
    table: "assets",
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

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return "—";
  return String(value);
}

export async function ModuleView({ hub: hubKey, module: moduleKey }: { hub: string; module: string }) {
  if (!HUB_KEYS.includes(hubKey as Hub)) notFound();
  const hub = HUB_BY_KEY[hubKey as Hub];
  const mod = hub.modules.find((m) => m.key === moduleKey);
  if (!mod) notFound();

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const key = `${hub.key}/${mod.key}`;
  const supabase = createServerClient();

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
    const { data } = await supabase
      .from(cfg.table as "investors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const addConfig = ADD_ROW_CONFIGS[key];
    return (
      <div>
        {addConfig ? <AddRowForm hub={hub.key} module={mod.key} fields={addConfig.fields} /> : null}
        {rows.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface-1 p-8 text-center">
            <p className="text-sm text-fg-secondary">{cfg.empty}</p>
            <Link
              href="/workspace"
              className="mt-3 inline-block font-mono text-[11px] uppercase tracking-wider text-gold-400 hover:underline"
            >
              Open Earn →
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left">
                  {cfg.columns.map((c) => (
                    <th
                      key={c.key}
                      className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-line/60 bg-surface-1">
                    {cfg.columns.map((c) => (
                      <td key={c.key} className="px-4 py-2.5 text-fg-secondary">
                        {cell(row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // --- Scaffold for not-yet-built modules ----------------------------------
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-8">
      <p className="text-sm text-fg-secondary">
        The <span className="text-fg-primary">{mod.label}</span> module lives in the {hub.label} hub.
        It isn&apos;t wired up yet — describe the work in Earn and the agents will handle it here.
      </p>
      <Link
        href="/workspace"
        className="mt-4 inline-block rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300"
      >
        Open Earn
      </Link>
    </div>
  );
}
