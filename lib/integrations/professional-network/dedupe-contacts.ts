// Deduplication: compare a normalized profile against the org's existing
// contacts and surface matches for user review. Pure — the caller fetches
// candidates (RLS-scoped) and decides what to do with the matches; high-
// confidence matches should block a silent insert and go to review instead.

import type { DedupeMatch, ExistingContactRef, NormalizedProfile } from "./types";

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function fullNameOf(c: ExistingContactRef): string {
  return norm(c.full_name) || `${norm(c.first_name)} ${norm(c.last_name)}`.trim();
}

/** Find likely duplicates, strongest signal first. */
export function findDuplicates(
  profile: NormalizedProfile,
  existing: ExistingContactRef[],
): DedupeMatch[] {
  const matches: DedupeMatch[] = [];
  const email = norm(profile.email);
  const linkedin = norm(profile.linkedin_url);
  const name = norm(`${profile.first_name} ${profile.last_name}`);
  const company = norm(profile.company);

  for (const c of existing) {
    const cName = fullNameOf(c);
    if (email && norm(c.email) === email) {
      matches.push({
        contactId: c.id, fullName: cName, company: c.company,
        matchedOn: "email", matchConfidence: 98,
      });
      continue;
    }
    if (linkedin && norm(c.linkedin_url) === linkedin) {
      matches.push({
        contactId: c.id, fullName: cName, company: c.company,
        matchedOn: "linkedin_url", matchConfidence: 96,
      });
      continue;
    }
    if (name && cName === name) {
      const sameCompany = company && norm(c.company) === company;
      matches.push({
        contactId: c.id, fullName: cName, company: c.company,
        matchedOn: sameCompany ? "name_company" : "name",
        matchConfidence: sameCompany ? 90 : 60,
      });
    }
  }

  return matches.sort((a, b) => b.matchConfidence - a.matchConfidence);
}

/** Matches strong enough to require explicit user confirmation before insert. */
export function blockingDuplicates(matches: DedupeMatch[]): DedupeMatch[] {
  return matches.filter((m) => m.matchConfidence >= 90);
}
