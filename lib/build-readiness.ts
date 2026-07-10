// Build-hub readiness: turns the foundation a firm has entered (profile,
// thesis, brand, entity, track record, team) into a single momentum signal.
// Each module scores 0–100 from a set of weighted checks; the hub rolls those
// up into an overall score, an unlock track, and the single next-best action.
// This is what makes the Build hub *compound* — every field added moves a
// visible meter and surfaces the next highest-leverage step.
import { createServerClient } from "@/lib/supabase/server";
import { summarizeDataRoom } from "@/lib/data-room";
import type {
  Organization,
  InvestmentThesis,
  Entity,
  TrackRecord,
  OrganizationMember,
  Principal,
} from "@/lib/supabase/database.types";

export interface ReadinessCheck {
  label: string;
  done: boolean;
  weight: number;
  /** Imperative phrasing used when this check becomes the next-best action. */
  action: string;
}

export type ModuleStatus = "empty" | "started" | "complete";

export interface ModuleReadiness {
  key: string;
  label: string;
  href: string;
  score: number; // 0–100, weighted
  status: ModuleStatus;
  doneCount: number;
  total: number;
  checks: ReadinessCheck[];
}

export interface ReadinessStage {
  key: string;
  label: string;
  threshold: number; // overall score required to unlock
  blurb: string;
  unlocked: boolean;
  current: boolean;
}

export interface NextAction {
  moduleKey: string;
  moduleLabel: string;
  label: string;
  href: string;
}

/** Compact data-room coverage, surfaced in command-center snapshots. */
export interface DataRoomDigest {
  score: number;
  readyCount: number;
  total: number;
  /** Highest-leverage missing section's label, or null when fully covered. */
  topMissing: string | null;
}

export interface BuildReadiness {
  overall: number;
  stage: ReadinessStage;
  stages: ReadinessStage[];
  modules: ModuleReadiness[];
  statuses: Record<string, ModuleStatus>;
  nextAction: NextAction | null;
  /** Coverage of the Materials & Data Room module, for glanceable summaries. */
  dataRoom: DataRoomDigest;
}

const has = (v: unknown): boolean =>
  v !== null && v !== undefined && (typeof v === "string" ? v.trim().length > 0 : true);

// Profile, Thesis, Brand, and Entity are unified into the single Firm Identity
// page (/build/profile); their readiness chips deep-link to that page's section
// anchors. Every other module keeps its own /build/<key> route.
const IDENTITY_HREF: Record<string, string> = {
  profile: "/build/profile#identity",
  thesis: "/build/profile#thesis",
  brand: "/build/profile#brand",
  entity: "/build/profile#entity",
};

function scoreModule(
  key: string,
  label: string,
  checks: ReadinessCheck[],
): ModuleReadiness {
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + (c.done ? c.weight : 0), 0);
  const score = total === 0 ? 0 : Math.round((earned / total) * 100);
  const doneCount = checks.filter((c) => c.done).length;
  const status: ModuleStatus = score === 0 ? "empty" : score === 100 ? "complete" : "started";
  const href = IDENTITY_HREF[key] ?? `/build/${key}`;
  return { key, label, href, score, status, doneCount, total: checks.length, checks };
}

/** Roll several module statuses into one (for the unified Firm Identity tab). */
export function combineStatuses(statuses: ModuleStatus[]): ModuleStatus {
  if (statuses.every((s) => s === "complete")) return "complete";
  if (statuses.every((s) => s === "empty")) return "empty";
  return "started";
}

/** Module keys unified under the Build hub's "Firm Identity" tab (/build/profile). */
export const IDENTITY_MODULE_KEYS = ["profile", "thesis", "brand", "entity"] as const;

const STAGE_DEFS: Omit<ReadinessStage, "unlocked" | "current">[] = [
  { key: "setup", label: "Setting Up", threshold: 0, blurb: "Lay the foundation." },
  {
    key: "investor_ready",
    label: "Investor-Ready",
    threshold: 50,
    blurb: "Thesis, brand, and track record tell a coherent story.",
  },
  {
    key: "fundraising_ready",
    label: "Fundraising-Ready",
    threshold: 85,
    blurb: "The full foundation an LP expects before a first meeting.",
  },
];

/**
 * Compute Build-hub readiness for an org. Pulls the foundation tables in
 * parallel and returns per-module scores plus the rolled-up hub state.
 */
export async function getBuildReadiness(orgId: string): Promise<BuildReadiness> {
  const supabase = await createServerClient();

  const [orgRes, thesesRes, entitiesRes, recordsRes, membersRes, docsRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase.from("investment_theses").select("*").eq("organization_id", orgId),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("track_records").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
    supabase.from("documents").select("doc_type").eq("organization_id", orgId),
  ]);

  const org = (orgRes.data ?? null) as Organization | null;
  const theses = (thesesRes.data ?? []) as InvestmentThesis[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const members = (membersRes.data ?? []) as OrganizationMember[];
  const docCounts: Record<string, number> = {};
  for (const d of (docsRes.data ?? []) as { doc_type: string | null }[]) {
    const k = d.doc_type ?? "other";
    docCounts[k] = (docCounts[k] ?? 0) + 1;
  }

  // Resolve member titles for the Team checks (best-effort; failure → no titles).
  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }

  return computeBuildReadiness({ org, theses, entities, records, members, principals, docCounts });
}

export interface BuildReadinessInput {
  org: Organization | null;
  theses: InvestmentThesis[];
  entities: Entity[];
  records: TrackRecord[];
  members: OrganizationMember[];
  principals: Principal[];
  /** Per-section (doc_type) document counts, for scoring the data room. */
  docCounts?: Record<string, number>;
}

/**
 * Pure readiness computation over already-fetched foundation data. Callers that
 * have loaded these tables for another purpose (e.g. the Materials & Data Room)
 * can reuse them here instead of re-querying via getBuildReadiness.
 */
export function computeBuildReadiness(input: BuildReadinessInput): BuildReadiness {
  const { org, theses, entities, records, members, principals } = input;
  const titleById = new Map(principals.map((p) => [p.id, p.title]));

  const thesis = theses.find((t) => t.is_active) ?? theses[0] ?? null;

  const profile = scoreModule("profile", "Profile", [
    { label: "Legal name", done: has(org?.legal_name), weight: 1, action: "Add your firm's legal name" },
    { label: "Entity type", done: has(org?.entity_type), weight: 1, action: "Set your entity type" },
    { label: "Jurisdiction", done: has(org?.jurisdiction), weight: 1, action: "Set your jurisdiction" },
    { label: "Website", done: has(org?.website), weight: 1, action: "Add your website" },
    { label: "Description", done: has(org?.description), weight: 2, action: "Write a short firm description" },
  ]);

  const thesisMod = scoreModule("thesis", "Thesis", [
    { label: "A thesis exists", done: !!thesis, weight: 3, action: "Define your investment thesis" },
    { label: "Summary", done: has(thesis?.summary), weight: 2, action: "Summarize the thesis in a paragraph" },
    { label: "Asset classes", done: !!thesis?.asset_classes?.length, weight: 1, action: "List your target asset classes" },
    { label: "Geographies", done: !!thesis?.geographies?.length, weight: 1, action: "List your target geographies" },
    {
      label: "Return targets",
      done: has(thesis?.target_irr) || has(thesis?.target_moic),
      weight: 1,
      action: "Set target IRR / MOIC",
    },
    {
      label: "Check size",
      done: has(thesis?.check_size_min) || has(thesis?.check_size_max),
      weight: 1,
      action: "Define your check-size range",
    },
  ]);

  const brand = scoreModule("brand", "Brand", [
    { label: "Tagline", done: has(org?.tagline), weight: 2, action: "Write a tagline" },
    { label: "Primary color", done: has(org?.brand_color), weight: 1, action: "Pick a primary brand color" },
    { label: "Logo", done: has(org?.logo_url), weight: 1, action: "Add a logo" },
    { label: "Palette", done: (org?.brand_palette?.length ?? 0) >= 2, weight: 1, action: "Build out your color palette" },
    { label: "Voice", done: has(org?.brand_voice), weight: 1, action: "Describe your brand voice" },
  ]);

  const gpKinds = new Set(["gp", "management_co"]);
  const fundKinds = new Set(["fund", "spv", "holdco"]);
  const entity = scoreModule("entity", "Entity", [
    { label: "An entity exists", done: entities.length > 0, weight: 2, action: "Add your first legal entity" },
    {
      label: "GP / management co.",
      done: entities.some((e) => gpKinds.has(e.entity_type)),
      weight: 1,
      action: "Add your GP or management company",
    },
    {
      label: "Fund / SPV",
      done: entities.some((e) => fundKinds.has(e.entity_type)),
      weight: 1,
      action: "Add a fund, SPV, or holdco",
    },
  ]);

  const trackRecord = scoreModule("track_record", "Track Record", [
    { label: "A deal exists", done: records.length > 0, weight: 3, action: "Add a prior deal to your track record" },
    {
      label: "Returns captured",
      done: records.some((r) => has(r.gross_irr) || has(r.gross_moic)),
      weight: 2,
      action: "Capture IRR / MOIC on a deal",
    },
    {
      label: "A realized deal",
      done: records.some((r) => r.is_realized),
      weight: 1,
      action: "Mark a realized deal to prove exits",
    },
  ]);

  const titledMembers = members.filter((m) => has(titleById.get(m.principal_id)));
  const team = scoreModule("team", "Team", [
    { label: "A member exists", done: members.length > 0, weight: 1, action: "Add a team member" },
    { label: "Two or more members", done: members.length >= 2, weight: 1, action: "Invite the rest of the team" },
    {
      label: "Members have titles",
      done: members.length > 0 && titledMembers.length === members.length,
      weight: 1,
      action: "Add titles to every team member",
    },
  ]);

  // Materials & Data Room — the assembly of everything an allocator's ODD/IDD
  // team expects. Build-backed sections (overview, thesis, track record, team,
  // legal) are satisfied by the foundation above; the remaining sections (fund
  // terms, financials, compliance, marketing collateral…) are earned by adding
  // real documents. Scored off the same weighted coverage the Materials module
  // shows, so the meter here and the checklist there always agree.
  const foundationStatuses = Object.fromEntries(
    [profile, thesisMod, brand, entity, trackRecord, team].map((m) => [m.key, m.status]),
  ) as Record<string, ModuleStatus>;
  const dataRoomSummary = summarizeDataRoom(foundationStatuses, input.docCounts ?? {});
  const dataRoom = scoreModule(
    "data_room",
    "Materials & Data Room",
    // Heaviest sections first so, once the foundation is complete, the
    // next-best action points at the highest-leverage missing material
    // (fund terms, financials…) rather than walking the taxonomy in order.
    [...dataRoomSummary.items]
      .sort((a, b) => b.weight - a.weight)
      .map((i) => ({
        label: i.label,
        done: i.ready,
        weight: i.weight,
        action: i.suggestion,
      })),
  );

  const modules = [profile, thesisMod, brand, entity, trackRecord, team, dataRoom];
  const overall = Math.round(modules.reduce((s, m) => s + m.score, 0) / modules.length);

  const stages: ReadinessStage[] = STAGE_DEFS.map((s) => ({
    ...s,
    unlocked: overall >= s.threshold,
    current: false,
  }));
  const currentStage = [...stages].reverse().find((s) => s.unlocked) ?? stages[0];
  currentStage.current = true;

  // Next-best action: first incomplete check, walking the foundation modules in
  // hub order so they're built front-to-back (profile → thesis → … → team).
  // Only once the foundation is complete does the next step point at the data
  // room — and then at the single highest-leverage missing section, deep-linked
  // straight to that section's builder in the Materials module.
  const foundationModules = [profile, thesisMod, brand, entity, trackRecord, team];
  let nextAction: NextAction | null = null;
  for (const m of foundationModules) {
    const pending = m.checks.find((c) => !c.done);
    if (pending) {
      nextAction = { moduleKey: m.key, moduleLabel: m.label, label: pending.action, href: m.href };
      break;
    }
  }
  const topGap = dataRoomSummary.suggestions[0] ?? null;
  if (!nextAction && topGap) {
    nextAction = {
      moduleKey: "data_room",
      moduleLabel: "Materials & Data Room",
      label: topGap.suggestion,
      href: `/build/data_room#section-${topGap.key}`,
    };
  }

  const statuses = Object.fromEntries(modules.map((m) => [m.key, m.status])) as Record<
    string,
    ModuleStatus
  >;

  const dataRoomDigest: DataRoomDigest = {
    score: dataRoom.score,
    readyCount: dataRoomSummary.readyCount,
    total: dataRoomSummary.total,
    topMissing: topGap?.label ?? null,
  };

  return {
    overall,
    stage: currentStage,
    stages,
    modules,
    statuses,
    nextAction,
    dataRoom: dataRoomDigest,
  };
}

export interface Mandate {
  thesisTitle: string;
  assetClasses: string[];
  geographies: string[];
  checkSizeMin: number | null;
  checkSizeMax: number | null;
  targetIrr: number | null;
  targetMoic: number | null;
}

/**
 * The firm's active mandate, derived from the Build › Thesis. Downstream hubs
 * (Source, Run) read this so the foundation entered once visibly frames every
 * pipeline and evaluation — Build compounding outward across the OS.
 */
export async function getMandate(orgId: string): Promise<Mandate | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("investment_theses")
    .select("*")
    .eq("organization_id", orgId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const t = data as InvestmentThesis | null;
  if (!t) return null;
  return {
    thesisTitle: t.title,
    assetClasses: t.asset_classes ?? [],
    geographies: t.geographies ?? [],
    checkSizeMin: t.check_size_min,
    checkSizeMax: t.check_size_max,
    targetIrr: t.target_irr,
    targetMoic: t.target_moic,
  };
}
