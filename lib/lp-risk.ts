// lib/lp-risk.ts
// Risk-based routing for LP onboarding. Pure and DB-free: the same rules run on
// the review screen (to explain) and in the approval action (to enforce).
//
// WHAT THIS IS: a way to send the riskier LPs to a more careful decision. It looks
// at what the system already knows (where the LP and its owners are, what kind of
// structure it is, what screening found, how the ID was checked) and returns a
// tier with the reasons. A tier changes what an APPROVAL requires; it never
// approves, rejects or clears anything.
//
//   low       no change.
//   elevated  the approver must write real reasoning (at least 40 characters).
//   high      only an organization OWNER can approve, with fuller reasoning
//             (at least 80 characters).
//
// WHAT THIS IS NOT: a compliance program. The country lists below are a STARTING
// POINT written from general knowledge, NOT checked against the current FATF or
// OFAC publications, and those change. Compliance must review them and keep them
// current, either here or with LP_HIGH_RISK_COUNTRIES / LP_ELEVATED_RISK_COUNTRIES
// (comma-separated; each REPLACES its built-in list). The country is free text
// typed by the LP, so a misspelling or a transliteration will not match.
import type { MemberRole, OnboardingCheckKind, OnboardingCheckStatus } from "@/lib/supabase/database.types";

export type RiskTier = "low" | "elevated" | "high";

export interface RiskFactor {
  /** Stable short code (for tests and the activity log). */
  code: string;
  tier: "elevated" | "high";
  /** One plain sentence for the person reading the card. */
  text: string;
}

export interface RiskAssessment {
  tier: RiskTier;
  factors: RiskFactor[];
}

export interface RiskInput {
  lpType: "individual" | "entity" | string | null | undefined;
  entityType: string | null | undefined;
  country: string | null | undefined;
  ownerThresholdPct: number | null | undefined;
  owners: Array<{ role: string; ownershipPct: number | null | undefined; country: string | null | undefined }>;
  checks: Array<{ kind: OnboardingCheckKind; status: OnboardingCheckStatus; method?: string | null }>;
}

export interface RiskLists {
  high: string[];
  elevated: string[];
}

// ---- countries -------------------------------------------------------------

/** Spellings people actually type, folded to one name. Only countries on a list need an entry. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  iran: ["iran", "islamic republic of iran", "ir", "irn", "persia"],
  "north korea": ["north korea", "dprk", "democratic peoples republic of korea", "korea north", "korea democratic peoples republic of", "kp", "prk"],
  cuba: ["cuba", "cu", "cub"],
  syria: ["syria", "syrian arab republic", "sy", "syr"],
  myanmar: ["myanmar", "burma", "mm", "mmr"],
};

const ALIAS_TO_NAME = new Map<string, string>();
for (const [name, aliases] of Object.entries(COUNTRY_ALIASES)) for (const a of aliases) ALIAS_TO_NAME.set(a, name);

/** Lower-case, accents and punctuation dropped, spaces collapsed, then known aliases folded. */
export function normalizeCountry(text: unknown): string {
  if (typeof text !== "string") return "";
  const plain = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ALIAS_TO_NAME.get(plain) ?? plain;
}

/** Countries under comprehensive sanctions or FATF "call for action", as best known. NOT verified: see the file header. */
export const DEFAULT_HIGH_RISK_COUNTRIES = ["iran", "north korea", "cuba", "syria", "myanmar"];
export const DEFAULT_ELEVATED_RISK_COUNTRIES: string[] = [];

function parseList(raw: string | undefined, fallback: string[]): string[] {
  const text = raw?.trim();
  if (!text) return fallback;
  return text
    .split(",")
    .map(normalizeCountry)
    .filter(Boolean);
}

export function riskLists(env: Record<string, string | undefined> = process.env): RiskLists {
  return {
    high: parseList(env.LP_HIGH_RISK_COUNTRIES, DEFAULT_HIGH_RISK_COUNTRIES),
    elevated: parseList(env.LP_ELEVATED_RISK_COUNTRIES, DEFAULT_ELEVATED_RISK_COUNTRIES),
  };
}

// ---- the assessment --------------------------------------------------------

const SCREENING_KINDS: OnboardingCheckKind[] = ["sanctions", "pep", "adverse_media"];
const SCREENING_LABEL: Record<string, string> = { sanctions: "Sanctions", pep: "Politically exposed", adverse_media: "Adverse media" };

/** Structures where the person behind them is hard to see. */
const OPAQUE_ENTITY_TYPES = new Set(["trust", "family_office", "other"]);
/** Structures whose beneficial owners should be listed (institutions like pensions are not asked for individuals). */
const OWNED_ENTITY_TYPES = new Set(["company", "partnership", "trust", "family_office", "other"]);

const TIER_RANK: Record<RiskTier, number> = { low: 0, elevated: 1, high: 2 };

export function assessRisk(input: RiskInput, lists: RiskLists = riskLists()): RiskAssessment {
  const factors: RiskFactor[] = [];
  const isEntity = input.lpType === "entity";

  // Screening that found something.
  for (const c of input.checks) {
    if (SCREENING_KINDS.includes(c.kind) && (c.status === "flagged" || c.status === "failed")) {
      factors.push({ code: `screening_${c.kind}`, tier: "high", text: `${SCREENING_LABEL[c.kind]} screening came back ${c.status}.` });
    }
  }

  // Where the LP and its owners are.
  const place = (label: string, country: string | null | undefined, codePrefix: string) => {
    const n = normalizeCountry(country);
    if (!n) return;
    if (lists.high.includes(n)) factors.push({ code: `${codePrefix}_high_risk_country`, tier: "high", text: `${label} is in a high-risk jurisdiction (${String(country).trim()}).` });
    else if (lists.elevated.includes(n)) factors.push({ code: `${codePrefix}_elevated_country`, tier: "elevated", text: `${label} is in a jurisdiction on your elevated-risk list (${String(country).trim()}).` });
  };
  place("The LP", input.country, "lp");
  input.owners.forEach((o, i) => place(`Owner ${i + 1}`, o.country, "owner"));

  // The structure.
  if (isEntity && input.entityType && OPAQUE_ENTITY_TYPES.has(input.entityType)) {
    factors.push({ code: "opaque_structure", tier: "elevated", text: `A ${input.entityType.replace("_", " ")} can hide who is behind it.` });
  }
  if (isEntity && input.entityType && OWNED_ENTITY_TYPES.has(input.entityType)) {
    const threshold = typeof input.ownerThresholdPct === "number" ? input.ownerThresholdPct : 25;
    const disclosed = input.owners.some((o) => o.role === "owner" && typeof o.ownershipPct === "number" && o.ownershipPct >= threshold);
    if (!disclosed) {
      factors.push({ code: "no_owner_over_threshold", tier: "elevated", text: `No owner at or above ${threshold}% is listed, so who ultimately owns this LP isn't clear.` });
    }
  }

  // How the ID was checked.
  if (input.checks.some((c) => c.kind === "identity" && c.status === "clear" && c.method === "manual")) {
    factors.push({ code: "id_attested_by_hand", tier: "elevated", text: "The ID check was recorded by hand, not verified by a provider." });
  }

  const tier = factors.reduce<RiskTier>((t, f) => (TIER_RANK[f.tier] > TIER_RANK[t] ? f.tier : t), "low");
  return { tier, factors };
}

// ---- what approval requires ------------------------------------------------

export const ELEVATED_MIN_REASON = 40;
export const HIGH_MIN_REASON = 80;

export interface ApprovalRequirement {
  ownerOnly: boolean;
  minReasonChars: number;
  note: string | null;
}

export function approvalRequirement(tier: RiskTier): ApprovalRequirement {
  if (tier === "high") {
    return {
      ownerOnly: true,
      minReasonChars: HIGH_MIN_REASON,
      note: `High risk. Only an organization owner can approve, with reasoning of at least ${HIGH_MIN_REASON} characters on what you checked.`,
    };
  }
  if (tier === "elevated") {
    return {
      ownerOnly: false,
      minReasonChars: ELEVATED_MIN_REASON,
      note: `Elevated risk. Say what you checked and why you are satisfied (at least ${ELEVATED_MIN_REASON} characters).`,
    };
  }
  return { ownerOnly: false, minReasonChars: 0, note: null };
}

/** Why THIS person can't approve THIS LP with THIS reasoning, or null when nothing stands in the way. */
export function approvalRiskBlocker(
  assessment: RiskAssessment,
  role: MemberRole | null | undefined,
  reason: string,
): string | null {
  const need = approvalRequirement(assessment.tier);
  if (need.ownerOnly && role !== "owner") {
    return "This LP is high risk, so only an organization owner can approve them. An admin can record the checks and ask an owner to decide.";
  }
  if (need.minReasonChars > 0 && reason.trim().length < need.minReasonChars) {
    return need.note;
  }
  return null;
}
