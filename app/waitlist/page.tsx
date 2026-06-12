// app/waitlist/page.tsx
// FundExecs OS — Waitlist page
// Sprint Day 2 · 2026-06-12

import type { Metadata } from 'next';
import WaitlistForm from '@/components/waitlist/WaitlistForm';
import Link from 'next/link';
import { EarnCoin } from '@/components/brand/BrandPrimitives';

export const metadata: Metadata = {
  title: 'Join the Waitlist — FundExecs OS',
  description:
    'Reserve your desk on FundExecs OS. The first 100 operators get Founding Operator access and airdrop eligibility.',
  openGraph: {
    title: 'Join the Waitlist — FundExecs OS',
    description:
      'Reserve your desk. 15 AI specialists, led by Earn, execute your private-market mandate.',
    images: [{ url: '/og-waitlist.png', width: 1200, height: 630 }],
  },
};

const TIERS = [
  { pos: '1–100', label: 'Founding Operator', color: '#F7C948', airdrop: true },
  { pos: '101–500', label: 'Early Access', color: '#60a5fa', airdrop: true },
  // fix: 501+ matches backend boundary (position > 500)
  { pos: '501+', label: 'Waitlist', color: '#64748b', airdrop: false },
];

export default function WaitlistPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#070b14',
        color: '#f1f5f9',
        fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, sans-serif',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="bg-aurora" />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(40% 36% at 50% 20%, rgba(247,201,72,0.08), transparent 70%)',
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
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Link
          href="/"
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}
        >
          <EarnCoin size={30} />
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em' }}>
            FundExecs <span style={{ color: '#475569', fontWeight: 500 }}>OS</span>
          </span>
        </Link>
        <Link href="/login" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>
          Sign in
        </Link>
      </header>

      {/* Body */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: 'clamp(36px,6vh,72px) clamp(20px,5vw,52px)',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 880,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 48,
            alignItems: 'start',
          }}
        >
          {/* Left: value prop */}
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 13px',
                borderRadius: 999,
                border: '1px solid rgba(96,165,250,0.3)',
                background: 'rgba(96,165,250,0.07)',
                fontSize: 12,
                fontWeight: 600,
                color: '#60a5fa',
                marginBottom: 24,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: '#60a5fa' }} />
              Invite-only private beta
            </div>
            <h1
              style={{
                fontSize: 'clamp(28px,4vw,40px)',
                fontWeight: 600,
                letterSpacing: '-0.03em',
                lineHeight: 1.1,
                margin: '0 0 16px',
              }}
            >
              Your AI executive team is waiting.
            </h1>
            <p
              style={{ fontSize: 14.5, lineHeight: 1.65, color: '#94a3b8', margin: '0 0 28px' }}
            >
              Fifteen specialists — led by Earn — launch the fund, raise the capital, source the
              deals, and drive every engagement to a signed close. You set direction and approve.
              They execute.
            </p>

            {/* Tier ladder */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {TIERS.map((t) => (
                <div
                  key={t.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 14px',
                    borderRadius: 12,
                    border: `1px solid ${t.color}22`,
                    background: `${t.color}08`,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: `${t.color}18`,
                      border: `1px solid ${t.color}33`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                      color: t.color,
                      flexShrink: 0,
                    }}
                  >
                    {t.pos.split('–')[0]}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.label}</div>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                      Position {t.pos}
                    </div>
                  </div>
                  {t.airdrop && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#F7C948',
                        background: 'rgba(247,201,72,0.08)',
                        border: '1px solid rgba(247,201,72,0.2)',
                        borderRadius: 999,
                        padding: '2px 8px',
                      }}
                    >
                      ✦ Airdrop
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right: form */}
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20,
              padding: '28px 26px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    inset: -10,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(247,201,72,0.35), transparent 70%)',
                    filter: 'blur(8px)',
                  }}
                />
                <div style={{ position: 'relative' }}>
                  <EarnCoin size={52} />
                </div>
              </div>
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                textAlign: 'center',
                margin: '0 0 6px',
              }}
            >
              Claim your desk
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', textAlign: 'center', margin: '0 0 24px' }}>
              One step from your command center.
            </p>
            <WaitlistForm />
          </div>
        </div>
      </div>
    </div>
  );
}
