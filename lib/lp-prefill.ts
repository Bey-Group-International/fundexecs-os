// lib/lp-prefill.ts
// What the setup wizard's details step can fill in from the fund manager's own
// record of this LP (the allocator), so the LP checks it instead of retyping it.
// Pure, so the rules are tested without a database.
//
// These are suggestions, never answers: they seed the form, the LP corrects and
// saves them, and nothing is stored as the LP's until they do. A suggestion that
// doesn't fit the form's own limits is dropped, never truncated: half a name is
// worse than a blank.
//
// Deliberately not suggested: country. The allocator's "jurisdiction" can be a
// state, a province or a country, and a wrong country in a compliance form is
// worse than a blank one. Notes, size and pipeline stage are never read.
import { ENTITY_TYPES_BY_LP_TYPE } from "@/lib/lp-wizard";
import type { LpEntityType, LpType } from "@/lib/supabase/database.types";

/** The only columns of the allocator record this reads. */
export const PREFILL_INVESTOR_COLUMNS = "name, investor_type, contact_name, contact_phone, role";

export interface InvestorForPrefill {
  name?: string | null;
  investor_type?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  role?: string | null;
}

export interface DetailsPrefill {
  legalName?: string;
  entityType?: LpEntityType;
  contactPhone?: string;
  signatoryName?: string;
  signatoryTitle?: string;
}

/** Limits match validateDetails in lib/lp-wizard.ts. */
const MAX = { name: 200, phone: 40, title: 100 } as const;

/** Only the allocator types that name one kind of entity. Anything ambiguous is left for the LP to choose. */
const ENTITY_FROM_INVESTOR_TYPE: Record<string, LpEntityType> = {
  family_office: "family_office",
  fund_of_funds: "fund",
};

function text(value: string | null | undefined, max: number): string | undefined {
  const s = (value ?? "").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : undefined;
}

export function prefillFromInvestor(lpType: LpType, investor: InvestorForPrefill | null | undefined): DetailsPrefill {
  if (!investor) return {};
  const out: DetailsPrefill = {};

  const phone = text(investor.contact_phone, MAX.phone);
  if (phone) out.contactPhone = phone;

  // An individual's own name is already the link's name; the allocator's name and contact are not theirs to sign for.
  if (lpType === "individual") return out;

  const legalName = text(investor.name, MAX.name);
  if (legalName) out.legalName = legalName;

  const suggestedType = ENTITY_FROM_INVESTOR_TYPE[investor.investor_type ?? ""];
  if (suggestedType && ENTITY_TYPES_BY_LP_TYPE[lpType].includes(suggestedType)) out.entityType = suggestedType;

  const signatory = text(investor.contact_name, MAX.name);
  if (signatory) out.signatoryName = signatory;
  const title = text(investor.role, MAX.title);
  if (title) out.signatoryTitle = title;

  return out;
}
