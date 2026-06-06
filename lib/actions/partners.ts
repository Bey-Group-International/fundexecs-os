'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';

export type PartnerActionResult = { ok: true; id: string } | { ok: false; error: string };

export interface AddServiceProviderInput {
  name: string;
  category?: string;
}

/**
 * Add a capital-stack service provider to the active org. RLS allows any org
 * member to insert (policy: members write service_providers).
 */
export async function addServiceProvider(
  input: AddServiceProviderInput
): Promise<PartnerActionResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_providers')
    .insert({
      org_id: org.orgId,
      name,
      category: input.category?.trim() || 'general',
      status: 'active'
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not add partner.' };
  return { ok: true, id: data.id };
}
