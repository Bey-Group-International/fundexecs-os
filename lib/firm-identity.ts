// Firm Identity — the unified Build-hub foundation that consolidates the four
// identity surfaces (Profile, Thesis, Brand, Entity) into one interactive,
// institutional page. This module defines the canonical "questions" an operator
// answers to complete the firm's identity, grouped by section, and computes
// per-section + overall completion from already-fetched foundation data.
//
// The question set mirrors the weighted checks in `build-readiness.ts` so the
// hub-level readiness meter and this page's guided interview always agree on
// what "complete" means. Questions the operator can answer inline (single
// `organizations` columns) carry a `field`; structural questions (creating a
// thesis or an entity row) are `jump` questions that route to the section.

export type IdentityInputKind = "text" | "textarea" | "select" | "color" | "jump";

export type IdentitySectionKey = "identity" | "thesis" | "brand" | "entity";

export interface IdentitySectionMeta {
  key: IdentitySectionKey;
  label: string;
  eyebrow: string;
  blurb: string;
  anchor: string; // in-page anchor, e.g. "#thesis"
}

export const IDENTITY_SECTIONS: IdentitySectionMeta[] = [
  {
    key: "identity",
    label: "Identity",
    eyebrow: "Who you are",
    blurb: "The firm's public identity — the basics every other module builds on.",
    anchor: "#identity",
  },
  {
    key: "thesis",
    label: "Thesis",
    eyebrow: "What you invest in",
    blurb: "Your mandate — sectors, geographies, and the returns you target.",
    anchor: "#thesis",
  },
  {
    key: "brand",
    label: "Brand",
    eyebrow: "How you look and sound",
    blurb: "Logo, colors, tagline, and voice — used in every memo and package.",
    anchor: "#brand",
  },
  {
    key: "entity",
    label: "Entity",
    eyebrow: "Your legal structure",
    blurb: "GP, management company, funds, and SPVs — the structure LPs diligence.",
    anchor: "#entity",
  },
];

/** Compact, already-fetched foundation data the progress computation reads. */
export interface IdentityData {
  org: {
    legal_name?: string | null;
    entity_type?: string | null;
    jurisdiction?: string | null;
    website?: string | null;
    description?: string | null;
    tagline?: string | null;
    brand_color?: string | null;
    logo_url?: string | null;
    brand_palette?: string[] | null;
    brand_voice?: string | null;
  } | null;
  thesis: {
    summary?: string | null;
    asset_classes?: string[] | null;
    geographies?: string[] | null;
    target_irr?: number | null;
    target_moic?: number | null;
    check_size_min?: number | null;
    check_size_max?: number | null;
  } | null;
  thesisCount: number;
  entityTypes: string[];
}

export interface IdentityQuestion {
  section: IdentitySectionKey;
  /** Stable id; equals the `organizations` column when inline-answerable. */
  id: string;
  question: string;
  hint?: string;
  kind: IdentityInputKind;
  /** `organizations` column to write, for inline (non-jump) questions. */
  field?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** True once the underlying data satisfies this question. */
  done: (d: IdentityData) => boolean;
}

const has = (v: unknown): boolean =>
  v !== null && v !== undefined && (typeof v === "string" ? v.trim().length > 0 : true);

const ENTITY_TYPE_OPTIONS = [
  { value: "LLC", label: "LLC" },
  { value: "LP", label: "LP" },
  { value: "Corporation", label: "Corporation" },
  { value: "Trust", label: "Trust" },
  { value: "Ltd", label: "Ltd" },
  { value: "GP", label: "GP" },
  { value: "Other", label: "Other" },
];

const GP_KINDS = new Set(["gp", "management_co"]);
const FUND_KINDS = new Set(["fund", "spv", "holdco"]);

// The full ordered question set. Order is the order the guided interview walks
// them: front-to-back through Identity → Thesis → Brand → Entity.
export const IDENTITY_QUESTIONS: IdentityQuestion[] = [
  // — Identity ————————————————————————————————————————————————
  {
    section: "identity",
    id: "legal_name",
    question: "What is your firm's full legal name?",
    hint: "The registered entity name LPs will see on subscription documents.",
    kind: "text",
    field: "legal_name",
    placeholder: "e.g. Meridian Capital Partners, LP",
    done: (d) => has(d.org?.legal_name),
  },
  {
    section: "identity",
    id: "entity_type",
    question: "How is the firm structured?",
    hint: "Earn uses this to frame terms and documents correctly.",
    kind: "select",
    field: "entity_type",
    options: ENTITY_TYPE_OPTIONS,
    done: (d) => has(d.org?.entity_type),
  },
  {
    section: "identity",
    id: "jurisdiction",
    question: "Where is the firm domiciled?",
    hint: "The jurisdiction of formation.",
    kind: "text",
    field: "jurisdiction",
    placeholder: "e.g. Delaware",
    done: (d) => has(d.org?.jurisdiction),
  },
  {
    section: "identity",
    id: "website",
    question: "What's your firm's website?",
    kind: "text",
    field: "website",
    placeholder: "example.com",
    done: (d) => has(d.org?.website),
  },
  {
    section: "identity",
    id: "description",
    question: "In a sentence or two, what does your firm do?",
    hint: "This anchors how counterparties and Earn describe you.",
    kind: "textarea",
    field: "description",
    placeholder: "e.g. We back founder-led industrial software companies at the lower middle market…",
    done: (d) => has(d.org?.description),
  },
  // — Thesis (structural — routes to the section) ————————————————
  {
    section: "thesis",
    id: "thesis_exists",
    question: "Define your investment thesis — what you invest in, where, and the returns you target.",
    hint: "This becomes your mandate: it frames every pipeline and evaluation across the OS.",
    kind: "jump",
    done: (d) => d.thesisCount > 0,
  },
  {
    section: "thesis",
    id: "thesis_summary",
    question: "Summarize your thesis in a paragraph.",
    kind: "jump",
    done: (d) => has(d.thesis?.summary),
  },
  {
    section: "thesis",
    id: "thesis_asset_classes",
    question: "Which asset classes do you target?",
    kind: "jump",
    done: (d) => !!d.thesis?.asset_classes?.length,
  },
  {
    section: "thesis",
    id: "thesis_geographies",
    question: "Which geographies do you focus on?",
    kind: "jump",
    done: (d) => !!d.thesis?.geographies?.length,
  },
  {
    section: "thesis",
    id: "thesis_returns",
    question: "Set your target IRR / MOIC.",
    kind: "jump",
    done: (d) => has(d.thesis?.target_irr) || has(d.thesis?.target_moic),
  },
  {
    section: "thesis",
    id: "thesis_check_size",
    question: "Define your check-size range.",
    kind: "jump",
    done: (d) => has(d.thesis?.check_size_min) || has(d.thesis?.check_size_max),
  },
  // — Brand ——————————————————————————————————————————————————
  {
    section: "brand",
    id: "tagline",
    question: "What's your firm's tagline?",
    hint: "One line, shown on your profile card and materials.",
    kind: "text",
    field: "tagline",
    placeholder: "e.g. Institutional capital for tomorrow's infrastructure",
    done: (d) => has(d.org?.tagline),
  },
  {
    section: "brand",
    id: "brand_color",
    question: "Pick your primary brand color.",
    hint: "Used as the accent across generated documents.",
    kind: "color",
    field: "brand_color",
    done: (d) => has(d.org?.brand_color),
  },
  {
    section: "brand",
    id: "brand_voice",
    question: "Describe the voice Earn should write in.",
    hint: "Tone and style for memos, decks, and outreach.",
    kind: "textarea",
    field: "brand_voice",
    placeholder: "e.g. Authoritative, direct, and precise — no jargon, no hype.",
    done: (d) => has(d.org?.brand_voice),
  },
  {
    section: "brand",
    id: "logo",
    question: "Add your firm's logo.",
    hint: "Upload it in the Brand section — Earn places it on every package.",
    kind: "jump",
    done: (d) => has(d.org?.logo_url),
  },
  {
    section: "brand",
    id: "brand_palette",
    question: "Build out your color palette.",
    kind: "jump",
    done: (d) => (d.org?.brand_palette?.length ?? 0) >= 2,
  },
  // — Entity (structural — routes to the section) ————————————————
  {
    section: "entity",
    id: "entity_exists",
    question: "Add your first legal entity — GP, fund, or SPV.",
    hint: "The structure allocators diligence before a first meeting.",
    kind: "jump",
    done: (d) => d.entityTypes.length > 0,
  },
  {
    section: "entity",
    id: "entity_gp",
    question: "Add your GP or management company.",
    kind: "jump",
    done: (d) => d.entityTypes.some((t) => GP_KINDS.has(t)),
  },
  {
    section: "entity",
    id: "entity_fund",
    question: "Add a fund, SPV, or holdco.",
    kind: "jump",
    done: (d) => d.entityTypes.some((t) => FUND_KINDS.has(t)),
  },
];

/** Columns the inline "answer a question" action is allowed to write. */
export const IDENTITY_WRITABLE_FIELDS = new Set(
  IDENTITY_QUESTIONS.filter((q) => q.field).map((q) => q.field as string),
);

export type IdentityStatus = "empty" | "started" | "complete";

export interface IdentitySectionProgress extends IdentitySectionMeta {
  total: number;
  doneCount: number;
  score: number; // 0–100
  status: IdentityStatus;
}

export interface IdentityProgress {
  overall: number;
  status: IdentityStatus;
  sections: IdentitySectionProgress[];
  /** Unanswered questions, in interview order — what the guide walks through. */
  pending: IdentityQuestion[];
}

/** Serializable shape of a question sent to the client guide. */
export interface IdentityQuestionDTO {
  section: IdentitySectionKey;
  sectionLabel: string;
  anchor: string;
  id: string;
  question: string;
  hint?: string;
  kind: IdentityInputKind;
  field?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export function toQuestionDTO(q: IdentityQuestion): IdentityQuestionDTO {
  const section = IDENTITY_SECTIONS.find((s) => s.key === q.section)!;
  return {
    section: q.section,
    sectionLabel: section.label,
    anchor: section.anchor,
    id: q.id,
    question: q.question,
    hint: q.hint,
    kind: q.kind,
    field: q.field,
    placeholder: q.placeholder,
    options: q.options,
  };
}

/**
 * Compute per-section and overall Firm Identity completion from foundation
 * data, plus the ordered list of still-unanswered questions.
 */
export function computeIdentityProgress(data: IdentityData): IdentityProgress {
  const sections: IdentitySectionProgress[] = IDENTITY_SECTIONS.map((meta) => {
    const qs = IDENTITY_QUESTIONS.filter((q) => q.section === meta.key);
    const doneCount = qs.filter((q) => q.done(data)).length;
    const total = qs.length;
    const score = total === 0 ? 0 : Math.round((doneCount / total) * 100);
    const status: IdentityStatus =
      score === 0 ? "empty" : score === 100 ? "complete" : "started";
    return { ...meta, total, doneCount, score, status };
  });

  const overall = Math.round(
    sections.reduce((s, sec) => s + sec.score, 0) / (sections.length || 1),
  );
  const status: IdentityStatus =
    overall === 0 ? "empty" : overall === 100 ? "complete" : "started";

  const pending = IDENTITY_QUESTIONS.filter((q) => !q.done(data));

  return { overall, status, sections, pending };
}
