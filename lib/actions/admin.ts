'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { requirePlatformAdmin } from '@/lib/access.server';
import { awardTrustXp } from '@/lib/actions/xp';
import type { Database, Json } from '@/lib/supabase/database.types';

type OrgMemberRow = Database['public']['Tables']['org_members']['Row'];
type OrgMemberRole = Database['public']['Enums']['org_member_role'];

export type AdminResult = { ok: true; member: OrgMemberRow } | { ok: false; error: string };

interface AuditInput {
  orgId: string;
  actorId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/** Append a row to `admin_actions` recording an admin action (best-effort; never blocks). */
async function writeAudit(input: AuditInput): Promise<void> {
  const supabase = await createClient();
  try {
    await supabase.from('admin_actions').insert({
      org_id: input.orgId,
      admin_user_id: input.actorId,
      action_type: input.actionType,
      target_type: input.targetType,
      target_id: input.targetId,
      // Cast `Record<string, unknown>` → `Json` is safe: caller-supplied
      // metadata is a plain object literal at every call site (no
      // functions, no symbols). Supabase's auto-generated `Json` type is
      // narrower than `Record<string, unknown>` only by structural shape.
      metadata: (input.metadata ?? {}) as Json
    });
  } catch {
    // Audit best-effort — never block the primary action.
  }
}

/**
 * Approve a pending member — flip `org_members.status` to 'active' and
 * append an audit row. Fires execution-layer XP on the actor's profile.
 */
export async function approveMember(memberId: string): Promise<AdminResult> {
  if (!memberId) return { ok: false, error: 'Missing member id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_members')
    .update({ status: 'active' })
    .eq('id', memberId)
    .eq('org_id', org.orgId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Approve failed.' };

  await writeAudit({
    orgId: org.orgId,
    actorId: org.userId,
    actionType: 'approve_member',
    targetType: 'org_member',
    targetId: memberId
  });

  try {
    await awardTrustXp({ layer: 'execution', entityType: 'org_member', entityId: memberId });
  } catch {
    // best-effort
  }
  return { ok: true, member: data as OrgMemberRow };
}

/**
 * Archive a member — flip `org_members.status` to 'archived'. Owners
 * cannot be archived (would orphan the org); attempting to archive an
 * owner row returns an error.
 */
export async function archiveMember(memberId: string): Promise<AdminResult> {
  if (!memberId) return { ok: false, error: 'Missing member id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
  }

  const supabase = await createClient();
  const { data: existing, error: readErr } = await supabase
    .from('org_members')
    .select('role')
    .eq('id', memberId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!existing) return { ok: false, error: 'Member not found.' };
  if ((existing as Pick<OrgMemberRow, 'role'>).role === 'owner') {
    return { ok: false, error: 'Owners cannot be archived.' };
  }

  const { data, error } = await supabase
    .from('org_members')
    .update({ status: 'archived' })
    .eq('id', memberId)
    .eq('org_id', org.orgId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Archive failed.' };

  await writeAudit({
    orgId: org.orgId,
    actorId: org.userId,
    actionType: 'archive_member',
    targetType: 'org_member',
    targetId: memberId
  });
  return { ok: true, member: data as OrgMemberRow };
}

/**
 * Change a member's role. Promotion to `owner` requires the actor be an
 * owner themselves (org-admin alone is insufficient).
 */
export async function setMemberRole(memberId: string, role: OrgMemberRole): Promise<AdminResult> {
  if (!memberId) return { ok: false, error: 'Missing member id.' };
  if (!['owner', 'admin', 'member'].includes(role)) {
    return { ok: false, error: 'Invalid role.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  // Actor lookup
  const { data: actor } = await supabase
    .from('org_members')
    .select('role, status')
    .eq('org_id', org.orgId)
    .eq('user_id', org.userId)
    .maybeSingle();
  const actorRole = actor?.role;
  const actorActive = actor?.status === 'active';
  if (!actorActive || (actorRole !== 'owner' && actorRole !== 'admin')) {
    return { ok: false, error: 'Only owners or admins can change roles.' };
  }
  if (role === 'owner' && actorRole !== 'owner') {
    return { ok: false, error: 'Only owners can promote another member to owner.' };
  }

  // Don't let the org lose its last owner: block demoting the sole owner.
  if (role !== 'owner') {
    const { data: target } = await supabase
      .from('org_members')
      .select('role')
      .eq('id', memberId)
      .eq('org_id', org.orgId)
      .maybeSingle();
    if ((target as Pick<OrgMemberRow, 'role'> | null)?.role === 'owner') {
      const { count: ownerCount } = await supabase
        .from('org_members')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.orgId)
        .eq('role', 'owner')
        .eq('status', 'active');
      if ((ownerCount ?? 0) <= 1) {
        return { ok: false, error: 'Cannot demote the last owner of the organization.' };
      }
    }
  }

  const { data, error } = await supabase
    .from('org_members')
    .update({ role })
    .eq('id', memberId)
    .eq('org_id', org.orgId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Role update failed.' };

  await writeAudit({
    orgId: org.orgId,
    actorId: org.userId,
    actionType: 'set_member_role',
    targetType: 'org_member',
    targetId: memberId,
    metadata: { role }
  });
  return { ok: true, member: data as OrgMemberRow };
}
