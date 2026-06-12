// app/api/waitlist/route.ts
// FundExecs OS — Waitlist signup endpoint
// Sprint Day 1 · 2026-06-12

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Resend } from 'resend';

/** Lazily-initialised Resend client — avoids module-level throw on missing key */
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return new Resend(key);
}

const FROM = 'FundExecs OS <noreply@fundexecs.com>';

/** Escape HTML special chars to prevent XSS in email templates */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/`/g, '&#x60;');
}

function hashIp(ip: string | null) {
  if (!ip) return null;
  // simple deterministic hash — no PII stored
  let h = 5381;
  for (let i = 0; i < ip.length; i++) h = (h * 33) ^ ip.charCodeAt(i);
  return (h >>> 0).toString(16);
}

const TIER_LABELS: Record<string, string> = {
  founding_operator: 'Founding Operator',
  early_access: 'Early Access',
  waitlist: 'Waitlist',
};

function tierBadgeHtml(tier: string) {
  const colors: Record<string, string> = {
    founding_operator: '#F7C948',
    early_access: '#60a5fa',
    waitlist: '#94a3b8',
  };
  const c = colors[tier] ?? colors.waitlist;
  const label = escapeHtml(TIER_LABELS[tier] ?? tier);
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#070b14;background:${c}">${label}</span>`;
}

function confirmationHtml(data: {
  name: string;
  position: number;
  tier: string;
  airdropEligible: boolean;
}) {
  const { name, position, tier, airdropEligible } = data;
  const safeName = escapeHtml(name);
  const positionStr =
    position === 1 ? 'first in line' : `#${position.toLocaleString()} on the waitlist`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#070b14;font-family:-apple-system,BlinkMacSystemFont,'Geist',sans-serif;color:#fff">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:40px 24px">
    <tr><td>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
        <div style="width:40px;height:40px;border-radius:50%;background:#F7C948;display:flex;align-items:center;justify-content:center">
          <span style="font-size:22px;font-weight:700;color:#070b14">$</span>
        </div>
        <span style="font-size:18px;font-weight:600;letter-spacing:-0.02em">FundExecs <span style="color:#64748b;font-weight:500">OS</span></span>
      </div>
      <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.02em;margin:0 0 12px">
        You're ${positionStr}${airdropEligible ? ' 🎉' : ''}.
      </h1>
      <p style="font-size:15px;line-height:1.6;color:#94a3b8;margin:0 0 24px">
        ${safeName ? `${safeName}, welcome` : 'Welcome'} to FundExecs OS — the AI-native command center for private-market operators. Your desk is reserved.
      </p>
      <div style="background:#0e1526;border:1px solid #1e2d45;border-radius:16px;padding:20px 22px;margin-bottom:24px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Your access tier</div>
        ${tierBadgeHtml(tier)}
        ${
          airdropEligible
            ? `
        <div style="margin-top:14px;padding:12px 14px;background:rgba(247,201,72,0.08);border:1px solid rgba(247,201,72,0.2);border-radius:10px">
          <div style="font-size:13px;font-weight:600;color:#F7C948;margin-bottom:4px">✦ Airdrop eligible</div>
          <div style="font-size:12px;color:#94a3b8;line-height:1.5">You qualify for early-operator access privileges. Check your status at <a href="https://fundexecs.com/airdrop" style="color:#60a5fa">fundexecs.com/airdrop</a>.</div>
        </div>`
            : ''
        }
      </div>
      <div style="background:#0e1526;border:1px solid #1e2d45;border-radius:16px;padding:20px 22px;margin-bottom:32px">
        <div style="font-size:13px;font-weight:600;margin-bottom:14px">What happens next</div>
        ${[
          ['1', 'Your spot is confirmed', "We'll notify you when your desk is ready to activate."],
          [
            '2',
            'Brief your mandate',
            "15 AI specialists — led by Earn — take your direction and start executing the moment you're in.",
          ],
          [
            '3',
            'Run your full lifecycle',
            'Source deals, raise capital, run diligence, close — from one command center.',
          ],
        ]
          .map(
            ([n, title, sub]) => `
        <div style="display:flex;gap:12px;margin-bottom:12px">
          <div style="width:22px;height:22px;border-radius:50%;background:#1e2d45;color:#64748b;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${n}</div>
          <div>
            <div style="font-size:13px;font-weight:600;margin-bottom:2px">${title}</div>
            <div style="font-size:12px;color:#64748b;line-height:1.5">${sub}</div>
          </div>
        </div>`,
          )
          .join('')}
      </div>
      <div style="font-size:11px;color:#475569;line-height:1.6;text-align:center">
        FundExecs OS · Bey Group International<br>
        <a href="https://fundexecs.com/unsubscribe" style="color:#475569">Unsubscribe</a> ·
        <a href="https://fundexecs.com/privacy" style="color:#475569">Privacy</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  try {
    const body = await req.json();
    const { email, name, firm, roleGroup, investorRole, referralCode, utm } = body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required.' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

    // Check for existing signup
    const { data: existing } = await supabase
      .from('waitlist_signups')
      .select('id, email, position, tier, airdrop_eligible')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      return NextResponse.json({
        already: true,
        position: existing.position,
        tier: existing.tier,
        airdropEligible: existing.airdrop_eligible,
      });
    }

    // Resolve referrer
    let referredByUid: string | null = null;
    if (referralCode) {
      const { data: ref } = await supabase
        .from('profiles')
        .select('id')
        .eq('referral_code', referralCode.toUpperCase())
        .single();
      if (ref) referredByUid = ref.id;
    }

    // Insert
    const { data: row, error: insertError } = await supabase
      .from('waitlist_signups')
      .insert({
        email: email.toLowerCase().trim(),
        name: name?.trim() || null,
        firm: firm?.trim() || null,
        role_group: roleGroup || null,
        investor_role: investorRole || null,
        referral_code: referralCode?.toUpperCase() || null,
        referred_by_uid: referredByUid,
        utm_source: utm?.source || null,
        utm_medium: utm?.medium || null,
        utm_campaign: utm?.campaign || null,
        ip_hash: hashIp(ip),
      })
      .select('id, position, tier, airdrop_eligible')
      .single();

    if (insertError) throw insertError;

    const emailHtml = confirmationHtml({
      name: name?.trim() || '',
      position: row.position,
      tier: row.tier,
      airdropEligible: row.airdrop_eligible,
    });

    const subject = `You're ${row.position === 1 ? 'first' : `#${row.position}`} on the FundExecs OS waitlist`;

    // Fire-and-forget confirmation email — does NOT block the response.
    // Both the send and the follow-up DB update are awaited inside the void
    // async IIFE so neither is silently dropped.
    void (async () => {
      try {
        await getResend().emails.send({ from: FROM, to: [email], subject, html: emailHtml });
        await supabase
          .from('waitlist_signups')
          .update({ confirmation_sent_at: new Date().toISOString() })
          .eq('id', row.id);
      } catch (e) {
        console.error('[/api/waitlist] confirmation email failed', e);
      }
    })();

    return NextResponse.json({
      success: true,
      position: row.position,
      tier: row.tier,
      airdropEligible: row.airdrop_eligible,
    });
  } catch (err: unknown) {
    console.error('[/api/waitlist]', err);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

  const { data, error } = await supabase
    .from('waitlist_signups')
    .select('position, tier, airdrop_eligible, airdrop_claimed, created_at')
    .eq('email', email)
    .single();

  // PGRST116 = PostgREST "no rows found" — expected for unknown emails
  if (error && error.code !== 'PGRST116') {
    console.error('[/api/waitlist GET]', error);
    return NextResponse.json({ found: false, error: error.message }, { status: 500 });
  }

  if (!data) return NextResponse.json({ found: false });
  return NextResponse.json({ found: true, ...data });
}
