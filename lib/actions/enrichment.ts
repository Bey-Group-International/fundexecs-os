'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { enrichCompany as runEnrichCompany, enrichPerson } from '@/lib/integrations/enrichment';
import type { EnrichedCompany, EnrichedPerson } from '@/lib/integrations/enrichment/types';
import type { Json } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/actions/enrichment.ts — operator-facing enrichment write paths (P2-A).
 *
 * enrichContactById — hydrate a contact from the active enrichment provider and
 *                     persist new fields (never clobbering operator-entered data),
 *                     storing the full provider payload in `contacts.enrichment`.
 * enrichCompanyLookup — enrich a company by domain/name and return the result
 *                     (there is no companies table yet, so this is read-through).
 * Both are RLS-scoped and never-block (metering + audit live in the seam).
 * ========================================================================= */

export type EnrichContactResult =
  | { ok: true; found: boolean; cached: boolean; person: EnrichedPerson }
  | { ok: false; error: string };

export async function enrichContactById(contactId: string): Promise<EnrichContactResult> {
  if (!contactId) return { ok: false, error: 'Missing contact.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data: contact, error } = await supabase
    .from('contacts')
    .select('id, primary_email, full_name, company, title')
    .eq('id', contactId)
    .eq('org_id', org.orgId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!contact) return { ok: false, error: 'Contact not found.' };

  const { data: person, cached } = await enrichPerson(org.orgId, {
    email: contact.primary_email ?? undefined,
    fullName: contact.full_name ?? undefined,
    company: contact.company ?? undefined
  });

  if (person.found) {
    // Only fill blanks — never overwrite what the operator already entered.
    const patch: {
      full_name?: string;
      company?: string;
      title?: string;
      enrichment: Json;
      source_provider?: string;
    } = { enrichment: (person.raw ?? person) as Json, source_provider: 'enrichment' };
    if (!contact.full_name && person.fullName) patch.full_name = person.fullName;
    if (!contact.company && person.company) patch.company = person.company;
    if (!contact.title && person.title) patch.title = person.title;

    await supabase.from('contacts').update(patch).eq('id', contactId).eq('org_id', org.orgId);
    revalidatePath('/connections');
  }

  return { ok: true, found: person.found, cached, person };
}

export type EnrichCompanyResult =
  | { ok: true; found: boolean; cached: boolean; company: EnrichedCompany }
  | { ok: false; error: string };

export async function enrichCompanyLookup(input: {
  domain?: string;
  name?: string;
}): Promise<EnrichCompanyResult> {
  if (!input.domain && !input.name) {
    return { ok: false, error: 'Provide a company domain or name.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const { data: company, cached } = await runEnrichCompany(org.orgId, input);
  return { ok: true, found: company.found, cached, company };
}
