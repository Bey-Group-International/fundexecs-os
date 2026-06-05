'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { isMemberType, type MemberType } from '@/lib/member-types';
import type { Database, Json } from '@/lib/supabase/database.types';

type MemberProfilesInsert = Database['public']['Tables']['member_profiles']['Insert'];

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface MemberProfileInput {
  displayName?: string | null;
  headline?: string | null;
  bio?: string | null;
  focusAreas?: string[];
  links?: Record<string, string>;
  details?: Record<string, unknown>;
  status?: 'in_progress' | 'complete';
  completionPct?: number;
}

// --- sanitizers (all writes are server-validated) ---

function cleanStr(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed.slice(0, max) : null;
}

function cleanStrArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = cleanStr(item, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanStrMap(value: unknown, maxKeys: number, maxLen: number): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const s = cleanStr(v, maxLen);
    if (s) out[k.slice(0, 60)] = s;
    if (++n >= maxKeys) break;
  }
  return out;
}

/** Shallow-validate a JSON object: keep plain entries, cap size. */
function cleanJson(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 60);
  return Object.fromEntries(entries) as Json;
}

function clampPct(value: unknown): number {
  const n = typeof value === 'number' ? Math.round(value) : 0;
  return Math.max(0, Math.min(100, n));
}

async function currentUserId() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

/**
 * Set the user's member type (`profiles.member_type`) and ensure a
 * `member_profiles` row exists so the Q&A can start writing into it.
 */
export async function setMemberType(memberType: MemberType): Promise<ActionResult> {
  if (!isMemberType(memberType)) return { ok: false, error: 'Invalid member type.' };

  const { supabase, userId } = await currentUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ member_type: memberType })
    .eq('id', userId);
  if (profileErr) return { ok: false, error: profileErr.message };

  const { error: rowErr } = await supabase
    .from('member_profiles')
    .upsert({ user_id: userId }, { onConflict: 'user_id' });
  if (rowErr) return { ok: false, error: rowErr.message };

  // Fire the per-member-type top-up seed so the dashboard is alive on first
  // login. Idempotent server-side. Failure must never block onboarding —
  // we log and continue. Active-org lookup is best-effort; on a fresh signup
  // it should be the org `handle_new_user` auto-created.
  try {
    const org = await getActiveOrg();
    if (org) {
      // The `seed_demo_for_member_type` RPC ships in migration
      // 20260606120000_general_signup_seed_and_member_type_topup.sql. Until
      // that migration is applied to the live DB and `database.types.ts` is
      // regenerated, the generic supabase-js typings won't know about it —
      // cast the rpc name so the build stays green either way.
      const { error: seedErr } = await supabase.rpc(
        'seed_demo_for_member_type' as 'create_organization',
        {
          _org: org.orgId,
          _user: userId,
          _type: memberType
        } as unknown as { _name: string; _type: never }
      );
      if (seedErr) {
        // Non-fatal: the seed RPC may not be deployed yet, or RLS may refuse.
        // Log on the server, keep the user moving.
        console.warn('[setMemberType] seed_demo_for_member_type skipped:', seedErr.message);
      }
    }
  } catch (err) {
    console.warn(
      '[setMemberType] seed_demo_for_member_type threw:',
      err instanceof Error ? err.message : String(err)
    );
  }

  return { ok: true };
}

/**
 * Persist the in-progress Q&A answers so an unfinished profile can be resumed.
 */
export async function saveMemberDraft(draft: Record<string, unknown>): Promise<ActionResult> {
  const { supabase, userId } = await currentUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const { error } = await supabase
    .from('member_profiles')
    .upsert({ user_id: userId, draft: cleanJson(draft) }, { onConflict: 'user_id' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Upsert the assembled profile fields. Only the provided keys are written;
 * every value is sanitized server-side before it touches the database.
 */
export async function saveMemberProfile(input: MemberProfileInput): Promise<ActionResult> {
  const { supabase, userId } = await currentUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const row: MemberProfilesInsert = { user_id: userId };
  if ('displayName' in input) row.display_name = cleanStr(input.displayName, 120);
  if ('headline' in input) row.headline = cleanStr(input.headline, 200);
  if ('bio' in input) row.bio = cleanStr(input.bio, 2000);
  if ('focusAreas' in input) row.focus_areas = cleanStrArray(input.focusAreas, 24, 60);
  if ('links' in input) row.links = cleanStrMap(input.links, 24, 400);
  if ('details' in input) row.details = cleanJson(input.details);
  if ('status' in input) row.status = input.status === 'complete' ? 'complete' : 'in_progress';
  if ('completionPct' in input) row.completion_pct = clampPct(input.completionPct);

  const { error } = await supabase.from('member_profiles').upsert(row, { onConflict: 'user_id' });
  return error ? { ok: false, error: error.message } : { ok: true };
}
