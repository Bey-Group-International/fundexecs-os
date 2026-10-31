// lib/lp-wizard.ts
// The rules behind the LP setup wizard: which steps each kind of LP sees, what a
// step must contain, and what has to be true before the LP can submit. Pure and
// DB-free, so the wizard screens (to guide) and the server actions (to enforce)
// read the same rules.
import type {
  LpAccreditationBasis,
  LpEntityType,
  LpOnboardingConsent,
  LpOnboardingOwner,
  LpOnboardingProfile,
  LpReviewState,
  LpType,
} from "@/lib/supabase/database.types";

export const LP_TYPE_LABEL: Record<LpType, string> = {
  individual: "Individual",
  entity: "Entity (trust, company, partnership)",
  institutional: "Institution (pension, endowment, foundation)",
};

/** The entity types an LP of each kind may choose. */
export const ENTITY_TYPES_BY_LP_TYPE: Record<LpType, LpEntityType[]> = {
  individual: ["individual"],
  entity: ["trust", "company", "partnership", "fund", "family_office", "other"],
  institutional: ["pension", "endowment", "fund", "other"],
};

export const ENTITY_TYPE_LABEL: Record<LpEntityType, string> = {
  individual: "Individual",
  trust: "Trust",
  company: "Company",
  partnership: "Partnership",
  fund: "Fund",
  pension: "Pension plan",
  endowment: "Endowment or foundation",
  family_office: "Family office",
  other: "Other",
};

export const ACCREDITATION_BASIS_LABEL: Record<LpAccreditationBasis, string> = {
  accredited_investor: "Accredited investor",
  qualified_purchaser: "Qualified purchaser",
  qualified_client: "Qualified client",
  institutional: "Institutional investor",
};

export type WizardStepKey = "details" | "owners" | "consent" | "identity" | "accreditation" | "review";

export const STEP_LABEL: Record<WizardStepKey, string> = {
  details: "Your details",
  owners: "Owners",
  consent: "Consent",
  identity: "ID verification",
  accreditation: "Accreditation",
  review: "Review and submit",
};

/**
 * An individual has no owners to list; an institution gives entity details and a
 * signatory but no owner list. The ID verification step exists only where online
 * verification is set up; otherwise the fund manager verifies the LP themselves.
 */
export function stepsFor(lpType: LpType, identityEnabled = false): WizardStepKey[] {
  const steps: WizardStepKey[] = ["details"];
  if (lpType === "entity") steps.push("owners");
  steps.push("consent");
  if (identityEnabled) steps.push("identity");
  steps.push("accreditation", "review");
  return steps;
}

/** Whether the wizard is open for the LP to fill in or change. */
export function wizardEditable(state: LpReviewState): boolean {
  return state === "not_started" || state === "in_progress" || state === "changes_requested";
}

// ---- consent ---------------------------------------------------------------

export const CONSENT_TEXT_VERSION = "2026-10-31";

export type ConsentScope = LpOnboardingConsent["scope"];
export const CONSENT_SCOPES: ConsentScope[] = ["identity_verification", "background_screening"];

export const CONSENT_TEXT: Record<ConsentScope, { title: string; body: string }> = {
  identity_verification: {
    title: "Identity verification",
    body:
      "I agree that my identity may be verified using a government-issued photo ID and a selfie, processed by an " +
      "identity verification provider. The images are held by that provider; the fund manager receives only the result.",
  },
  background_screening: {
    title: "Background screening",
    body:
      "I agree that the fund manager may screen me, and the owners and controlling persons I list, against sanctions " +
      "lists, politically-exposed-person lists and public adverse-media and litigation sources, for the purpose of " +
      "deciding whether to accept me as an investor.",
  },
};

// ---- validation ------------------------------------------------------------

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export interface DetailsInput {
  legalName: string;
  entityType: LpEntityType;
  country: string;
  contactPhone: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
}

export function validateDetails(lpType: LpType, raw: unknown): Validated<DetailsInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const legalName = clean(r.legalName);
  const country = clean(r.country);
  const entityType = clean(r.entityType);
  const phone = clean(r.contactPhone);
  const signatoryName = clean(r.signatoryName);
  const signatoryTitle = clean(r.signatoryTitle);

  if (!legalName) return { ok: false, error: lpType === "individual" ? "Enter your full legal name." : "Enter the entity's full legal name." };
  if (legalName.length > 200) return { ok: false, error: "Keep the name under 200 characters." };
  if (!ENTITY_TYPES_BY_LP_TYPE[lpType].includes(entityType as LpEntityType)) return { ok: false, error: "Choose what kind of investor you are." };
  if (country.length < 2) return { ok: false, error: "Enter your country." };
  if (country.length > 100) return { ok: false, error: "Keep the country under 100 characters." };
  if (phone.length > 40) return { ok: false, error: "Keep the phone number under 40 characters." };
  if (lpType !== "individual") {
    if (!signatoryName) return { ok: false, error: "Enter the authorized signatory's name." };
    if (!signatoryTitle) return { ok: false, error: "Enter the authorized signatory's title." };
    if (signatoryName.length > 200 || signatoryTitle.length > 100) return { ok: false, error: "The signatory's name or title is too long." };
  }
  return {
    ok: true,
    value: {
      legalName,
      entityType: entityType as LpEntityType,
      country,
      contactPhone: phone || null,
      signatoryName: lpType === "individual" ? null : signatoryName,
      signatoryTitle: lpType === "individual" ? null : signatoryTitle,
    },
  };
}

export interface OwnerInput {
  fullName: string;
  role: "owner" | "controller";
  ownershipPct: number | null;
  country: string | null;
}

export const MAX_OWNERS = 25;

/** Validates the whole list the LP is submitting. An entity must name at least one person who controls it. */
export function validateOwners(raw: unknown): Validated<OwnerInput[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "Add the owners and controlling persons." };
  if (raw.length > MAX_OWNERS) return { ok: false, error: `List at most ${MAX_OWNERS} people.` };
  const owners: OwnerInput[] = [];
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>;
    const fullName = clean(r.fullName);
    if (!fullName) return { ok: false, error: "Every person needs a name." };
    if (fullName.length > 200) return { ok: false, error: "Keep each name under 200 characters." };
    if (r.role !== "owner" && r.role !== "controller") return { ok: false, error: "Say whether each person is an owner or a controller." };
    let ownershipPct: number | null = null;
    if (r.ownershipPct !== null && r.ownershipPct !== undefined && r.ownershipPct !== "") {
      const n = Number(r.ownershipPct);
      if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: "An ownership share is between 0 and 100%." };
      ownershipPct = Math.round(n * 100) / 100;
    }
    if (r.role === "owner" && ownershipPct === null) return { ok: false, error: `Enter ${fullName}'s ownership share.` };
    const country = clean(r.country);
    if (country.length > 100) return { ok: false, error: "Keep each country under 100 characters." };
    owners.push({ fullName, role: r.role, ownershipPct, country: country || null });
  }
  if (!owners.some((o) => o.role === "controller")) {
    return { ok: false, error: "Name at least one person who controls the entity." };
  }
  return { ok: true, value: owners };
}

export interface ConsentInput {
  scope: ConsentScope;
  typedName: string;
}

export function validateConsent(raw: unknown): Validated<ConsentInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!CONSENT_SCOPES.includes(r.scope as ConsentScope)) return { ok: false, error: "Unknown consent." };
  const typedName = clean(r.typedName);
  if (!typedName) return { ok: false, error: "Type your full name to give consent." };
  if (typedName.length > 200) return { ok: false, error: "Keep the name under 200 characters." };
  return { ok: true, value: { scope: r.scope as ConsentScope, typedName } };
}

export interface AccreditationInput {
  basis: LpAccreditationBasis;
  sourceOfFunds: string;
}

export const SOURCE_OF_FUNDS_MIN = 10;
export const SOURCE_OF_FUNDS_MAX = 1000;

export function validateAccreditation(raw: unknown): Validated<AccreditationInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!Object.keys(ACCREDITATION_BASIS_LABEL).includes(String(r.basis))) return { ok: false, error: "Choose how you qualify." };
  if (r.statement !== true) return { ok: false, error: "Confirm the statement to continue." };
  const sourceOfFunds = clean(r.sourceOfFunds);
  if (sourceOfFunds.length < SOURCE_OF_FUNDS_MIN) return { ok: false, error: "Tell us where the money comes from, in a sentence or two." };
  if (sourceOfFunds.length > SOURCE_OF_FUNDS_MAX) return { ok: false, error: `Keep this under ${SOURCE_OF_FUNDS_MAX} characters.` };
  return { ok: true, value: { basis: r.basis as LpAccreditationBasis, sourceOfFunds } };
}

// ---- progress --------------------------------------------------------------

export interface WizardData {
  lpType: LpType;
  profile: Pick<
    LpOnboardingProfile,
    | "legal_name"
    | "entity_type"
    | "country"
    | "signatory_name"
    | "signatory_title"
    | "source_of_funds"
    | "accreditation_basis"
    | "accreditation_statement_at"
  > | null;
  owners: Pick<LpOnboardingOwner, "role">[];
  consents: Pick<LpOnboardingConsent, "scope" | "text_version">[];
  /** Present when online ID verification is set up. `verified` means Stripe cleared it. */
  identity?: { enabled: boolean; verified: boolean };
}

/** The steps (other than the final review) still to be completed. */
export function incompleteSteps(data: WizardData): WizardStepKey[] {
  const p = data.profile;
  const missing: WizardStepKey[] = [];

  const detailsDone =
    !!p?.legal_name &&
    !!p.entity_type &&
    !!p.country &&
    (data.lpType === "individual" || (!!p.signatory_name && !!p.signatory_title));
  if (!detailsDone) missing.push("details");

  if (data.lpType === "entity" && !data.owners.some((o) => o.role === "controller")) missing.push("owners");

  const consented = new Set(data.consents.filter((c) => c.text_version === CONSENT_TEXT_VERSION).map((c) => c.scope));
  if (!CONSENT_SCOPES.every((s) => consented.has(s))) missing.push("consent");

  if (data.identity?.enabled && !data.identity.verified) missing.push("identity");

  const accreditationDone =
    !!p?.accreditation_basis && !!p.accreditation_statement_at && (p.source_of_funds ?? "").length >= SOURCE_OF_FUNDS_MIN;
  if (!accreditationDone) missing.push("accreditation");

  return missing;
}

export function readyToSubmit(data: WizardData): boolean {
  return incompleteSteps(data).length === 0;
}

// ---- access codes ----------------------------------------------------------

export const CODE_TTL_MS = 15 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_MIN_GAP_MS = 60 * 1000;
export const CODE_MAX_PER_HOUR = 5;

/** A 6-digit code from a cryptographic source. */
export function generateCode(randomInt: (max: number) => number): string {
  return String(randomInt(1_000_000)).padStart(6, "0");
}

/** Tolerates the spaces and dashes people type when copying a code. */
export function normalizeCode(input: unknown): string | null {
  const digits = typeof input === "string" ? input.replace(/[\s-]/g, "") : "";
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** One code a minute, five an hour, so the link cannot be used to flood an LP's inbox. */
export function canIssueCode(issuedAt: Array<string | Date>, now: number): { ok: true } | { ok: false; error: string } {
  const times = issuedAt.map((t) => new Date(t).getTime());
  if (times.some((t) => now - t < CODE_MIN_GAP_MS)) return { ok: false, error: "A code was just sent. Wait a minute before asking for another." };
  if (times.filter((t) => now - t < 60 * 60 * 1000).length >= CODE_MAX_PER_HOUR) {
    return { ok: false, error: "Too many codes have been requested. Try again later, or ask your fund manager." };
  }
  return { ok: true };
}

/** `jane.doe@example.com` → `j•••@example.com`: enough to recognise, not enough to learn. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "your email";
  return `${email[0]}•••${email.slice(at)}`;
}

// ---- the fund manager making a link ----------------------------------------

export const LINK_TTL_DAYS = 7;
export const DEFAULT_OWNER_THRESHOLD_PCT = 25;

export interface LinkInput {
  lpName: string;
  lpEmail: string;
  lpType: LpType;
  ownerThresholdPct: number;
  fundId: string | null;
  commitmentAmount: number | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateLinkInput(raw: unknown): Validated<LinkInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lpName = clean(r.lpName);
  const lpEmail = clean(r.lpEmail).toLowerCase();
  if (!lpName) return { ok: false, error: "Enter the LP's name." };
  if (lpName.length > 200) return { ok: false, error: "Keep the name under 200 characters." };
  if (!EMAIL.test(lpEmail) || lpEmail.length > 254) return { ok: false, error: "Enter a valid email address for the LP." };
  if (r.lpType !== "individual" && r.lpType !== "entity" && r.lpType !== "institutional") {
    return { ok: false, error: "Choose what kind of LP this is." };
  }
  let ownerThresholdPct = DEFAULT_OWNER_THRESHOLD_PCT;
  if (r.ownerThresholdPct !== undefined && r.ownerThresholdPct !== null && r.ownerThresholdPct !== "") {
    const n = Number(r.ownerThresholdPct);
    if (!Number.isInteger(n) || n < 1 || n > 100) return { ok: false, error: "The ownership threshold is a whole number from 1 to 100." };
    ownerThresholdPct = n;
  }
  const fundId = clean(r.fundId) || null;
  let commitmentAmount: number | null = null;
  if (r.commitmentAmount !== undefined && r.commitmentAmount !== null && r.commitmentAmount !== "") {
    const n = Number(r.commitmentAmount);
    if (!Number.isFinite(n) || n <= 0 || n > 1e12) return { ok: false, error: "Enter a commitment above zero, or leave it blank." };
    commitmentAmount = n;
  }
  return { ok: true, value: { lpName, lpEmail, lpType: r.lpType, ownerThresholdPct, fundId, commitmentAmount } };
}
