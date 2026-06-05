'use server';

import { revalidatePath } from 'next/cache';
import { getActiveOrg } from '@/lib/queries/org';
import { createClient } from '@/lib/supabase/server';
import type { Database, Json } from '@/lib/supabase/database.types';

type OrgType = Database['public']['Enums']['org_type'];

export interface SettingsActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

const ORG_TYPES: OrgType[] = [
  'fund',
  'lp',
  'operator',
  'capital_provider',
  'service_provider',
  'partner'
];

function result(status: SettingsActionState['status'], message: string): SettingsActionState {
  return { status, message };
}

function cleanStr(value: FormDataEntryValue | null, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isOrgType(value: unknown): value is OrgType {
  return typeof value === 'string' && ORG_TYPES.includes(value as OrgType);
}

function jsonRecord(value: unknown): Record<string, Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, Json>) };
}

export async function updateAccountSettings(
  _prevState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return result('error', 'Sign in again before saving account settings.');

  const fullName = cleanStr(formData.get('fullName'), 120);
  if (!fullName) return result('error', 'Full name is required.');

  const role = cleanStr(formData.get('role'), 120);
  const phone = cleanStr(formData.get('phone'), 40);
  const bio = cleanStr(formData.get('bio'), 2000);

  const { data: updatedProfile, error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: fullName, role })
    .eq('id', user.id)
    .select('id')
    .maybeSingle();

  if (profileError) return result('error', profileError.message);
  if (!updatedProfile) return result('error', 'Profile could not be updated.');

  const { data: memberProfile, error: memberProfileReadError } = await supabase
    .from('member_profiles')
    .select('details')
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberProfileReadError) return result('error', memberProfileReadError.message);

  const details = jsonRecord(memberProfile?.details);
  if (phone) {
    details.contact_phone = phone;
  } else {
    delete details.contact_phone;
  }

  const { error: memberProfileError } = await supabase
    .from('member_profiles')
    .upsert({ user_id: user.id, bio, details }, { onConflict: 'user_id' });

  if (memberProfileError) return result('error', memberProfileError.message);

  revalidatePath('/settings');
  return result('success', 'Account settings saved.');
}

export async function updateOrganizationSettings(
  _prevState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const org = await getActiveOrg();
  if (!org)
    return result('error', 'Create or join a workspace before saving organization settings.');

  const orgName = cleanStr(formData.get('orgName'), 120);
  if (!orgName) return result('error', 'Organization name is required.');

  const orgType = formData.get('orgType');
  if (!isOrgType(orgType)) return result('error', 'Choose a valid organization type.');

  const supabase = await createClient();
  const { data: membership, error: membershipError } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', org.orgId)
    .eq('user_id', org.userId)
    .maybeSingle();

  if (membershipError) return result('error', membershipError.message);
  if (membership?.role !== 'owner' && membership?.role !== 'admin') {
    return result('error', 'Only workspace owners and admins can update organization settings.');
  }

  const { data: updatedOrg, error } = await supabase
    .from('organizations')
    .update({ name: orgName, type: orgType })
    .eq('id', org.orgId)
    .select('id')
    .maybeSingle();

  if (error) return result('error', error.message);
  if (!updatedOrg) return result('error', 'Organization could not be updated.');

  revalidatePath('/settings');
  return result('success', 'Organization settings saved.');
}
