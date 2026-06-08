import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMemberProfile } from '@/lib/queries/member-profile';
import { generateLaunchBrief } from '@/lib/ai/launch-brief';
import { templatedBrief, type LaunchBriefInput } from '@/lib/proof-of-truth/launch-brief';

/**
 * POST /api/earn/launch-brief — Earn's instant launch brief for the signed-in
 * member, built from their saved Proof of Truth profile + intent answers.
 *
 * Returns { ok: true, brief } where `brief` is { headline, moves, degraded }.
 * Always HTTP 200 with a usable brief once authenticated + typed: when Earn is
 * unavailable the brief is the templated fallback (degraded: true), never an
 * error — so the welcome card always has something to show.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const profile = await getMemberProfile();
  if (!profile?.memberType) {
    return NextResponse.json({ error: 'No member type yet' }, { status: 400 });
  }

  const detail = (key: string): string | null => {
    const v = profile.details[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  const input: LaunchBriefInput = {
    memberType: profile.memberType,
    displayName: profile.displayName,
    objective: detail('objective'),
    activeWork: detail('active_work'),
    urgency: detail('urgency'),
    headline: profile.headline
  };

  try {
    const brief = await generateLaunchBrief(input);
    return NextResponse.json({ ok: true, brief });
  } catch {
    // generateLaunchBrief already degrades internally; this is a final guard.
    return NextResponse.json({ ok: true, brief: templatedBrief(input) });
  }
}
