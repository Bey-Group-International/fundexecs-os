// lib/source-verification.ts
// Internal verification for sourced candidates — runs BEFORE anything reaches
// the operator.
//
// A sourcing engine that shows the operator whatever the model said is asking
// them to be the fact-checker. This module makes the system do that work first,
// in two passes:
//
//   1. STRUCTURAL (always, offline, pure) — is this internally coherent? Are the
//      contact fields well formed? Does the email's domain agree with the stated
//      website? Is the category a real option for this module? Cross-field
//      disagreement is the cheapest hallucination detector there is, and it
//      costs no API call.
//
//   2. CORROBORATION (when Apollo is configured) — does this firm actually
//      exist? Apollo's organization record confirms the entity and supplies a
//      real domain and HQ; its people search confirms the decision maker and
//      replaces a model-guessed email with a provider-verified one.
//
// Every candidate comes out carrying a status, a confidence, the list of checks
// that ran, and per-field provenance, so the UI can show the operator what's
// been confirmed versus what's still a lead. Fields that fail are dropped — a
// candidate is never presented with a contact detail we couldn't stand behind.
import type { SourceCandidate } from "@/lib/source-ai";
import { cleanEmail, cleanPhone, cleanLinkedIn, cleanWebUrl, normalizeEntityName } from "@/lib/source-identity";

/** Where a given field's value came from, strongest wins. */
export type FieldProvenance = "model" | "web" | "apollo";

export type VerificationStatus =
  /** Corroborated against an external provider record. */
  | "verified"
  /** Internally coherent and carries a citation, but no provider confirmation. */
  | "corroborated"
  /** Structurally sound but unconfirmed — a lead, not a fact. */
  | "unverified"
  /** Failed a hard check; unsafe to act on without operator research. */
  | "flagged";

export interface VerificationCheck {
  /** Stable identifier, e.g. "email_shape". */
  id: string;
  /** Short human line for the UI tooltip. */
  label: string;
  ok: boolean;
  /** Present when the check failed or qualified its pass. */
  detail?: string;
}

export interface CandidateVerification {
  status: VerificationStatus;
  /** 0–1. Drives the UI's confidence read and the stored record's confidence. */
  confidence: number;
  checks: VerificationCheck[];
  /** Per-field origin, so the operator can see what's provider-backed. */
  provenance: Partial<Record<keyof SourceCandidate, FieldProvenance>>;
  verifiedAt: string;
}

export interface VerifiedCandidate extends SourceCandidate {
  verification: CandidateVerification;
}

/** Registrable domain of a URL or email, lowercased and www-stripped. */
export function domainOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (v.includes("@")) return v.slice(v.lastIndexOf("@") + 1) || undefined;
  try {
    return new URL(v).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compare two domains allowing for subdomains and co.uk-style suffixes:
 * "ir.acme.com" and "acme.com" agree; "acme.com" and "acmecapital.com" don't.
 */
export function domainsAgree(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const partsA = a.split(".");
  const partsB = b.split(".");
  const tail = (p: string[]) => p.slice(-3).join(".");
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`) || tail(partsA) === tail(partsB);
}

// Free mailbox providers — a decision maker's address there tells us nothing
// about the firm's domain, so a mismatch isn't evidence of fabrication.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "mail.com", "zoho.com", "fastmail.com",
]);

/**
 * Pass 1 — structural verification. Pure, offline, and always runs. Returns the
 * candidate with unusable fields stripped and a verification record attached.
 */
export function verifyStructure<T extends SourceCandidate>(
  candidate: T,
  allowedCategories: string[] = [],
): T & VerifiedCandidate {
  const checks: VerificationCheck[] = [];
  const provenance: CandidateVerification["provenance"] = {};
  const out: T = { ...candidate };

  const push = (id: string, label: string, ok: boolean, detail?: string) =>
    checks.push({ id, label, ok, detail });

  // --- identity -----------------------------------------------------------
  const normalized = normalizeEntityName(out.name);
  const namedOk = normalized.length >= 2;
  push("name", "Target has a usable name", namedOk, namedOk ? undefined : "Name is empty or unusable.");
  if (namedOk) provenance.name = "model";

  // --- category -----------------------------------------------------------
  if (allowedCategories.length) {
    const categoryOk = allowedCategories.some((o) => o.toLowerCase() === String(out.category ?? "").toLowerCase());
    push("category", "Category is valid for this module", categoryOk, categoryOk ? undefined : "Category fell back to a default.");
  }

  // --- citation -----------------------------------------------------------
  const sourceUrl = cleanWebUrl(out.sourceUrl);
  out.sourceUrl = sourceUrl;
  const website = cleanWebUrl(out.website);
  out.website = website;
  if (sourceUrl) provenance.sourceUrl = "web";
  if (website) provenance.website = "model";
  push("citation", "Carries a supporting source link", Boolean(sourceUrl), sourceUrl ? undefined : "No citation — generated from model knowledge.");

  // --- contact hygiene ----------------------------------------------------
  const rawEmail = out.contactEmail;
  const email = cleanEmail(rawEmail);
  if (rawEmail && !email) {
    push("email_shape", "Contact email is well formed", false, "Dropped an invalid or placeholder email.");
  } else if (email) {
    push("email_shape", "Contact email is well formed", true);
    provenance.contactEmail = "model";
  }
  out.contactEmail = email;

  const rawPhone = out.contactPhone;
  const phone = cleanPhone(rawPhone);
  if (rawPhone && !phone) {
    push("phone_shape", "Contact phone is plausible", false, "Dropped an invalid or placeholder number.");
  } else if (phone) {
    provenance.contactPhone = "model";
  }
  out.contactPhone = phone;

  const rawLinkedIn = out.contactLinkedIn;
  const linkedin = cleanLinkedIn(rawLinkedIn);
  if (rawLinkedIn && !linkedin) {
    push("linkedin_shape", "LinkedIn URL points at LinkedIn", false, "Dropped a non-LinkedIn or malformed profile URL.");
  } else if (linkedin) {
    provenance.contactLinkedIn = "model";
  }
  out.contactLinkedIn = linkedin;

  // --- cross-field coherence ---------------------------------------------
  // The strongest offline signal: a real contact at a real firm uses that
  // firm's domain. Disagreement means at least one of the two was invented.
  const emailDomain = domainOf(out.contactEmail);
  const siteDomain = domainOf(out.website);
  if (emailDomain && siteDomain && !FREE_MAIL_DOMAINS.has(emailDomain)) {
    const agree = domainsAgree(emailDomain, siteDomain);
    push("domain_match", "Email domain matches the website", agree, agree ? undefined : `Email domain ${emailDomain} does not match ${siteDomain}.`);
    if (!agree) {
      // Keep the firm, drop the contact route we can't stand behind.
      out.contactEmail = undefined;
      delete provenance.contactEmail;
    }
  }

  // A contact email with no name behind it isn't actionable outreach.
  if (out.contactEmail && !String(out.contactName ?? "").trim()) {
    push("contact_named", "Email is attached to a named person", false, "Email present with no decision maker named.");
  }

  const hardFail = checks.some((c) => !c.ok && (c.id === "name" || c.id === "domain_match"));
  const status: VerificationStatus = hardFail ? "flagged" : sourceUrl ? "corroborated" : "unverified";

  return {
    ...out,
    verification: {
      status,
      confidence: scoreConfidence(status, out, checks),
      checks,
      provenance,
      verifiedAt: new Date().toISOString(),
    },
  };
}

/** Blend status and field completeness into a 0–1 confidence. */
export function scoreConfidence(
  status: VerificationStatus,
  candidate: SourceCandidate,
  checks: VerificationCheck[],
): number {
  const base = { verified: 0.8, corroborated: 0.6, unverified: 0.4, flagged: 0.2 }[status];
  const signals = [
    candidate.website,
    candidate.contactName,
    candidate.contactEmail,
    candidate.contactLinkedIn,
    candidate.aumRange || candidate.ticketRange,
    candidate.geography,
  ].filter(Boolean).length;
  const completeness = (signals / 6) * 0.2;
  const failures = checks.filter((c) => !c.ok).length;
  const penalty = Math.min(0.15, failures * 0.05);
  return Math.max(0, Math.min(1, Number((base + completeness - penalty).toFixed(2))));
}

/**
 * Pass 2 — external corroboration via Apollo. Confirms the firm exists, fills a
 * real domain and HQ, and replaces model-guessed contacts with provider records.
 *
 * Bounded and best-effort throughout: each candidate gets one org lookup and at
 * most one people lookup, both behind a timeout, and any failure leaves the
 * candidate exactly as pass 1 produced it. Verification must never be the reason
 * a search fails to return.
 */
export async function corroborateCandidates<T extends VerifiedCandidate>(
  candidates: T[],
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<T[]> {
  if (!candidates.length || !process.env.APOLLO_API_KEY) return candidates;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const timeoutMs = options.timeoutMs ?? 4000;

  const { enrichOrganization, searchPeople } = await import("@/lib/integrations/providers/apollo");

  const withTimeout = async <T>(work: () => Promise<T>): Promise<T | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work().finally(() => clearTimeout(timer)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
    } catch {
      return null;
    }
  };

  const corroborateOne = async (c: T): Promise<T> => {
    if (c.verification.status === "flagged" && !normalizeEntityName(c.name)) return c;
    const checks = [...c.verification.checks];
    const provenance = { ...c.verification.provenance };
    const out: T = { ...c };

    const org = await withTimeout(() =>
      enrichOrganization({ domain: domainOf(c.website), name: c.name }),
    );
    const company = org?.status === "success" ? org.data : null;

    if (company) {
      checks.push({ id: "org_exists", label: "Firm confirmed in provider data", ok: true });
      if (company.website) {
        const site = cleanWebUrl(company.website);
        if (site) {
          out.website = site;
          provenance.website = "apollo";
        }
      }
      if (!out.geography && company.headquarters) {
        out.geography = company.headquarters;
        provenance.geography = "apollo";
      }
    } else {
      checks.push({
        id: "org_exists",
        label: "Firm confirmed in provider data",
        ok: false,
        detail: "No provider record matched this name or domain.",
      });
    }

    // Only spend a people lookup when there's no trustworthy email yet.
    if (!out.contactEmail) {
      const people = await withTimeout(() =>
        searchPeople({
          company: domainOf(out.website) ?? out.name,
          person_seniority: ["c_suite", "vp", "director"],
          per_page: 1,
        }),
      );
      const person = people?.status === "success" ? people.data?.[0] : null;
      if (person) {
        const email = cleanEmail(person.email);
        // Apollo's own verified flag is the bar — a guessed address is no better
        // than the model's, so it doesn't get promoted to a verified provenance.
        if (email && person.email_verified) {
          out.contactEmail = email;
          provenance.contactEmail = "apollo";
        }
        if (!out.contactName && person.name) {
          out.contactName = person.name;
          provenance.contactName = "apollo";
        }
        if (!out.contactRole && person.title) {
          out.contactRole = person.title;
          provenance.contactRole = "apollo";
        }
        const linkedin = cleanLinkedIn(person.linkedin_url);
        if (!out.contactLinkedIn && linkedin) {
          out.contactLinkedIn = linkedin;
          provenance.contactLinkedIn = "apollo";
        }
        const phone = cleanPhone(person.phone);
        if (!out.contactPhone && phone) {
          out.contactPhone = phone;
          provenance.contactPhone = "apollo";
        }
        checks.push({ id: "contact_found", label: "Decision maker confirmed", ok: true });
      }
    }

    const providerBacked = Object.values(provenance).some((p) => p === "apollo");
    const status: VerificationStatus = c.verification.status === "flagged"
      ? "flagged"
      : providerBacked && company
        ? "verified"
        : c.verification.status;

    return {
      ...out,
      verification: {
        ...c.verification,
        status,
        confidence: scoreConfidence(status, out, checks),
        checks,
        provenance,
        verifiedAt: new Date().toISOString(),
      },
    };
  };

  // Bounded parallelism: a worker pool rather than sequential batches, so one
  // slow lookup can't stall the candidates behind it.
  const results = new Array<T>(candidates.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= candidates.length) return;
        try {
          results[index] = await corroborateOne(candidates[index]);
        } catch {
          results[index] = candidates[index];
        }
      }
    }),
  );
  return results;
}

/**
 * The one call the server actions use: structural verification for every
 * candidate, then external corroboration, then ordered so the best-evidenced
 * targets are what the operator sees first.
 */
export async function verifyCandidates<T extends SourceCandidate>(
  candidates: T[],
  allowedCategories: string[] = [],
  options: { corroborate?: boolean } = {},
): Promise<(T & VerifiedCandidate)[]> {
  if (!candidates.length) return [];
  const structural = candidates.map((c) => verifyStructure(c, allowedCategories));
  const verified = options.corroborate === false ? structural : await corroborateCandidates(structural);
  return rankVerified(verified);
}

/**
 * Re-verify a candidate set that came back from cache.
 *
 * The structural pass always re-runs, so a cached entry can never outlive a
 * change to the validation rules. What it can't re-derive is the provider
 * corroboration that produced the entry — repeating those lookups would give
 * back the latency the cache exists to save. So a candidate that was confirmed
 * against a provider keeps that standing, and its per-field provenance, as long
 * as the structural pass still accepts it. Anything the fresh checks flag is
 * demoted regardless of what the cache claimed.
 */
export async function reverifyCached<T extends VerifiedCandidate>(
  cached: T[],
  allowedCategories: string[] = [],
): Promise<T[]> {
  const out = cached.map((entry) => {
    const fresh = verifyStructure(entry, allowedCategories);
    const wasVerified = entry.verification?.status === "verified";
    if (!wasVerified || fresh.verification.status === "flagged") return fresh;

    // The cached provenance is the richer one — it records the provider lookups
    // the fresh structural pass has no way to repeat — so it wins the merge.
    const provenance = { ...fresh.verification.provenance, ...entry.verification.provenance };
    // A field the structural pass dropped can't keep its provider provenance.
    for (const field of Object.keys(provenance) as (keyof SourceCandidate)[]) {
      if (fresh[field] === undefined) delete provenance[field];
    }
    return {
      ...fresh,
      verification: {
        ...fresh.verification,
        status: "verified" as VerificationStatus,
        confidence: scoreConfidence("verified", fresh, fresh.verification.checks),
        provenance,
      },
    };
  });
  return rankVerified(out);
}

const STATUS_RANK: Record<VerificationStatus, number> = {
  verified: 3,
  corroborated: 2,
  unverified: 1,
  flagged: 0,
};

/**
 * Rank by evidence first, then fit. A well-evidenced 70 outranks an
 * unsubstantiated 90 — the operator's time is better spent on the target we can
 * actually stand behind.
 */
export function rankVerified<T extends VerifiedCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => {
    const statusDelta = STATUS_RANK[b.verification.status] - STATUS_RANK[a.verification.status];
    if (statusDelta !== 0) return statusDelta;
    const confidenceDelta = b.verification.confidence - a.verification.confidence;
    if (Math.abs(confidenceDelta) > 0.05) return confidenceDelta;
    return b.fitScore - a.fitScore;
  });
}

export const __test = { FREE_MAIL_DOMAINS, STATUS_RANK };
