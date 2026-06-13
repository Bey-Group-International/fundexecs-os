'use client';
// app/airdrop/page.tsx
// FundExecs OS — Book a strategy call funnel
// Captures the lead (reusing the access-request action), then routes to the
// scheduler. Replaces the earlier airdrop-eligibility flow.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, PhoneCall, ShieldCheck } from 'lucide-react';
import { EarnCoin } from '@/components/brand/BrandPrimitives';
import { EarnRunner } from '@/components/ui/EarnRunner';
import { submitAccessRequest } from '@/lib/actions/access-request';
import { RAISING_RANGES, type RaisingRange } from '@/lib/landing/access-request';

// Optional scheduler (Calendly / cal.com / Savvycal). When set, the success
// state sends the lead straight to the calendar; otherwise we confirm the team
// will reach out at the email on file. NEXT_PUBLIC_ so it inlines client-side.
const BOOKING_URL = process.env.NEXT_PUBLIC_BOOKING_URL || '';

const PROOF: [string, string][] = [
  ['$500M+', 'raises supported'],
  ['15', 'specialists on your team'],
  ['2 min', 'to brief your mandate']
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 14,
  color: '#f1f5f9',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 13,
  padding: '12px 13px',
  outline: 'none',
  boxSizing: 'border-box'
};

export default function BookACallPage() {
  const [step, setStep] = useState<'form' | 'submitting' | 'done'>('form');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [firm, setFirm] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [raisingRange, setRaisingRange] = useState<RaisingRange>('25_100m');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStep('submitting');
    setError('');
    const res = await submitAccessRequest({
      email,
      fullName,
      firm,
      roleTitle,
      raisingRange,
      source: 'book-a-call'
    });
    if (!res.ok) {
      setError(res.error);
      setStep('form');
      return;
    }
    // Lead captured. If a scheduler is configured, send them straight to it.
    if (BOOKING_URL) {
      window.location.assign(BOOKING_URL);
      return;
    }
    setStep('done');
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#070b14',
        color: '#f1f5f9',
        fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, sans-serif',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div className="bg-aurora" />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(40% 36% at 50% 24%, rgba(247,201,72,0.07), transparent 70%)'
        }}
      />

      {/* Nav */}
      <header
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px clamp(20px,5vw,52px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
            color: 'inherit'
          }}
        >
          <EarnCoin size={30} />
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em' }}>
            FundExecs <span style={{ color: '#475569', fontWeight: 500 }}>OS</span>
          </span>
        </Link>
        <Link href="/waitlist" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>
          Claim your desk
        </Link>
      </header>

      {/* Main */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'clamp(36px,6vh,72px) clamp(20px,5vw,52px)'
        }}
      >
        <div style={{ width: '100%', maxWidth: 520, textAlign: 'center' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 18,
              animation: 'float 3s ease-in-out infinite'
            }}
          >
            <EarnRunner size={96} glow />
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '4px 12px',
              borderRadius: 999,
              border: '1px solid rgba(247,201,72,0.3)',
              background: 'rgba(247,201,72,0.07)',
              fontSize: 11.5,
              fontWeight: 600,
              color: '#F7C948',
              marginBottom: 14
            }}
          >
            <PhoneCall size={13} /> Free 30-minute strategy call
          </div>

          {step === 'done' ? (
            <>
              <h1
                style={{
                  fontSize: 'clamp(26px,4vw,34px)',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  margin: '0 0 10px'
                }}
              >
                You&apos;re on the list.
              </h1>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: '#94a3b8', margin: '0 0 24px' }}>
                A member of the team will reach out at <b style={{ color: '#cbd5e1' }}>{email}</b>{' '}
                to map your raise. In the meantime, reserve your desk.
              </p>
              <Link
                href="/waitlist"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '13px 26px',
                  borderRadius: 13,
                  fontSize: 14.5,
                  fontWeight: 600,
                  background: 'linear-gradient(135deg,#F7C948,#E5A823)',
                  color: '#070b14',
                  textDecoration: 'none'
                }}
              >
                Claim your desk <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <>
              <h1
                style={{
                  fontSize: 'clamp(26px,4vw,36px)',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  margin: '0 0 10px'
                }}
              >
                Map your raise with the team.
              </h1>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: '#94a3b8', margin: '0 0 26px' }}>
                Book a call and we&apos;ll walk your mandate, structure, and investor path live —
                then the executive team does it for you. No card, no setup fee.
              </p>

              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {error && (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#f87171',
                      background: 'rgba(248,113,113,0.08)',
                      border: '1px solid rgba(248,113,113,0.2)',
                      borderRadius: 10,
                      padding: '10px 13px',
                      textAlign: 'left'
                    }}
                  >
                    {error}
                  </div>
                )}
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Work email"
                  autoComplete="email"
                  style={inputStyle}
                />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full name"
                    style={{ ...inputStyle, flex: 1, minWidth: 140 }}
                  />
                  <input
                    type="text"
                    required
                    value={firm}
                    onChange={(e) => setFirm(e.target.value)}
                    placeholder="Fund or firm"
                    style={{ ...inputStyle, flex: 1, minWidth: 140 }}
                  />
                </div>
                <input
                  type="text"
                  required
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="Your role or title"
                  style={inputStyle}
                />
                <select
                  value={raisingRange}
                  onChange={(e) => setRaisingRange(e.target.value as RaisingRange)}
                  aria-label="What are you raising?"
                  style={inputStyle}
                >
                  {RAISING_RANGES.map((r) => (
                    <option key={r.value} value={r.value} style={{ color: '#070b14' }}>
                      Raising: {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={step === 'submitting'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '13px',
                    borderRadius: 13,
                    fontSize: 14.5,
                    fontWeight: 600,
                    background: 'linear-gradient(135deg,#F7C948,#E5A823)',
                    color: '#070b14',
                    border: 'none',
                    cursor: step === 'submitting' ? 'not-allowed' : 'pointer',
                    opacity: step === 'submitting' ? 0.7 : 1
                  }}
                >
                  {step === 'submitting' ? (
                    'Booking…'
                  ) : (
                    <>
                      Book my strategy call <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </form>

              {/* Proof */}
              <div
                style={{
                  display: 'flex',
                  gap: 'clamp(18px,5vw,40px)',
                  marginTop: 32,
                  justifyContent: 'center',
                  flexWrap: 'wrap'
                }}
              >
                {PROOF.map(([v, l]) => (
                  <div key={l} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#F7C948' }}>{v}</div>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>{l}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div
            style={{
              marginTop: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              fontSize: 11.5,
              color: '#475569'
            }}
          >
            {step === 'done' ? <Check size={13} /> : <ShieldCheck size={13} />} Your details are
            used only to prepare your call · SOC 2 · RLS
          </div>
        </div>
      </div>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
