'use server';

import { createClient } from '@/lib/supabase/server';
import { getSiteURL } from '@/lib/site-url';

/**
 * Account security — let a signed-in user set/keep a real password (their
 * durable way back in, independent of Google or a one-time magic link), and
 * recover it by email if they forget.
 */

export type PasswordResult = { ok: true } | { ok: false; error: string };

/** Minimum password length. Matches the login form's `minLength`. */
const MIN_LENGTH = 8;

/**
 * Set or update the signed-in user's password. Works for Google/magic-link users
 * too — `updateUser({ password })` adds a password to their existing account, so
 * afterwards they can always sign back in with email + password.
 */
export async function setAccountPassword(newPassword: string): Promise<PasswordResult> {
  const pw = typeof newPassword === 'string' ? newPassword : '';
  if (pw.length < MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_LENGTH} characters.` };
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session expired — sign in again to set a password.' };

  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) {
    // Surfaces e.g. "New password should be different" or a reauth requirement.
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Email a password-reset link. The link rides Supabase's recovery flow back to
 * `/auth/callback` (which exchanges the code) and on to `/auth/reset`, where the
 * user sets a new password. Always returns ok — we never reveal whether an email
 * has an account.
 */
export async function requestPasswordReset(email: string): Promise<PasswordResult> {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized) return { ok: false, error: 'Enter your email.' };

  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(normalized, {
      redirectTo: `${getSiteURL()}/auth/callback?next=${encodeURIComponent('/auth/reset')}`
    });
  } catch {
    // Swallow — don't leak whether the address exists, and never error the UI.
  }
  return { ok: true };
}
