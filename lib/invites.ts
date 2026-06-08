import type { Database } from '@/lib/supabase/database.types';

/** The role an invited member is granted on acceptance. */
export type InviteRole = Database['public']['Enums']['org_member_role'];

/**
 * Parse an optional admin note into a role + human note. A leading
 * `role: owner|admin|member` token sets the invited member's role (defaulting
 * to `member`); the remaining text becomes the free-form note.
 *
 * Pure (no I/O) so the role-parsing — which feeds the owner-grant escalation
 * guard in `inviteBetaUser` — is unit-testable in isolation.
 */
export function parseInviteRole(note?: string): { role: InviteRole; note: string | null } {
  const trimmed = note?.trim() ?? '';
  if (!trimmed) return { role: 'member', note: null };

  const match = /^role:\s*(owner|admin|member)\b/i.exec(trimmed);
  if (!match) return { role: 'member', note: trimmed };

  const role = match[1].toLowerCase() as InviteRole;
  const humanNote = trimmed
    .slice(match[0].length)
    .replace(/^[^A-Za-z0-9]+/, '')
    .trim();

  return { role, note: humanNote || null };
}
