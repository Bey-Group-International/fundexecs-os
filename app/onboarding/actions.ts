'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Database } from '@/lib/supabase/database.types';

type OrgType = Database['public']['Enums']['org_type'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

type OnboardingIdentityResult = { ok: true } | { ok: false; error: string };

const ROLES = new Set([
  'managing_partner',
  'principal',
  'operator',
  'limited_partner',
  'capital_provider',
  'advisor'
]);

const ORG_TYPES: OrgType[] = [
  'fund',
  'lp',
  'operator',
  'capital_provider',
  'service_provider',
  'partner'
];

function cleanStr(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function cleanRole(value: unknown): string {
  const role = cleanStr(value, 80);
  return role && ROLES.has(role) ? role : 'managing_partner';
}

function cleanOrgType(value: unknown): OrgType {
  return typeof value === 'string' && ORG_TYPES.includes(value as OrgType)
    ? (value as OrgType)
    : 'fund';
}

/**
 * First-run identity/workspace setup.
 *
 * Runs server-side so the first organization + owner membership and profile
 * update share the same cookie-aware Supabase server client and RLS boundary.
 */
export async function saveOnboardingIdentity(input: {
  fullName: string;
  role: string;
  organizationName: string;
  organizationType: string;
}): Promise<OnboardingIdentityResult> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirectedFrom=/onboarding');

  const existingOrg = await getActiveOrg();
  const organizationName = cleanStr(input.organizationName, 120);
  const organizationType = cleanOrgType(input.organizationType);

  if (!existingOrg) {
    if (!organizationName) {
      return { ok: false, error: 'Organization name is required to create your workspace.' };
    }

    const { error } = await supabase.rpc('create_organization', {
      _name: organizationName,
      _type: organizationType
    });
    if (error) return { ok: false, error: error.message };
  }

  const profile: ProfileUpdate = { role: cleanRole(input.role) };
  const fullName = cleanStr(input.fullName, 120);
  if (fullName) profile.full_name = fullName;

  const { error: profileError } = await supabase.from('profiles').update(profile).eq('id', user.id);
  if (profileError) return { ok: false, error: profileError.message };

  revalidatePath('/onboarding');
  revalidatePath('/settings');
  revalidatePath('/', 'layout');
  return { ok: true };
}
