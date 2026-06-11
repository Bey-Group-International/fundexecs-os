'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { setMemberType, saveMemberProfile } from '@/lib/actions/member-profile';
import {
  identityRoleFor,
  mandateCfg,
  memberTypeFor,
  orgTypeFor,
  type InvestorGroup,
  type Mandate
} from '@/lib/onboarding/mandate';
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

const INVESTOR_GROUPS = new Set<InvestorGroup>(['fund', 'capital', 'service']);

function asGroup(value: unknown): InvestorGroup {
  return typeof value === 'string' && INVESTOR_GROUPS.has(value as InvestorGroup)
    ? (value as InvestorGroup)
    : 'fund';
}

/**
 * Brief the team — the single onboarding commit for the Mandate Brief.
 *
 * Persists the whole brief in order so the workspace exists before anything
 * that depends on it: (1) identity + org via `save_onboarding_identity`,
 * (2) member type (which seeds the demo desk), (3) the mandate row, and
 * (4) the member profile marked `complete` (the gate the middleware checks,
 * so the operator lands in the command center rather than bouncing back).
 *
 * Best-effort steps never block the brief; only the org-creating identity
 * write is hard-required.
 */
export async function briefTheTeam(input: Mandate): Promise<OnboardingIdentityResult> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectedFrom=/onboarding');

  const group = asGroup(input.investorGroup);
  const cfg = mandateCfg(group);
  const principal = cleanStr(input.principal, 160);
  const firm = cleanStr(input.firm, 160);

  // 1. Identity + organization (creates the org + owner membership).
  const { error: idErr } = await supabase.rpc('save_onboarding_identity', {
    _full_name: principal,
    _role: identityRoleFor(group),
    _org_name: firm,
    _org_type: orgTypeFor(group)
  });
  if (idErr) {
    const message = idErr.message.includes('organization name is required')
      ? 'A fund or firm name is required to create your workspace.'
      : idErr.message;
    return { ok: false, error: message };
  }

  // 2. Member type (also seeds the per-type demo desk — best-effort inside).
  await setMemberType(memberTypeFor(group, input.investorRole)).catch(() => undefined);

  // 3. The mandate row (one per org). Best-effort — never block the brief.
  const org = await getActiveOrg().catch(() => null);
  if (org) {
    await supabase
      .from('mandates')
      .upsert(
        {
          org_id: org.orgId,
          created_by: user.id,
          principal,
          firm,
          investor_group: group,
          investor_role: cleanStr(input.investorRole, 80),
          experience: cleanStr(input.experience, 60),
          standing: cleanStr(input.standing, 60),
          objective: cleanStr(input.objective, 60),
          vehicle: cleanStr(input.vehicle, 60),
          size: cleanStr(input.size, 60),
          sectors: Array.isArray(input.sectors)
            ? input.sectors.filter((s): s is string => typeof s === 'string').slice(0, 24)
            : [],
          stage: cleanStr(input.stage, 60),
          geo: cleanStr(input.geo, 60)
        },
        { onConflict: 'org_id' }
      )
      .then(undefined, () => undefined);
  }

  // 4. Mark the profile complete so the middleware lets the operator in. The
  //    Mandate Brief stands in for the long Q&A; deeper profile editing stays
  //    available later from /profile.
  const objLabel =
    cfg.objectives.find((o) => o.id === input.objective)?.label ?? 'Run the lifecycle';
  const profileRes = await saveMemberProfile({
    displayName: principal ?? undefined,
    headline: cleanStr(`${input.investorRole} · ${objLabel}`, 200) ?? undefined,
    focusAreas: Array.isArray(input.sectors) ? input.sectors : [],
    details: {
      mandate: {
        investorGroup: group,
        investorRole: input.investorRole,
        experience: input.experience,
        standing: input.standing,
        objective: input.objective,
        vehicle: input.vehicle,
        size: input.size,
        sectors: input.sectors,
        stage: input.stage,
        geo: input.geo
      }
    },
    status: 'complete',
    completionPct: 55
  });
  if (!profileRes.ok)
    return { ok: false, error: profileRes.error ?? 'Could not save your profile.' };

  revalidatePath('/onboarding');
  revalidatePath('/', 'layout');
  return { ok: true };
}
