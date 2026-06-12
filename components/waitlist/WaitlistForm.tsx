'use client';
// components/waitlist/WaitlistForm.tsx
// FundExecs OS — Full waitlist + tier reveal experience
// Matches prototype design: dark bg, gold accents, Geist, aurora
// Sprint Day 2 · 2026-06-12

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Lock, Sparkles, Star, Clock } from 'lucide-react';

type Step = 'form' | 'submitting' | 'success' | 'already';
type Tier = 'founding_operator' | 'early_access' | 'waitlist';

const TIER_CONFIG: Record<Tier, { label: string; color: string; bg: string; border: string; icon: React.ReactNode; desc: string }> = {
  founding_operator: {
    label: 'Founding Operator',
    color: '#F7C948',
    bg: 'rgba(247,201,72,0.1)',
    border: 'rgba(247,201,72,0.25)',
    icon: <Star size={14} />,
    desc: 'First 100. Priority access, airdrop eligible, and a direct line to the founding team.',
  },
  early_access: {
    label: 'Early Access',
    color: '#60a5fa',
    bg: 'rgba(96,165,250,0.08)',
    border: 'rgba(96,165,250,0.2)',
    icon: <Sparkles size={14} />,
    desc: 'Positions 101–500. Early-operator access and airdrop eligibility.',
  },
  waitlist: {
    label: 'Waitlist',
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.08)',
    border: 'rgba(148,163,184,0.15)',
    icon: <Clock size={14} />,
    desc: "You're in line. We'll notify you the moment a desk opens.",
  },
};

const ROLE_GROUPS = [
  { id: 'fund', label: 'Fund / Dealmaker', sub: 'I run capital or deals' },
  { id: 'capital', label: 'Capital / Investor', sub: 'I allocate capital' },
  { id: 'service', label: 'Service Provider', sub: 'I support the ecosystem' },
];

interface Result {
  position: number;
  tier: Tier;
  airdropEligible: boolean;
  already?: boolean;
}

export default function WaitlistForm() {
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [firm, setFirm] = useState('');
  const [roleGroup, setRoleGroup] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email) { setError('Email is required.'); return; }
    setStep('submitting');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: name || undefined,
          firm: firm || undefined,
          roleGroup: roleGroup || undefined,
          referralCode: referralCode || undefined,
          utm: {
            source: new URLSearchParams(window.location.search).get('utm_source'),
            medium: new URLSearchParams(window.location.search).get('utm_medium'),
            campaign: new URLSearchParams(window.location.search).get('utm_campaign'),
          },
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStep('form');
        return;
      }

      setResult(data);
      setStep(data.already ? 'already' : 'success');
    } catch {
      setError('Network error. Please try again.');
      setStep('form');
    }
  }

  /* ── Success / Already-exists screen ── */
  if ((step === 'success' || step === 'already') && result) {
    const tier = result.tier as Tier;
    const tc = TIER_CONFIG[tier] || TIER_CONFIG.waitlist;
    return (
      <div style={{ width: '100%', maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        {/* Tier reveal */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: tc.bg, border: `2px solid ${tc.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: tc.color,
          }}>
            {tier === 'founding_operator'
              ? <span style={{ fontSize: 32, fontWeight: 700 }}>$</span>
              : <span style={{ fontSize: 28, color: tc.color }}>{tc.icon}</span>}
          </div>
        </div>

        {step === 'already'
          ? <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 10px' }}>You're already in.</h1>
          : <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 10px' }}>
              {result.position === 1 ? "You're first in line." : `You're #${result.position.toLocaleString()}.`}
            </h1>
        }
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--fg-3)', marginBottom: 28 }}>
          {step === 'already' ? 'Your spot is already reserved.' : 'Your desk is reserved. Confirmation email is on its way.'}
        </p>

        {/* Tier card */}
        <div style={{
          padding: '18px 20px', borderRadius: 16,
          border: `1px solid ${tc.border}`, background: tc.bg, marginBottom: 20, textAlign: 'left',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: tc.color }}>
              {tc.icon} {tc.label}
            </span>
            {result.airdropEligible && (
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#F7C948', background: 'rgba(247,201,72,0.1)', border: '1px solid rgba(247,201,72,0.2)', borderRadius: 999, padding: '2px 9px' }}>
                ✦ Airdrop eligible
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.55, margin: 0 }}>{tc.desc}</p>
        </div>

        {/* What's next */}
        <div style={{ padding: '16px 18px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', textAlign: 'left', marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 12 }}>What happens next</div>
          {[
            ['Check your email', 'Confirmation with your tier details is on its way.'],
            ["We'll notify you", "You'll get early access as soon as your desk is ready."],
            result.airdropEligible ? ['Claim your airdrop', 'Head to /airdrop to claim your early-access privileges.'] : null,
          ].filter(Boolean).map(([title, sub]) => (
            <div key={title as string} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Check size={11} style={{ color: '#34d399' }} />
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>

        {result.airdropEligible && (
          <Link href="/airdrop" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center',
            padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 600,
            background: 'linear-gradient(135deg,#F7C948,#E5A823)', color: '#070b14', textDecoration: 'none', marginBottom: 12,
          }}>
            Claim airdrop access <ArrowRight size={15} />
          </Link>
        )}
        <Link href="/" style={{ fontSize: 13, color: 'var(--fg-4)', textDecoration: 'none' }}>
          ← Back to homepage
        </Link>
      </div>
    );
  }

  /* ── Form ── */
  return (
    <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Email */}
      <div>
        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-3)', fontWeight: 500, marginBottom: 6 }}>Work email *</label>
        <input
          type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@fund.com"
          style={{ width: '100%', fontSize: 14, color: 'var(--fg-1)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Name */}
      <div>
        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-3)', fontWeight: 500, marginBottom: 6 }}>Your name</label>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Sheik Simmons"
          style={{ width: '100%', fontSize: 14, color: 'var(--fg-1)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Firm */}
      <div>
        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-3)', fontWeight: 500, marginBottom: 6 }}>Firm / organization</label>
        <input
          type="text" value={firm} onChange={e => setFirm(e.target.value)}
          placeholder="Bey Group International"
          style={{ width: '100%', fontSize: 14, color: 'var(--fg-1)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Role group */}
      <div>
        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-3)', fontWeight: 500, marginBottom: 8 }}>I am a…</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ROLE_GROUPS.map(r => (
            <button key={r.id} type="button" onClick={() => setRoleGroup(r.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 13px', borderRadius: 12, textAlign: 'left',
                border: `1px solid ${roleGroup === r.id ? 'rgba(247,201,72,0.4)' : 'var(--border)'}`,
                background: roleGroup === r.id ? 'rgba(247,201,72,0.06)' : 'var(--surface-1)',
                cursor: 'pointer',
              }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: `2px solid ${roleGroup === r.id ? '#F7C948' : 'var(--border)'}`, background: roleGroup === r.id ? '#F7C948' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {roleGroup === r.id && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#070b14' }} />}
              </span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-1)' }}>{r.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-4)', marginTop: 1 }}>{r.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Referral code */}
      <div>
        <label style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-3)', fontWeight: 500, marginBottom: 6 }}>Referral code <span style={{ color: 'var(--fg-5)' }}>(optional)</span></label>
        <input
          type="text" value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())}
          placeholder="BGI-7F2K"
          style={{ width: '100%', fontSize: 14, fontFamily: 'monospace', letterSpacing: '0.05em', color: 'var(--gold-1)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger-line)', borderRadius: 10, padding: '10px 13px' }}>
          {error}
        </div>
      )}

      <button type="submit" disabled={step === 'submitting'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '12px', borderRadius: 13, fontSize: 15, fontWeight: 600,
          background: step === 'submitting' ? 'rgba(247,201,72,0.5)' : 'linear-gradient(135deg,#F7C948,#E5A823)',
          color: '#070b14', border: 'none', cursor: step === 'submitting' ? 'not-allowed' : 'pointer',
          boxShadow: '0 8px 24px -8px rgba(247,201,72,0.35)',
        }}>
        {step === 'submitting' ? 'Reserving your desk…' : <>Claim your desk <ArrowRight size={16} /></>}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-5)' }}>
        <Lock size={12} /> No card · No setup fee · Secured by Supabase
      </div>
    </form>
  );
}
