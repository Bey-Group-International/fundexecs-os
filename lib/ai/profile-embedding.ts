import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts, toVectorLiteral } from './voyage';

/* ============================================================================
 * lib/ai/profile-embedding.ts — org mandate → Voyage vector.
 *
 * Builds a compact natural-language description of an org's investment mandate
 * from its member profile and embeds it into `org_profile_embeddings`. The
 * adaptive signal scorer (`generate_signal_matches`) reads that vector to add a
 * meaning-level `semantic_fit` factor on top of the keyword match.
 *
 * Never-block, same contract as the rest of lib/ai: a missing VOYAGE_API_KEY,
 * an empty profile, or any network error returns `{ ok: false }` and writes
 * nothing — semantic scoring simply stays dormant until the inputs exist.
 * ========================================================================= */

export interface EmbedResult {
  ok: boolean;
  reason?: string;
}

/** Pull the mandate-relevant free text from an org owner's member profile. */
function buildMandateText(profile: {
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  focus_areas: string[] | null;
  details: Record<string, unknown> | null;
}): string {
  const d = profile.details ?? {};
  const detail = (key: string): string | null => {
    const v = d[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  const parts = [
    profile.headline,
    profile.bio,
    (profile.focus_areas ?? []).join(', '),
    detail('thesis'),
    detail('investment_thesis'),
    detail('strategy'),
    detail('sector'),
    detail('focus'),
    detail('geography'),
    detail('region'),
    detail('industry'),
    detail('target_customer'),
    detail('ideal_customer'),
    detail('services'),
    detail('capabilities')
  ].filter((p): p is string => Boolean(p && p.trim()));

  return parts.join('. ').slice(0, 4000).trim();
}

/**
 * Refresh the semantic mandate embedding for an org. Returns `{ ok: false }`
 * on every degrade path; only writes a row when an embedding was actually
 * produced.
 */
export async function refreshOrgProfileEmbedding(orgId: string): Promise<EmbedResult> {
  if (!process.env.VOYAGE_API_KEY) return { ok: false, reason: 'no_api_key' };
  if (!orgId) return { ok: false, reason: 'no_org' };

  const admin = createAdminClient();

  // Resolve the org owner's member profile (the source of mandate text).
  const { data: owner } = await admin
    .from('org_members')
    .select('user_id, role, status, created_at')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(20);

  const ownerRow =
    (owner ?? [])
      .slice()
      .sort((a, b) => roleRank(a.role) - roleRank(b.role))
      .at(0) ?? null;
  if (!ownerRow?.user_id) return { ok: false, reason: 'no_owner' };

  const { data: profile } = await admin
    .from('member_profiles')
    .select('display_name, headline, bio, focus_areas, details')
    .eq('user_id', ownerRow.user_id)
    .maybeSingle();

  if (!profile) return { ok: false, reason: 'no_profile' };

  const text = buildMandateText({
    display_name: profile.display_name ?? null,
    headline: profile.headline ?? null,
    bio: profile.bio ?? null,
    focus_areas: (profile.focus_areas as string[] | null) ?? null,
    details: (profile.details as Record<string, unknown> | null) ?? null
  });
  if (text.length < 12) return { ok: false, reason: 'empty_profile' };

  let vector: number[];
  try {
    const [embedded] = await embedTexts([text], 'document');
    if (!embedded || embedded.length === 0) return { ok: false, reason: 'no_vector' };
    vector = embedded;
  } catch {
    return { ok: false, reason: 'embed_failed' };
  }

  // org_profile_embeddings is additive (not yet in generated types); write
  // through a narrowly-typed escape rather than `any`.
  const db = admin as unknown as {
    from: (table: string) => {
      upsert: (
        values: Record<string, unknown>,
        opts?: { onConflict?: string }
      ) => Promise<{ error: { message: string } | null }>;
    };
  };

  const { error } = await db.from('org_profile_embeddings').upsert(
    {
      org_id: orgId,
      embedding: toVectorLiteral(vector),
      source_text: text,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'org_id' }
  );

  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

function roleRank(role: string | null): number {
  if (role === 'owner') return 0;
  if (role === 'admin') return 1;
  return 2;
}
