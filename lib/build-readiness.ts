// Build-hub readiness: turns the foundation a firm has entered (profile,
// thesis, brand, entity, track record, team) into a single momentum signal.
// Each module scores 0–100 from a set of weighted checks; the hub rolls those
// up into an overall score, an unlock track, and the single next-best action.
// This is what makes the Build hub *compound* — every field added moves a
// visible meter and surfaces the next highest-leverage step.
import { createServerClient } from "@/lib/supabase/server";
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

export interface BuildReadiness {
  overall: number;
  stage: ReadinessStage;
  stages: ReadinessStage[];
  modules: ModuleReadiness[];
  statuses: Record<string, ModuleStatus>;
  nextAction: NextAction | null;
}

const has = (v: unknown): boolean =>
  v !== null && v !== undefined && (typeof v === "string" ? v.trim().length > 0 : true);

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
  return { key, label, href: `/build/${key}`, score, status, doneCount, total: checks.length, checks };
}

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
  const supabase = createServerClient();

  const [orgRes, thesesRes, entitiesRes, recordsRes, membersRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase.from("investment_theses").select("*").eq("organization_id", orgId),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("track_records").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
  ]);

  const org = (orgRes.data ?? null) as Organization | null;
  const theses = (thesesRes.data ?? []) as InvestmentThesis[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const members = (membersRes.data ?? []) as OrganizationMember[];

  // Resolve member titles for the Team checks (best-effort; failure → no titles).
  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }

  return computeBuildReadiness({ org, theses, entities, records, members, principals });
}

export interface BuildReadinessInput {
  org: Organization | null;
  theses: InvestmentThesis[];
  entities: Entity[];
  records: TrackRecord[];
  members: OrganizationMember[];
  principals: Principal[];
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

  const modules = [profile, thesisMod, brand, entity, trackRecord, team];
  const overall = Math.round(modules.reduce((s, m) => s + m.score, 0) / modules.length);

  const stages: ReadinessStage[] = STAGE_DEFS.map((s) => ({
    ...s,
    unlocked: overall >= s.threshold,
    current: false,
  }));
  const currentStage = [...stages].reverse().find((s) => s.unlocked) ?? stages[0];
  currentStage.current = true;

  // Next-best action: first incomplete check, walking modules in hub order so
  // the foundation is built front-to-back (profile → thesis → … → team).
  let nextAction: NextAction | null = null;
  for (const m of modules) {
    const pending = m.checks.find((c) => !c.done);
    if (pending) {
      nextAction = { moduleKey: m.key, moduleLabel: m.label, label: pending.action, href: m.href };
      break;
    }
  }

  const statuses = Object.fromEntries(modules.map((m) => [m.key, m.status])) as Record<
    string,
    ModuleStatus
  >;

  return { overall, stage: currentStage, stages, modules, statuses, nextAction };
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
  const supabase = createServerClient();
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
