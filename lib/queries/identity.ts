import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';

/**
 * The identity the workspace shell renders (sidebar org switcher + user footer,
 * topbar wallet). Name / role / org / email are resolved from Supabase auth +
 * `profiles` + `organizations`. `xp` is read from `profiles.xp`; `level` is
 * derived from it via `xpToLevel`.
 */
export interface ShellIdentity {
  name: string;
  role: string;
  email: string | null;
  orgName: string;
  orgTier: string;
  level: number;
  xp: number;
}

/**
 * Derive the Earn level from accumulated XP. Level N starts at (N-1)² · 100 XP,
 * so 100→L2, 400→L3, 4 800→L7 — a gentle curve that keeps early wins frequent.
 */
export function xpToLevel(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

/**
 * Resolve the signed-in user's shell identity. Returns `null` when there is no
 * authenticated user; callers fall back to a generic shell identity so the
 * chrome still renders. Real name/role/org are SSR'd so there is no flash.
 */
export async function getShellIdentity(): Promise<ShellIdentity | null> {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, xp')
    .eq('id', user.id)
    .maybeSingle();

  let orgName: string | null = null;
  let orgTier: string | null = null;
  const org = await getActiveOrg();
  if (org) {
    const { data } = await supabase
      .from('organizations')
      .select('name, tier')
      .eq('id', org.orgId)
      .maybeSingle();
    orgName = data?.name ?? null;
    orgTier = data?.tier ?? null;
  }

  const emailHandle = user.email ? user.email.split('@')[0] : null;
  const xp = profile?.xp ?? 0;

  return {
    name: profile?.full_name || emailHandle || 'Your account',
    role: profile?.role || 'Operator',
    email: user.email ?? null,
    orgName: orgName || 'Your fund',
    orgTier: orgTier || 'Emerging manager',
    level: xpToLevel(xp),
    xp
  };
}
