// Normalization: every adapter's raw ProfileInput becomes one NormalizedProfile
// shape before dedupe/scoring/insert, regardless of source. Pure — no I/O.

import type {
  CapitalRole,
  NormalizedProfile,
  ProfessionalNetworkSource,
  ProfileInput,
} from "./types";
import { CAPITAL_ROLES } from "./types";

/** Clean and canonicalize a LinkedIn profile URL; null when not one. */
export function normalizeLinkedInUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    // Keep only the canonical /in/<slug> or /company/<slug> path.
    const match = url.pathname.match(/^\/(in|company)\/([^/?#]+)/i);
    if (!match) return null;
    return `https://www.linkedin.com/${match[1].toLowerCase()}/${match[2]}`;
  } catch {
    return null;
  }
}

/** Best-effort display name from a LinkedIn /in/ slug ("jane-a-doe-123" → "Jane A Doe"). */
export function nameFromLinkedInSlug(url: string): { first: string; last: string } | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) return null;
  const words = decodeURIComponent(match[1])
    .split("-")
    .filter((w) => w.length > 0 && !/^\d+$/.test(w) && !/^[0-9a-f]{6,}$/i.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  if (words.length === 0) return null;
  if (words.length === 1) return { first: words[0], last: "" };
  return { first: words[0], last: words.slice(1).join(" ") };
}

function splitFullName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function cleanEmail(raw: string | undefined): string | null {
  const email = raw?.trim().toLowerCase() ?? "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

function asCapitalRole(raw: CapitalRole | undefined): CapitalRole {
  return raw && CAPITAL_ROLES.includes(raw) ? raw : "unknown";
}

/** Title keywords → likely capital role, used when the source didn't say. */
export function inferCapitalRole(title: string | null, company: string | null): CapitalRole {
  const t = `${title ?? ""} ${company ?? ""}`.toLowerCase();
  if (!t.trim()) return "unknown";
  if (/family office/.test(t)) return "family_office";
  if (/\b(lp|limited partner)\b/.test(t)) return "limited_partner";
  if (/lender|credit fund|private credit|direct lending/.test(t)) return "lender";
  if (/broker|brokerage|intermediar/.test(t)) return "broker";
  if (/general partner|fund manager|managing partner|\bgp\b|portfolio manager/.test(t)) return "fund_manager";
  if (/independent sponsor|search fund|searcher/.test(t)) return "independent_sponsor";
  if (/founder|co-founder|cofounder/.test(t)) return "founder";
  if (/\b(ceo|coo|president|general manager)\b|operating partner|operator/.test(t)) return "operator";
  if (/attorney|counsel|lawyer|\bcpa\b|accountant|consultant|advisor|adviser/.test(t)) return "advisor";
  if (/bank|capital partners|investment(s)? (firm|group)|asset management/.test(t)) return "capital_provider";
  return "unknown";
}

/**
 * Baseline data-reliability score by source. Field coverage adds on top in
 * normalizeProfile; user verification later raises `verified` instead.
 */
export const SOURCE_BASE_CONFIDENCE: Record<ProfessionalNetworkSource, number> = {
  manual: 70,        // the user typed it — trusted identity, may lack detail
  linkedin_csv: 65,  // platform export, but point-in-time
  csv: 50,
  contacts: 60,
  email: 55,          // you demonstrably correspond with them; identity inferred from headers
  calendar: 45,
  crm: 60,
  linkedin_url: 35,  // URL reference only; fields are inferred until confirmed
  public_web: 40,
  linkedin_api: 80,  // official API, when available
};

/** Normalize any adapter's raw input into the canonical profile shape. */
export function normalizeProfile(
  input: ProfileInput,
  source: ProfessionalNetworkSource,
): NormalizedProfile | { error: string } {
  const linkedinUrl = normalizeLinkedInUrl(input.linkedinUrl);

  let first = input.firstName?.trim() ?? "";
  let last = input.lastName?.trim() ?? "";
  if (!first && input.fullName?.trim()) {
    const split = splitFullName(input.fullName);
    first = split.first;
    last = split.last;
  }
  if (!first && linkedinUrl) {
    const guessed = nameFromLinkedInSlug(linkedinUrl);
    if (guessed) {
      first = guessed.first;
      last = guessed.last;
    }
  }
  if (!first) return { error: "A contact needs at least a name or a LinkedIn profile URL." };

  const email = cleanEmail(input.email);
  const title = input.title?.trim() || null;
  const company = input.company?.trim() || null;
  const capitalRole =
    input.capitalRole && input.capitalRole !== "unknown"
      ? asCapitalRole(input.capitalRole)
      : inferCapitalRole(title, company);

  // Confidence = source baseline + coverage bonus for identity-bearing fields.
  let confidence = SOURCE_BASE_CONFIDENCE[source];
  if (email) confidence += 10;
  if (linkedinUrl) confidence += 8;
  if (title) confidence += 4;
  if (company) confidence += 4;
  confidence = Math.max(0, Math.min(100, confidence));

  return {
    first_name: first,
    last_name: last,
    email,
    phone: input.phone?.trim() || null,
    linkedin_url: linkedinUrl,
    title,
    company,
    location: input.location?.trim() || null,
    capital_role: capitalRole,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 24),
    notes: input.notes?.trim() || null,
    connected_on: input.connectedOn?.trim() || null,
    source,
    confidence,
  };
}
