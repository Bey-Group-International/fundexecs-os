// app/api/airdrop/route.ts
// FundExecs OS — Airdrop eligibility check & claim
// Access-only, non-financial
// Sprint Day 1 · 2026-06-12

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/airdrop?email=xxx — check eligibility
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

  // Check waitlist
  const { data: ws } = await supabase
    .from('waitlist_signups')
    .select('id, position, tier, airdrop_eligible, airdrop_claimed')
    .eq('email', email)
    .single();

  if (ws) {
    const claimed = await supabase
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
      claimed: !!claimed.data,
      claimedAt: claimed.data?.claimed_at ?? null,
      accessType: claimed.data?.access_type ?? null,
    });
  }

  // Check if already a user
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users?.users.find(u => u.email === email);
  if (user) {
    return NextResponse.json({
      found: true,
      source: 'user',
      tier: 'founding_operator',
      eligible: true,
      claimed: false,
    });
  }

  return NextResponse.json({ found: false, eligible: false });
}

// POST /api/airdrop — claim access
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const normalized = email.toLowerCase().trim();

    // Get waitlist row
    const { data: ws, error: wsErr } = await supabase
      .from('waitlist_signups')
      .select('id, tier, airdrop_eligible, airdrop_claimed')
      .eq('email', normalized)
      .single();

    if (wsErr || !ws) {
      return NextResponse.json({ error: 'Email not found on waitlist.' }, { status: 404 });
    }
    if (!ws.airdrop_eligible) {
      return NextResponse.json({ error: 'Not eligible for airdrop at this tier.' }, { status: 403 });
    }
    if (ws.airdrop_claimed) {
      return NextResponse.json({ error: 'Already claimed.' }, { status: 409 });
    }

    // Idempotency check
    const { data: existing } = await supabase
      .from('airdrop_claims')
      .select('id')
      .eq('email', normalized)
      .single();
    if (existing) {
      return NextResponse.json({ alreadyClaimed: true });
    }

    // Record claim
    const { error: claimErr } = await supabase.from('airdrop_claims').insert({
      waitlist_id: ws.id,
      email: normalized,
      tier: ws.tier,
      access_type: 'early_access',
    });
    if (claimErr) throw claimErr;

    // Mark as claimed on waitlist row
    await supabase
      .from('waitlist_signups')
      .update({ airdrop_claimed: true })
      .eq('id', ws.id);

    return NextResponse.json({ success: true, tier: ws.tier, accessType: 'early_access' });
  } catch (err) {
    console.error('[/api/airdrop]', err);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
