// app/api/airdrop/route.ts
// FundExecs OS — Airdrop eligibility check & claim
// Access-only, non-financial
// Sprint Day 1 · 2026-06-12

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const PAGE_SIZE = 1000;

/**
 * Paginated user lookup by email.
 * listUsers() returns at most `perPage` entries per call (default 50).
 * We loop until we find the user or exhaust all pages.
 */
async function findUserByEmail(
  supabase: ReturnType<typeof createAdminClient>,
  email: string
): Promise<boolean> {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE
    });
    if (error || !data?.users?.length) break;
    if (data.users.some((u) => u.email === email)) return true;
    if (data.users.length < PAGE_SIZE) break; // last page
    page++;
  }
  return false;
}

// GET /api/airdrop?email=xxx — check eligibility
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

  const { data: ws } = await supabase
    .from('waitlist_signups')
    .select('id, position, tier, airdrop_eligible, airdrop_claimed')
    .eq('email', email)
    .single();

  if (ws) {
    const { data: claimData } = await supabase
      .from('airdrop_claims')
      .select('claimed_at, access_type')
      .eq('email', email)
      .single();

    return NextResponse.json({
      found: true,
      source: 'waitlist',
      position: ws.position,
      tier: ws.tier,
      eligible: ws.airdrop_eligible,
      claimed: !!claimData,
      claimedAt: claimData?.claimed_at ?? null,
      accessType: claimData?.access_type ?? null
    });
  }

  // Check if already a full user (paginated to avoid missing anyone)
  const isUser = await findUserByEmail(supabase, email);
  if (isUser) {
    return NextResponse.json({
      found: true,
      source: 'user',
      tier: 'founding_operator',
      eligible: true,
      claimed: false
    });
  }

  return NextResponse.json({ found: false, eligible: false });
}

// POST /api/airdrop — claim access
export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const normalized = email.toLowerCase().trim();

    // Get waitlist row
    const { data: ws, error: wsErr } = await supabase
      .from('waitlist_signups')
      .select('id, tier, airdrop_eligible')
      .eq('email', normalized)
      .single();

    if (wsErr || !ws) {
      return NextResponse.json({ error: 'Email not found on waitlist.' }, { status: 404 });
    }
    if (!ws.airdrop_eligible) {
      return NextResponse.json(
        { error: 'Not eligible for airdrop at this tier.' },
        { status: 403 }
      );
    }

    // Pre-check: read existing claim BEFORE upsert so alreadyClaimed is accurate
    // regardless of concurrent requests racing on the same email.
    const { data: existingClaim } = await supabase
      .from('airdrop_claims')
      .select('id')
      .eq('email', normalized)
      .maybeSingle();

    const alreadyClaimed = existingClaim !== null;

    // Atomic upsert: insert-or-update into airdrop_claims (unique on email)
    const { data: claim, error: claimErr } = await supabase
      .from('airdrop_claims')
      .upsert(
        {
          waitlist_id: ws.id,
          email: normalized,
          access_type: 'early_access'
        },
        { onConflict: 'email', ignoreDuplicates: false }
      )
      .select('id, claimed_at')
      .single();

    if (claimErr) throw claimErr;

    // Mark waitlist row as claimed only on first claim — non-fatal if it fails
    if (!alreadyClaimed) {
      const { error: updateErr } = await supabase
        .from('waitlist_signups')
        .update({ airdrop_claimed: true })
        .eq('id', ws.id);

      if (updateErr) {
        console.error('[/api/airdrop] waitlist update failed (non-fatal)', updateErr);
      }
    }

    return NextResponse.json({
      success: true,
      alreadyClaimed,
      tier: ws.tier,
      accessType: 'early_access',
      claimedAt: claim.claimed_at
    });
  } catch (err) {
    console.error('[/api/airdrop]', err);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
