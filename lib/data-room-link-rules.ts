// lib/data-room-link-rules.ts
//
// Who a data-room link admits by email: a domain allowlist and a cap on how
// many distinct readers it lets in. Pure, so the gate, the page and the
// operator's form all agree on what a domain is and what matches it.

const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const MAX_DOMAINS = 20;

/**
 * Parse what an operator typed ("calpers.ca.gov, @ilpa.org") into clean
 * domains. Returns the domains and anything that was not one, so the form can
 * say exactly which entry it refused rather than silently dropping it.
 */
export function parseDomains(input: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const d = raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
    if (!d) continue;
    if (!DOMAIN.test(d)) invalid.push(raw.trim());
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains: domains.slice(0, MAX_DOMAINS), invalid };
}

/** The address's domain is one listed, or a subdomain of one (mail.calpers.ca.gov). */
export function emailDomainAllowed(email: string, domains: string[] | null | undefined): boolean {
  if (!domains || domains.length === 0) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const host = email.slice(at + 1).trim().toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export function describeDomains(domains: string[]): string {
  const shown = domains.slice(0, 3).map((d) => `@${d}`);
  return domains.length > 3 ? `${shown.join(", ")} +${domains.length - 3}` : shown.join(", ");
}
