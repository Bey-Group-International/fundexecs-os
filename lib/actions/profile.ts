'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/queries/auth';

/* ============================================================================
 * lib/actions/profile.ts — the viewer's own account profile, for Settings →
 * Account. Self-scoped (the `profiles` RLS only lets a user write their own
 * row); the org-level counterparts live in lib/actions/organization.ts.
 * ========================================================================= */

export interface ProfileActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function ok(message: string): ProfileActionState {
  return { status: 'success', message };
}
function err(message: string): ProfileActionState {
  return { status: 'error', message };
}
function cleanStr(value: FormDataEntryValue | null, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

/** Update the viewer's display name + role on their `profiles` row. */
export async function updateAccountProfile(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const user = await getAuthUser();
  if (!user) return err('Your session expired — sign in again.');

  const fullName = cleanStr(formData.get('fullName'), 120);
  if (!fullName) return err('Your name is required.');
  const role = cleanStr(formData.get('role'), 80);

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName, role })
    .eq('id', user.id);
  if (error) return err(error.message);

  revalidatePath('/settings');
  revalidatePath('/', 'layout');
  return ok('Profile saved.');
}

/** Upload a new profile photo to the `avatars` bucket and point the row at it. */
export async function updateAvatar(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const user = await getAuthUser();
  if (!user) return err('Your session expired — sign in again.');

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) return err('Choose an image to upload.');
  if (!file.type.startsWith('image/')) return err('That file is not an image.');
  if (file.size > MAX_AVATAR_BYTES) return err('Image must be 5 MB or smaller.');

  const supabase = await createClient();
  const ext =
    (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  // Stored under the user's own folder so the avatars-bucket RLS applies.
  const path = `${user.id}/avatar-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
  if (uploadError) return err(uploadError.message);

  const {
    data: { publicUrl }
  } = supabase.storage.from('avatars').getPublicUrl(path);

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', user.id);
  if (error) return err(error.message);

  revalidatePath('/settings');
  revalidatePath('/', 'layout');
  return ok('Photo updated.');
}
