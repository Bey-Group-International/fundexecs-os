'use client';
// app/airdrop/page.tsx
// FundExecs OS — Airdrop eligibility check + claim
// Access-only, non-financial early-operator privileges
// Sprint Day 2 · 2026-06-12

import { useState } from 'react';
import Link from 'next/link';
import { Search, Check, ArrowRight, Star, Sparkles, Clock, Shield } from 'lucide-react';
import { EarnCoin } from '@/components/brand/BrandPrimitives';

type Step = 'check' | 'checking' | 'found' | 'not_found' | 'claiming' | 'claimed' | 'error';

interface StatusData {
  found: boolean;
  source?: string;
  position?: number;
  tier?: string;
  eligible?: boolean;
  claimed?: boolean;
  claimedAt?: string;
  accessType?: string;
}

const TIER_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  founding_operator: {
    label: 'Founding Operator',
    color: '#F7C948',
    bg: 'rgba(247,201,72,0.08)',
    border: 'rgba(247,201,72,0.2)',
    icon: <Star size={14} />
  },
  early_access: {
    label: 'Early Access',
    color: '#60a5fa',
    bg: 'rgba(96,165,250,0.07)',
    border: 'rgba(96,165,250,0.18)',
    icon: <Sparkles size={14} />
  },
  waitlist: {
    label: 'Waitlist',
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.07)',
    border: 'rgba(148,163,184,0.15)',
    icon: <Clock size={14} />
  }
};

export default function AirdropPage() {
  const [step, setStep] = useState<Step>('check');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState('');

  async function checkEligibility(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStep('checking');
    setError('');
    try {
      const res = await fetch(`/api/airdrop?email=${encodeURIComponent(email)}`);
      // Surface HTTP errors instead of silently treating them as "not found"
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || `Server error (${res.status}). Please try again.`);
        setStep('check');
        return;
      }
      const data = await res.json();
      setStatus(data);
      setStep(data.found ? 'found' : 'not_found');
    } catch {
      setError('Network error. Please try again.');
      setStep('check');
    }
  }

  async function claimAirdrop() {
    setStep('claiming');
    setError('');
    try {
      const res = await fetch('/api/airdrop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok && !data.alreadyClaimed) {
        setError(data.error || 'Something went wrong.');
        setStep('found');
        return;
      }
      setStep('claimed');
    } catch {
      setError('Network error. Please try again.');
      setStep('found');
    }
  }

  const tier = status?.tier as string;
  const tc = TIER_CONFIG[tier] || TIER_CONFIG.waitlist;

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
          Join waitlist
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
        <div style={{ width: '100%', maxWidth: 480, textAlign: 'center' }}>
          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    inset: -12,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(247,201,72,0.4), transparent 70%)',
                    filter: 'blur(10px)'
                  }}
                />
                <div style={{ position: 'relative' }}>
                  <EarnCoin size={60} />
                </div>
              </div>
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
              ✦ Early Operator Airdrop
            </div>
            <h1
              style={{
                fontSize: 'clamp(26px,4vw,36px)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: '0 0 10px'
              }}
            >
              {step === 'claimed' ? 'Access claimed.' : 'Check your eligibility.'}
            </h1>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: '#94a3b8', margin: 0 }}>
              {step === 'claimed'
                ? 'Your early-access privileges are confirmed. Welcome to the OS.'
                : 'Enter your email to see if you qualify for early-operator access.'}
            </p>
          </div>

          {/* Check form */}
          {(step === 'check' || step === 'checking') && (
            <form
              onSubmit={checkEligibility}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
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
              <div style={{ position: 'relative' }}>
                <Search
                  size={16}
                  style={{
                    position: 'absolute',
                    left: 13,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#475569',
                    pointerEvents: 'none'
                  }}
                />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@fund.com"
                  style={{
                    width: '100%',
                    fontSize: 14,
                    color: '#f1f5f9',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 13,
                    padding: '12px 12px 12px 40px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={step === 'checking'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px',
                  borderRadius: 13,
                  fontSize: 14.5,
                  fontWeight: 600,
                  background: 'linear-gradient(135deg,#F7C948,#E5A823)',
                  color: '#070b14',
                  border: 'none',
                  cursor: step === 'checking' ? 'not-allowed' : 'pointer',
                  opacity: step === 'checking' ? 0.7 : 1
                }}
              >
                {step === 'checking' ? (
                  'Checking…'
                ) : (
                  <>
                    Check eligibility <Search size={15} />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Not found */}
          {step === 'not_found' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  padding: '18px',
                  borderRadius: 14,
                  border: '1px solid rgba(148,163,184,0.15)',
                  background: 'rgba(148,163,184,0.06)'
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  Not on the waitlist yet
                </div>
                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>
                  <b>{email}</b> isn&apos;t on our waitlist. Join now — the first 100 get Founding
                  Operator access and airdrop eligibility.
                </div>
              </div>
              <Link
                href={`/waitlist?email=${encodeURIComponent(email)}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px',
                  borderRadius: 13,
                  fontSize: 14.5,
                  fontWeight: 600,
                  background: 'linear-gradient(135deg,#F7C948,#E5A823)',
                  color: '#070b14',
                  textDecoration: 'none'
                }}
              >
                Join the waitlist <ArrowRight size={15} />
              </Link>
              <button
                onClick={() => {
                  setStep('check');
                  setEmail('');
                  setStatus(null);
                }}
                style={{
                  fontSize: 13,
                  color: '#64748b',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Try a different email
              </button>
            </div>
          )}

          {/* Found */}
          {step === 'found' && status && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: '18px 20px',
                  borderRadius: 16,
                  border: `1px solid ${tc.border}`,
                  background: tc.bg,
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 700,
                      color: tc.color
                    }}
                  >
                    {tc.icon} {tc.label}
                  </span>
                  {status.position && (
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
                      #{status.position.toLocaleString()}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: status.eligible ? '#34d399' : '#64748b'
                    }}
                  >
                    {status.eligible ? '✓ Airdrop eligible' : '✗ Not eligible at this tier'}
                  </span>
                  {status.claimed && (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: '#34d399',
                        background: 'rgba(52,211,153,0.08)',
                        border: '1px solid rgba(52,211,153,0.2)',
                        borderRadius: 999,
                        padding: '2px 8px'
                      }}
                    >
                      Claimed
                    </span>
                  )}
                </div>
              </div>

              {error && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#f87171',
                    background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.2)',
                    borderRadius: 10,
                    padding: '10px 13px'
                  }}
                >
                  {error}
                </div>
              )}

              {status.eligible && !status.claimed && (
                <button
                  onClick={claimAirdrop}
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
                    cursor: 'pointer'
                  }}
                >
                  Claim early-operator access <ArrowRight size={15} />
                </button>
              )}
              {status.claimed && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '13px',
                    borderRadius: 13,
                    fontSize: 14,
                    fontWeight: 600,
                    background: 'rgba(52,211,153,0.08)',
                    border: '1px solid rgba(52,211,153,0.2)',
                    color: '#34d399'
                  }}
                >
                  <Check size={16} /> Access already claimed
                </div>
              )}
              {!status.eligible && (
                <Link
                  href="/waitlist"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '12px',
                    borderRadius: 13,
                    fontSize: 14,
                    fontWeight: 600,
                    background: 'rgba(255,255,255,0.06)',
                    color: '#f1f5f9',
                    border: '1px solid rgba(255,255,255,0.1)',
                    textDecoration: 'none'
                  }}
                >
                  Refer friends to move up the list
                </Link>
              )}
              <button
                onClick={() => {
                  setStep('check');
                  setEmail('');
                  setStatus(null);
                }}
                style={{
                  fontSize: 13,
                  color: '#64748b',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Check a different email
              </button>
            </div>
          )}

          {/* Claiming */}
          {step === 'claiming' && (
            <div
              style={{
                padding: '24px',
                borderRadius: 16,
                border: '1px solid rgba(247,201,72,0.2)',
                background: 'rgba(247,201,72,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12
              }}
            >
              <EarnCoin size={32} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  Earn is activating your access…
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Registering your early-operator privileges.
                </div>
              </div>
            </div>
          )}

          {/* Claimed success */}
          {step === 'claimed' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: '20px',
                  borderRadius: 16,
                  border: '1px solid rgba(52,211,153,0.25)',
                  background: 'rgba(52,211,153,0.06)',
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: 'rgba(52,211,153,0.12)',
                      border: '1px solid rgba(52,211,153,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#34d399'
                    }}
                  >
                    <Check size={16} />
                  </span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      Early-operator access confirmed
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{email}</div>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12.5,
                    color: '#64748b'
                  }}
                >
                  <Shield size={13} /> Access-only · non-financial · operator privileges
                </div>
              </div>
              <Link
                href="/login"
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
                  textDecoration: 'none'
                }}
              >
                Sign in to your OS <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* Disclaimer */}
          <div style={{ marginTop: 32, fontSize: 11.5, color: '#475569', lineHeight: 1.6 }}>
            The FundExecs OS airdrop is access-only and non-financial. No tokens, no securities, no
            financial instruments. Early-operator access grants priority onboarding and OS features.{' '}
            <Link href="/terms" style={{ color: '#475569' }}>
              Terms
            </Link>
            .
          </div>
        </div>
      </div>
    </div>
  );
}
