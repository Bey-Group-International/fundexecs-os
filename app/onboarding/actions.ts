'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type OrgType = Database['public']['Enums']['org_type'];

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
 * Runs server-side so first organization, owner membership, and profile
 * identity persist together through one transactional RPC.
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

  const organizationName = cleanStr(input.organizationName, 120);
  const organizationType = cleanOrgType(input.organizationType);

  const { error } = await supabase.rpc('save_onboarding_identity', {
    _full_name: cleanStr(input.fullName, 120),
    _role: cleanRole(input.role),
    _org_name: organizationName,
    _org_type: organizationType
  });
  if (error) {
    const message = error.message.includes('organization name is required')
      ? 'Organization name is required to create your workspace.'
      : error.message;
    return { ok: false, error: message };
  }

  revalidatePath('/onboarding');
  revalidatePath('/settings');
  revalidatePath('/', 'layout');
  return { ok: true };
}
